/**
 * T3 deep-freeze microbenchmark and regression gate.
 *
 * Compares the trusted-cache freezer at steady state (the realistic tick
 * pattern: the snapshot rebuilds its top levels while unchanged subtrees are
 * reused by reference) against the previous implementation, which allocated a
 * fresh WeakSet and walked `Reflect.ownKeys` on every snapshot.
 *
 * Gate (V8, node 22): the trusted cache must be ≥5× faster at 32 entities
 * and ≥10× faster at 1,000 entities. Run with `pnpm bench:deepfreeze`.
 */
import { createDeepFreeze } from '../src/core/session/deepFreeze';

interface Brick {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly alive: boolean;
}

function buildBricks(count: number): readonly Brick[] {
  const bricks: Brick[] = [];
  for (let index = 0; index < count; index += 1) {
    bricks.push({ x: index % 10, y: Math.floor(index / 10), w: 4, h: 2, alive: true });
  }
  return bricks;
}

/** Previous implementation: fresh WeakSet per call, Reflect.ownKeys walk. */
function deepFreezeLegacy<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreezeLegacy((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

interface Frame {
  readonly tick: number;
  readonly bricks: readonly Brick[];
  readonly score: number;
}

/** Realistic steady-state tick: new frame, new array, one fresh brick. */
function buildFrame(tick: number, shared: readonly Brick[]): Frame {
  const fresh: Brick = { x: 99, y: 99, w: 4, h: 2, alive: false };
  return { tick, bricks: [...shared.slice(1), fresh], score: tick };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timeOnce(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6; // ms
}

function measure(count: number, _iterations = 400): { legacy: number; cached: number } {
  const shared = buildBricks(count);
  const freezer = createDeepFreeze();
  // Warm-up: one full pass so the cache is populated and JIT is settled.
  freezer(buildFrame(0, shared));
  deepFreezeLegacy(buildFrame(0, shared));

  const legacySamples: number[] = [];
  const cachedSamples: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    legacySamples.push(timeOnce(() => deepFreezeLegacy(buildFrame(run, shared))));
    cachedSamples.push(timeOnce(() => freezer(buildFrame(run, shared))));
  }
  return { legacy: median(legacySamples), cached: median(cachedSamples) };
}

const sizes = [32, 100, 500, 1_000, 2_000];
console.log('T3 deep-freeze microbenchmark (median of 7 runs, ms per snapshot tick):');
console.log('entities | legacy (WeakSet/call) | trusted cache | speedup');
for (const size of sizes) {
  const { legacy, cached } = measure(size);
  const speedup = legacy / cached;
  console.log(
    `${String(size).padStart(8)} | ${legacy.toFixed(3).padStart(8)} ms | ${cached.toFixed(3).padStart(10)} ms | ${speedup.toFixed(1)}×`,
  );
}

const at32 = measure(32);
const at1000 = measure(1_000);
const speedup32 = at32.legacy / at32.cached;
const speedup1000 = at1000.legacy / at1000.cached;

console.log(`\ngate: 32 entities ≥5× (got ${speedup32.toFixed(1)}×), 1,000 entities ≥10× (got ${speedup1000.toFixed(1)}×)`);
if (speedup32 < 5) {
  throw new Error(`T3 gate failed: 32-entity speedup ${speedup32.toFixed(1)}× < 5×`);
}
if (speedup1000 < 10) {
  throw new Error(`T3 gate failed: 1,000-entity speedup ${speedup1000.toFixed(1)}× < 10×`);
}
console.log('T3 gate passed.');
