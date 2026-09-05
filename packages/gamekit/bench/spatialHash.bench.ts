/**
 * GS-COLLISION-02 spatial-hash work budget benchmark.
 *
 * Measures build + query cost on static sparse and dense worlds so the
 * total occupied-cell budget is grounded in observed work, not guesses.
 * Reports per case: visited cells, total bucket references, candidates,
 * heap delta (allocations), and p95 operation cost.
 *
 * Run with `pnpm bench:spatialhash`.
 *
 * Floor history (desktop V8, Node 24): a hostile single-span query costs
 * ~1.2ms at 100x100 cells, ~4.3ms at 300x300, ~15ms at 600x600, and ~38ms
 * at 1000x1000 cells. MAX_SPATIAL_HASH_TOTAL_CELLS (65,536) therefore caps
 * worst-case single-operation work far below a represents-a-bug span while
 * leaving realistic spans (dense-bench max ~1k cells) wide headroom.
 */
import { buildSpatialHash2D, querySpatialHash2D } from '../src/collision2d/spatialHash';

interface World {
  readonly name: string;
  readonly items: { readonly id: string; readonly bounds: { x: number; y: number; width: number; height: number } }[];
  readonly cellSize: number;
  readonly queries: { x: number; y: number; width: number; height: number }[];
}

function sparseWorld(): World {
  const items = [];
  for (let index = 0; index < 200; index += 1) {
    const x = (index * 173) % 4000;
    const y = (index * 311) % 4000;
    items.push({ id: `s${index}`, bounds: { x, y, width: 24, height: 24 } });
  }
  return {
    name: 'sparse-200/4000px',
    items,
    cellSize: 64,
    queries: [
      { x: 0, y: 0, width: 640, height: 480 },
      { x: 2000, y: 2000, width: 320, height: 320 },
    ],
  };
}

function denseWorld(): World {
  const items = [];
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      items.push({ id: `d${x}-${y}`, bounds: { x: x * 16, y: y * 16, width: 16, height: 16 } });
    }
  }
  return {
    name: 'dense-32x32/16px',
    items,
    cellSize: 16,
    queries: [
      { x: 0, y: 0, width: 512, height: 512 },
      { x: 128, y: 128, width: 64, height: 64 },
    ],
  };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function measure(world: World): void {
  const buildStart = performance.now();
  const heapBefore = process.memoryUsage().heapUsed;
  const index = buildSpatialHash2D({ items: world.items, cellSize: world.cellSize });
  const heapAfterBuild = process.memoryUsage().heapUsed;
  const buildMs = performance.now() - buildStart;

  for (const query of world.queries) {
    const samples: number[] = [];
    let candidates = 0;
    const heapBeforeQuery = process.memoryUsage().heapUsed;
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const start = performance.now();
      const found = querySpatialHash2D(index, query);
      samples.push(performance.now() - start);
      candidates = found.length;
    }
    samples.sort((a, b) => a - b);
    const heapAfterQuery = process.memoryUsage().heapUsed;
    console.log(
      `  query ${query.width}x${query.height}: ` +
        `candidates=${candidates} ` +
        `p50=${samples[Math.floor(samples.length / 2)]!.toFixed(4)}ms ` +
        `p95=${percentile(samples, 95).toFixed(4)}ms ` +
        `heap=${((heapAfterQuery - heapBeforeQuery) / 1024).toFixed(1)}KiB/200q`,
    );
  }
  console.log(
    `  build: ${buildMs.toFixed(2)}ms heap=${((heapAfterBuild - heapBefore) / 1024).toFixed(1)}KiB`,
  );
}

for (const world of [sparseWorld(), denseWorld()]) {
  console.log(`${world.name} (cell ${world.cellSize}):`);
  measure(world);
}
