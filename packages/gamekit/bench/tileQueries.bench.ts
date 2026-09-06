/**
 * GS-TILE-04 chunk-index decision benchmark.
 *
 * Compares the private 16x16 chunk traversal (`forEachCellInSpan`) with
 * direct dense row-major reads over `layer.data` on representative maps.
 * Reports per case: visited non-empty cells, wall time, and heap delta.
 * Equivalence of visited (cx, cy, id) sequences is asserted, not assumed.
 *
 * Run with `pnpm bench:tilequeries`.
 */
import { defineTileMap2D, defineTileSet2D, forEachCellInSpan } from '../src/tilemap/definitions';
import type { TileMap2D } from '../src/tilemap/types';

const tileset = defineTileSet2D({
  tiles: {
    solid: { frame: 's', collision: 'solid' },
    coin: { frame: 'c' },
  },
});

function buildMap(width: number, height: number, fill: (x: number, y: number) => number): TileMap2D {
  const data: number[] = new Array(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = fill(x, y);
    }
  }
  return defineTileMap2D({
    cellSize: { width: 16, height: 16 },
    tileset,
    layers: [{ id: 't', width, height, data }],
  });
}

/** Direct dense row-major traversal over the owned layer data. */
function directSpan(
  map: TileMap2D,
  layerId: string,
  x0: number, y0: number, x1: number, y1: number,
  visit: (cx: number, cy: number, tileId: number) => void,
): void {
  const layer = map.layerById[layerId]!;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const v = layer.data[cy * layer.width + cx]!;
      if (v !== 0) visit(cx, cy, v);
    }
  }
}

interface Span {
  readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number;
}

function collectChunk(map: TileMap2D, span: Span): string[] {
  const out: string[] = [];
  forEachCellInSpan(map, 't', span.x0, span.y0, span.x1, span.y1, (cx, cy, id) => {
    out.push(`${cx},${cy}=${id}`);
  });
  return out;
}

function collectDirect(map: TileMap2D, span: Span): string[] {
  const out: string[] = [];
  directSpan(map, 't', span.x0, span.y0, span.x1, span.y1, (cx, cy, id) => {
    out.push(`${cx},${cy}=${id}`);
  });
  return out;
}

function time(fn: () => void, iterations: number): { ms: number; heapKiB: number } {
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = performance.now() - start;
  return { ms, heapKiB: (process.memoryUsage().heapUsed - heapBefore) / 1024 };
}

function compare(name: string, map: TileMap2D, span: Span, iterations: number): void {
  const chunk = collectChunk(map, span);
  const direct = collectDirect(map, span);
  const same =
    chunk.length === direct.length && chunk.every((entry, index) => entry === direct[index]);
  const chunkCost = time(() => collectChunk(map, span), iterations);
  const directCost = time(() => collectDirect(map, span), iterations);
  console.log(
    `${name}: cells=${chunk.length} same-order=${same} ` +
      `chunk=${(chunkCost.ms / iterations).toFixed(4)}ms ` +
      `direct=${(directCost.ms / iterations).toFixed(4)}ms ` +
      `heap-chunk=${chunkCost.heapKiB.toFixed(1)}KiB heap-direct=${directCost.heapKiB.toFixed(1)}KiB`,
  );
}

function mapCost(name: string, build: () => TileMap2D): void {
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const map = build();
  const ms = performance.now() - start;
  const heapKiB = (process.memoryUsage().heapUsed - heapBefore) / 1024;
  // Touch every layer so the retained size is honest.
  void map.layers.length;
  console.log(`${name}: build=${ms.toFixed(1)}ms retained~${heapKiB.toFixed(0)}KiB`);
  void map;
}

const dense = buildMap(256, 256, () => 1);
const sparse = buildMap(256, 256, (x, y) => ((x * 31 + y * 17) % 20 === 0 ? 2 : 0));
const platformer = buildMap(200, 60, (x, y) => (y >= 56 ? 1 : y === 40 && x % 8 < 5 ? 1 : 0));

console.log('--- build + retained ---');
mapCost('dense-256', () => buildMap(256, 256, () => 1));
mapCost('sparse-256', () => buildMap(256, 256, (x, y) => ((x * 31 + y * 17) % 20 === 0 ? 2 : 0)));

console.log('--- movement-like span (4x4 cells, 2000 iterations) ---');
compare('dense small-span', dense, { x0: 100, y0: 100, x1: 103, y1: 103 }, 2000);
compare('sparse small-span', sparse, { x0: 100, y0: 100, x1: 103, y1: 103 }, 2000);

console.log('--- window-like span (40x24 cells, 300 iterations) ---');
compare('dense window', dense, { x0: 10, y0: 10, x1: 49, y1: 33 }, 300);
compare('sparse window', sparse, { x0: 10, y0: 10, x1: 49, y1: 33 }, 300);
compare('platformer window', platformer, { x0: 10, y0: 10, x1: 49, y1: 33 }, 300);

console.log('--- full-map scan (20 iterations) ---');
compare('dense full', dense, { x0: 0, y0: 0, x1: 255, y1: 255 }, 20);
compare('sparse full', sparse, { x0: 0, y0: 0, x1: 255, y1: 255 }, 20);
