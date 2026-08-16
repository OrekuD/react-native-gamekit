/**
 * T12-F8/T12-RF7/T12-SF4 benchmark: camera culling scenarios.
 *
 * Executable scenario runners with WORK COUNTERS, exported so contract
 * tests can execute and compare them: predicate calls, filter calls,
 * authored writes, visible output, and the camera state consumed each
 * iteration. Modes:
 *
 * - no-camera: the plain write loop (no camera work at all).
 * - static-camera: the batch cull setup (visible-bounds computation) once
 *   per iteration plus the write loop — observably different from
 *   no-camera.
 * - moving: the same bounds computation with the camera ADVANCED every
 *   iteration.
 * - moving-cull: the production SpriteBatch path — one visible-bounds
 *   computation + one inline predicate per candidate + writes for the
 *   visible ones. The allocating public filter is measured SEPARATELY as
 *   the headless filter API, not as the batch path.
 *
 * p50/p95/p99 are recorded after a warmup. Headless math only — UI/GPU
 * cost is device-measured.
 */
import { performance } from 'node:perf_hooks';
import { batchVisibleBounds2D, intersectsBounds2D } from '../src/react/sprites/batchVisibility.ts';
import { createCamera2D, filterCameraVisible2D } from '../src/index.ts';
import type { Aabb2D } from '../src/index.ts';

const LOGICAL_VIEW: Aabb2D = { x: 0, y: 0, width: 320, height: 480 };
const FIT = {
  surfaceSize: { width: 320, height: 480 },
  logicalBounds: { x: 0, y: 0, width: 320, height: 480 },
  visibleLogicalBounds: LOGICAL_VIEW,
  contentBounds: { x: 0, y: 0, width: 320, height: 480 },
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export interface Item {
  readonly id: string;
  readonly bounds: Aabb2D;
}

export function makeField(count: number, worldSize: number, seed: number): Item[] {
  const items: Item[] = [];
  let state = seed;
  const rand = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  for (let index = 0; index < count; index += 1) {
    items.push({
      id: `i${index}`,
      bounds: {
        x: rand() * worldSize,
        y: rand() * worldSize,
        width: 12,
        height: 12,
      },
    });
  }
  return items;
}

export type Camera2D = ReturnType<typeof createCamera2D>;

/** Moving camera: advances deterministically every iteration. */
export function advanceCamera(camera: Camera2D, step: number): Camera2D {
  const x = camera.center.x + step;
  const y = camera.center.y + step * 0.5;
  return createCamera2D({
    center: { x: (x % 2400 + 2400) % 2400, y: (y % 1600 + 1600) % 1600 },
    zoom: 1 + 0.2 * Math.sin(step),
    rotationRadians: step * 0.01,
  });
}

export interface ScenarioCounters {
  readonly predicateCalls: number;
  readonly filterCalls: number;
  readonly writes: number;
  readonly visibleCount: number;
  readonly cameraCenterX: number;
}

export type ScenarioMode = 'no-camera' | 'static-camera' | 'moving' | 'moving-cull';

const STATIC_CAMERA: Camera2D = createCamera2D({ center: { x: 1200, y: 800 }, zoom: 1 });

/** One production-equivalent path with work counters (T12-SF4). */
export function runScenario(
  items: readonly Item[],
  mode: ScenarioMode,
  iteration: number,
): ScenarioCounters {
  if (mode === 'no-camera') {
    let writes = 0;
    for (const item of items) {
      writes += 1;
      void item.bounds.x;
    }
    return { predicateCalls: 0, filterCalls: 0, writes, visibleCount: items.length, cameraCenterX: -1 };
  }

  const camera = mode === 'moving' || mode === 'moving-cull' ? advanceCamera(STATIC_CAMERA, iteration) : STATIC_CAMERA;
  const cut = { camera, cutId: 1 };
  const visible = batchVisibleBounds2D(cut, FIT as never, 24) as never;
  let writes = 0;
  let visibleCount = 0;

  if (mode === 'moving-cull') {
    // The production SpriteBatch path: ONE visible-bounds computation and
    // ONE inline predicate per candidate.
    let predicateCalls = 0;
    for (const item of items) {
      predicateCalls += 1;
      if (intersectsBounds2D(item.bounds, visible)) {
        writes += 1;
        visibleCount += 1;
      }
    }
    return { predicateCalls, filterCalls: 0, writes, visibleCount, cameraCenterX: camera.center.x };
  }

  // static-camera and moving WITHOUT culling: bounds computation (camera
  // work) plus the plain write loop — no predicate, no filter.
  const predicateCalls = 0;
  for (const item of items) {
    writes += 1;
    visibleCount += 1;
    void item.bounds.x;
    void visible;
  }
  return { predicateCalls, filterCalls: 0, writes, visibleCount, cameraCenterX: camera.center.x };
}

/** The allocating public filter, measured separately (headless API only). */
export function runFilterApi(items: readonly Item[], camera: Camera2D): number {
  return filterCameraVisible2D(items, camera, LOGICAL_VIEW, 24).length;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function bench(label: string, run: (iteration: number) => void, iterations: number, warmup: number): void {
  for (let index = 0; index < warmup; index += 1) {
    run(index);
  }
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    run(index);
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(
    `${label}: p50 ${percentile(sorted, 50).toFixed(4)} ms · p95 ${percentile(sorted, 95).toFixed(4)} ms · p99 ${percentile(sorted, 99).toFixed(4)} ms (n=${iterations})`,
  );
}

const sparse = makeField(64, 2400, 7);
const dense = makeField(512, 2400, 11);
const ITERATIONS = 3000;
const WARMUP = 300;

console.log('Camera2D culling benchmark (Node, headless — UI/GPU cost is device-measured)');
for (const [label, items] of [['sparse', sparse], ['dense', dense]] as const) {
  for (const mode of ['no-camera', 'static-camera', 'moving', 'moving-cull'] as const) {
    bench(`${label} ${mode}`, (iteration) => {
      runScenario(items, mode, iteration);
    }, ITERATIONS, WARMUP);
  }
  bench(`${label} filter-api (allocating)`, (iteration) => {
    runFilterApi(items, advanceCamera(STATIC_CAMERA, iteration));
  }, ITERATIONS, WARMUP);
}
