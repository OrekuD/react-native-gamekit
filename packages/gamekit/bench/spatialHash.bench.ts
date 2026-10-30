/**
 * Spatial-hash resource/work benchmark (desktop Node, not device FPS).
 *
 * pnpm bench:spatialhash
 * pnpm bench:spatialhash --module /absolute/path/to/baseline-spatialHash.ts
 *
 * The optional baseline module must export buildSpatialHash2D and
 * querySpatialHash2D and resolve its imports (use absolute imports when
 * keeping the snapshot in /tmp). Both versions use identical fixtures,
 * warmups, samples and independent cell/reference work counts. Heap-used
 * deltas are GC-noisy observations, NOT allocation counts or retained size.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Aabb2D } from '../src/geometry/types';
import type { buildSpatialHash2D, querySpatialHash2D, SpatialHashItem2D } from '../src/collision2d/spatialHash';

interface SpatialModule {
  readonly buildSpatialHash2D: typeof buildSpatialHash2D;
  readonly querySpatialHash2D: typeof querySpatialHash2D;
}

interface World {
  readonly name: string;
  readonly items: readonly SpatialHashItem2D[];
  readonly cellSize: number;
  readonly queries: readonly Aabb2D[];
}

function sparseWorld(): World {
  const items = Array.from({ length: 200 }, (_, index) => ({
    id: `s${index}`,
    bounds: { x: (index * 173) % 4000, y: (index * 311) % 4000, width: 24, height: 24 },
  }));
  return {
    name: 'sparse-200/4000px', items, cellSize: 64,
    queries: [
      { x: 0, y: 0, width: 640, height: 480 },
      { x: 2000, y: 2000, width: 320, height: 320 },
    ],
  };
}

function denseWorld(): World {
  const items = Array.from({ length: 1024 }, (_, index) => ({
    id: `d${index}`,
    bounds: { x: (index % 32) * 16, y: Math.floor(index / 32) * 16, width: 16, height: 16 },
  }));
  return {
    name: 'dense-32x32/16px', items, cellSize: 16,
    queries: [
      { x: 0, y: 0, width: 512, height: 512 },
      { x: 128, y: 128, width: 64, height: 64 },
    ],
  };
}

function overlappingWorld(count: number, side: number): World {
  const bounds = { x: 0, y: 0, width: side * 16 - 1, height: side * 16 - 1 };
  return {
    name: `overlap-${count}items/${side}x${side}cells`,
    items: Array.from({ length: count }, (_, index) => ({ id: `o${index}`, bounds })),
    cellSize: 16,
    queries: [bounds],
  };
}

function cellRange(bounds: Aabb2D, size: number) {
  return {
    minX: Math.floor(bounds.x / size), maxX: Math.floor((bounds.x + bounds.width) / size),
    minY: Math.floor(bounds.y / size), maxY: Math.floor((bounds.y + bounds.height) / size),
  };
}

type CellRange = ReturnType<typeof cellRange>;

function cellCount(range: CellRange): number {
  return Math.max(0, range.maxX - range.minX + 1) * Math.max(0, range.maxY - range.minY + 1);
}

function queryWork(world: World, bounds: Aabb2D) {
  const query = cellRange(bounds, world.cellSize);
  let references = 0;
  let candidates = 0;
  for (const item of world.items) {
    const range = cellRange(item.bounds, world.cellSize);
    const shared = cellCount({
      minX: Math.max(range.minX, query.minX), maxX: Math.min(range.maxX, query.maxX),
      minY: Math.max(range.minY, query.minY), maxY: Math.min(range.maxY, query.maxY),
    });
    references += shared;
    if (shared > 0) candidates += 1;
  }
  return { visitedCells: cellCount(query), scannedReferences: references, candidates };
}

function measure(operation: () => void, warmups: number, count: number) {
  for (let index = 0; index < warmups; index += 1) operation();
  const samples: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
  }
  const heapAfter = process.memoryUsage().heapUsed;
  samples.sort((first, second) => first - second);
  return {
    samples: count,
    medianMs: Number(samples[Math.floor(count / 2)]!.toFixed(4)),
    p95Ms: Number(samples[Math.floor(count * 0.95)]!.toFixed(4)),
    heapUsedDeltaKiB: Number(((heapAfter - heapBefore) / 1024).toFixed(1)),
  };
}

function runWorld(world: World, api: SpatialModule): void {
  const options = { items: world.items, cellSize: world.cellSize };
  const references = world.items.reduce((sum, item) => sum + cellCount(cellRange(item.bounds, world.cellSize)), 0);
  const start = performance.now();
  let index;
  try {
    index = api.buildSpatialHash2D(options);
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'GEOMETRY_SPATIAL_INDEX_RANGE') throw error;
    console.log(JSON.stringify({
      world: world.name, items: world.items.length, references, status: 'resource-limit-rejection',
      rejectionMs: Number((performance.now() - start).toFixed(4)),
    }));
    return;
  }
  console.log(JSON.stringify({
    world: world.name, operation: 'build', items: world.items.length, cellVisits: references,
    totalReferences: references, ...measure(() => { api.buildSpatialHash2D(options); }, 10, 50),
  }));
  for (const bounds of world.queries) {
    const work = queryWork(world, bounds);
    const found = api.querySpatialHash2D(index, bounds);
    if (found.length !== work.candidates) throw new Error('Candidate work-count oracle mismatch');
    console.log(JSON.stringify({
      world: world.name, operation: 'query', width: bounds.width, height: bounds.height, ...work,
      ...measure(() => { api.querySpatialHash2D(index, bounds); }, 25, 200),
    }));
  }
}

async function main(): Promise<void> {
  const flagIndex = process.argv.indexOf('--module');
  if (flagIndex !== -1 && process.argv[flagIndex + 1] === undefined) throw new Error('--module requires a path');
  const moduleUrl = flagIndex === -1
    ? new URL('../src/collision2d/spatialHash.ts', import.meta.url).href
    : pathToFileURL(resolve(process.argv[flagIndex + 1]!)).href;
  const api = await import(moduleUrl) as SpatialModule;
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, module: moduleUrl }));
  console.log('Heap-used deltas are GC-noisy, not allocation counts. Timings do not establish mobile frame latency.');
  for (const world of [sparseWorld(), denseWorld(), overlappingWorld(256, 16), overlappingWorld(1024, 16), overlappingWorld(1024, 32)]) {
    runWorld(world, api);
  }
}

void main();
