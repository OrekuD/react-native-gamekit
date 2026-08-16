/**
 * T12-F8 benchmark: camera visibility culling scenarios.
 *
 * Records distributions across identical entity populations: sparse vs
 * dense fields, stationary vs moving cameras, and culling on vs off — in
 * one build mode (Node, headless). The headless filter is the same
 * conservative test the SpriteBatch worklet applies; UI-runtime cost is
 * measured on device, never approximated here.
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

function bench(label: string, fn: () => void, iterations: number): void {
  // Warm the JIT, then measure.
  fn();
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    fn();
  }
  const elapsed = performance.now() - start;
  console.log(
    `${label}: ${iterations} iterations in ${elapsed.toFixed(1)} ms (${(elapsed / iterations).toFixed(3)} ms/op)`,
  );
}

function runScenario(label: string, items: Item[], camera: ReturnType<typeof createCamera2D>, culling: boolean): void {
  const cut = { camera, cutId: 1 };
  const visibleBounds = batchVisibleBounds2D(cut, FIT as never, 24);
  bench(
    `${label} ${culling ? 'cull-on' : 'cull-off'} (${items.length} items)`,
    () => {
      if (culling) {
        const kept = filterCameraVisible2D(items, camera, LOGICAL_VIEW, 24);
        // The batch worklet path: per-item inline test.
        for (const item of items) {
          intersectsBounds2D(item.bounds, visibleBounds as never);
        }
        if (kept.length > items.length) {
          throw new Error('impossible');
        }
      } else {
        for (const item of items) {
          intersectsBounds2D(item.bounds, visibleBounds as never);
        }
      }
    },
    2000,
  );
}

const sparse = makeField(64, 2400, 7);
const dense = makeField(512, 2400, 11);
const still = createCamera2D({ center: { x: 1200, y: 800 }, zoom: 1 });
const moving = createCamera2D({ center: { x: 400, y: 300 }, zoom: 1.6, rotationRadians: 0.3 });

console.log('Camera2D culling benchmark (Node, headless — UI-runtime cost is device-measured)');
runScenario('sparse-still', sparse, still, true);
runScenario('sparse-still', sparse, still, false);
runScenario('sparse-moving', sparse, moving, true);
runScenario('sparse-moving', sparse, moving, false);
runScenario('dense-still', dense, still, true);
runScenario('dense-still', dense, still, false);
runScenario('dense-moving', dense, moving, true);
runScenario('dense-moving', dense, moving, false);
