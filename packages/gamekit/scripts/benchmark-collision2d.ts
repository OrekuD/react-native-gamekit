/**
 * T11.10 benchmark: brute-force pair checks vs the spatial hash broad phase.
 *
 * Records distributions (not one FPS value): items, per-query candidates,
 * and wall time for mostly-miss distributions.
 */
import { performance } from 'node:perf_hooks';
import { buildSpatialHash2D, collideCircleAabb2D, querySpatialHash2D } from '../src/index.ts';
import type { Aabb2D } from '../src/index.ts';

interface Item {
  readonly id: string;
  readonly bounds: Aabb2D;
}

function makeField(count: number, seed: number): Item[] {
  const items: Item[] = [];
  let state = seed;
  const rand = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  for (let index = 0; index < count; index += 1) {
    const x = rand() * 320;
    const y = rand() * 480;
    items.push({
      id: `item-${index}`,
      bounds: { x, y, width: 4 + rand() * 12, height: 4 + rand() * 12 },
    });
  }
  return items;
}

function bruteForce(items: readonly Item[], query: Aabb2D): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (
      item.bounds.x <= query.x + query.width &&
      item.bounds.x + item.bounds.width >= query.x &&
      item.bounds.y <= query.y + query.height &&
      item.bounds.y + item.bounds.height >= query.y
    ) {
      result.push(item.id);
    }
  }
  return result;
}

function run(items: readonly Item[], cellSize: number): {
  readonly bruteMs: number;
  readonly hashMs: number;
  readonly candidates: number[];
  readonly bruteCandidates: number[];
} {
  const index = buildSpatialHash2D({ items, cellSize });
  const queries = 2000;
  const candidates: number[] = [];
  const bruteCandidates: number[] = [];

  const bruteStart = performance.now();
  for (let q = 0; q < queries; q += 1) {
    const query = { x: (q * 7) % 320, y: (q * 11) % 480, width: 24, height: 24 };
    bruteCandidates.push(bruteForce(items, query).length);
  }
  const bruteMs = performance.now() - bruteStart;

  const hashStart = performance.now();
  for (let q = 0; q < queries; q += 1) {
    const query = { x: (q * 7) % 320, y: (q * 11) % 480, width: 24, height: 24 };
    candidates.push(querySpatialHash2D(index, query).length);
  }
  const hashMs = performance.now() - hashStart;

  return { bruteMs, hashMs, candidates, bruteCandidates };
}

for (const count of [32, 128, 512]) {
  const items = makeField(count, 7);
  const { bruteMs, hashMs, candidates, bruteCandidates } = run(items, 48);
  const avg = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
  console.log(
    `items=${count} brute=${bruteMs.toFixed(1)}ms hash=${hashMs.toFixed(1)}ms ` +
      `candidates avg=${avg(candidates).toFixed(1)} (brute avg=${avg(bruteCandidates).toFixed(1)})`,
  );
}

// Dense distribution: large query bounds so candidates dominate the cost.
for (const count of [128, 512]) {
  const items = makeField(count, 7);
  const index = buildSpatialHash2D({ items, cellSize: 48 });
  const queries = 500;
  let bruteMs = 0;
  let hashMs = 0;
  let candidates = 0;
  for (let q = 0; q < queries; q += 1) {
    const query = { x: 0, y: 0, width: 320, height: 480 };
    const t0 = performance.now();
    bruteForce(items, query);
    bruteMs += performance.now() - t0;
    const t1 = performance.now();
    candidates += querySpatialHash2D(index, query).length;
    hashMs += performance.now() - t1;
  }
  console.log(
    `dense items=${count} brute=${bruteMs.toFixed(1)}ms hash=${hashMs.toFixed(1)}ms ` +
      `candidates avg=${(candidates / queries).toFixed(0)}`,
  );
}

// Allocation behavior: misses allocate nothing on the manifold path.
const before = process.memoryUsage().heapUsed;
for (let index = 0; index < 100_000; index += 1) {
  collideCircleAabb2D({ x: index % 320, y: 500, radius: 4 }, { x: 0, y: 0, width: 20, height: 20 });
}
const after = process.memoryUsage().heapUsed;
console.log(`100k miss manifolds: heap delta ${((after - before) / 1024).toFixed(1)} KiB`);
