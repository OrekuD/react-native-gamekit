/**
 * T12-F8/T12-RF7 benchmark: camera culling scenarios.
 *
 * Records p50/p95/p99 over identical entity populations in four
 * production-equivalent modes: no camera, static camera, moving camera,
 * and moving camera with culling. The camera advances every moving
 * iteration; the cull-off modes perform NO visibility work (the batch's
 * production path without a cull prop is a pure write loop). Headless
 * math only — UI-runtime and GPU cost is device-measured, never
 * approximated here.
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

interface Item {
  readonly id: string;
  readonly bounds: Aabb2D;
}

function makeField(count: number, worldSize: number, seed: number): Item[] {
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

/** Moving camera: advances deterministically every iteration. */
function advanceCamera(camera: ReturnType<typeof createCamera2D>, step: number): ReturnType<typeof createCamera2D> {
  const x = camera.center.x + step;
  const y = camera.center.y + step * 0.5;
  return createCamera2D({
    center: { x: (x % 2400 + 2400) % 2400, y: (y % 1600 + 1600) % 1600 },
    zoom: 1 + 0.2 * Math.sin(step),
    rotationRadians: step * 0.01,
  });
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function bench(
  label: string,
  run: (iteration: number) => void,
  iterations: number,
  warmup: number,
): void {
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

function runScenario(label: string, items: Item[], mode: 'none' | 'static' | 'moving' | 'moving-cull'): void {
  const stationary = createCamera2D({ center: { x: 1200, y: 800 }, zoom: 1 });
  const staticCut = { camera: stationary, cutId: 1 };
  const staticVisible = batchVisibleBounds2D(staticCut, FIT as never, 24) as never;
  const iterations = 3000;
  const warmup = 300;

  if (mode === 'none') {
    // Production no-camera path: the pure write loop, no visibility work.
    bench(`${label} no-camera`, (_iteration) => {
      for (const item of items) {
        void item.bounds.x;
      }
    }, iterations, warmup);
    return;
  }
  if (mode === 'static') {
    bench(`${label} static-camera`, (_iteration) => {
      // The batch path WITHOUT culling: writes every item.
      for (const item of items) {
        void item.bounds.x;
      }
    }, iterations, warmup);
    return;
  }
  bench(`${label} ${mode}`, (iteration) => {
    const camera = mode === 'moving' || mode === 'moving-cull'
      ? advanceCamera(stationary, iteration)
      : stationary;
    if (mode === 'moving-cull') {
      const cut = { camera, cutId: 1 };
      const visible = batchVisibleBounds2D(cut, FIT as never, 24);
      // One headless filter pass (the committed-visibility path), then the
      // batch's per-item inline test against the same conservative bounds.
      const kept = filterCameraVisible2D(items, camera, LOGICAL_VIEW, 24);
      for (const item of items) {
        intersectsBounds2D(item.bounds, visible as never);
      }
      if (kept.length > items.length) {
        throw new Error('impossible');
      }
    } else {
      // Moving WITHOUT culling performs no visibility work at all.
      for (const item of items) {
        void item.bounds.x;
      }
    }
    void staticVisible;
  }, iterations, warmup);
}

const sparse = makeField(64, 2400, 7);
const dense = makeField(512, 2400, 11);

console.log('Camera2D culling benchmark (Node, headless — UI/GPU cost is device-measured)');
for (const [label, items] of [['sparse', sparse], ['dense', dense]] as const) {
  runScenario(label, items, 'none');
  runScenario(label, items, 'static');
  runScenario(label, items, 'moving');
  runScenario(label, items, 'moving-cull');
}
