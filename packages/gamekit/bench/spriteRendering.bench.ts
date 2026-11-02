/**
 * Mounted Sprite/SpriteBatch callback CPU benchmark (Node, not native FPS).
 *
 * node --import tsx --experimental-test-module-mocks bench/spriteRendering.bench.ts
 * Add --source-dir /tmp/baseline/packages/gamekit/src for a historical source
 * snapshot. Preserve package module type and make the same node_modules
 * available to the snapshot so imports and React resolve identically.
 * Set TSX_TSCONFIG_PATH to that snapshot's package tsconfig using its real
 * filesystem path (on macOS /private/tmp, not /tmp) for matching JSX output.
 *
 * Mounts actual components once with structural Skia/Reanimated mocks, then
 * invokes their captured callbacks without React rerenders. Retained updates
 * run rect, transform, reflection and opacity callbacks; batch updates run
 * prepare+reaction. Native scheduling, host-object writes, UI transfer and
 * rendering are excluded. Getter/setter counters add instrument overhead.
 * p95 describes averages of 20 updates, not individual-update tail latency.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement, Fragment, useMemo, type ComponentType, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { LoadedSpriteSheet } from '../src/assets/types';
import type { SpriteProps } from '../src/react/sprites/Sprite';
import type { SpriteBatchWrite } from '../src/react/sprites/SpriteBatch';

const WARMUP_UPDATES = 50;
const SAMPLE_COUNT = 30;
const UPDATES_PER_SAMPLE = 20;
const counters = {
  rectWrites: 0, transformWrites: 0, selectedFrameReads: 0,
  elapsedReads: 0, derivedEvaluations: 0, itemSelections: 0, publications: 0,
};
type Slot = {
  values: number[];
  setXYWH(a: number, b: number, c: number, d: number): void;
  set(a: number, b: number, c: number, d: number): void;
};
const rectBuffers: Slot[][] = [];
const transformBuffers: Slot[][] = [];
const bufferCallbacks: Array<() => void> = [];
const derivedCallbacks: Array<() => void> = [];
const reactionCallbacks: Array<() => void> = [];

(globalThis as Record<string, unknown>).__DEV__ = false;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function useBuffer(kind: 'rect' | 'transform', capacity: number, modifier: (slot: Slot, index: number) => void) {
  return useMemo(() => {
    const slots = Array.from({ length: capacity }, (): Slot => ({
      values: kind === 'rect' ? [0, 0, 0, 0] : [1, 0, 0, 0],
      setXYWH(a, b, c, d) {
        counters.rectWrites += 1;
        this.values[0] = a; this.values[1] = b; this.values[2] = c; this.values[3] = d;
      },
      set(a, b, c, d) {
        counters.transformWrites += 1;
        this.values[0] = a; this.values[1] = b; this.values[2] = c; this.values[3] = d;
      },
    }));
    (kind === 'rect' ? rectBuffers : transformBuffers).push(slots);
    bufferCallbacks.push(() => {
      for (let index = 0; index < slots.length; index += 1) modifier(slots[index]!, index);
    });
    return { value: slots, modify: () => { counters.publications += 1; } };
  }, []);
}

mock.module('@shopify/react-native-skia', { namedExports: {
  Atlas: () => null,
  Group: ({ children }: { children?: ReactNode }) => children,
  useRectBuffer: (capacity: number, modifier: (slot: Slot, index: number) => void) => useBuffer('rect', capacity, modifier),
  useRSXformBuffer: (capacity: number, modifier: (slot: Slot, index: number) => void) => useBuffer('transform', capacity, modifier),
} });
mock.module('react-native-reanimated', { namedExports: {
  useDerivedValue: (compute: () => unknown) => useMemo(() => {
    const shared = { value: undefined as unknown };
    derivedCallbacks.push(() => {
      counters.derivedEvaluations += 1;
      shared.value = compute();
    });
    return shared;
  }, []),
  useAnimatedReaction: (prepare: () => unknown, react: (prepared: unknown) => void) => {
    useMemo(() => { reactionCallbacks.push(() => react(prepare())); return undefined; }, []);
  },
} });

const frameA = Object.freeze({ x: 0, y: 0, width: 16, height: 16 });
const frameB = Object.freeze({ x: 16, y: 0, width: 32, height: 24 });
const frames = {
  get a() { counters.selectedFrameReads += 1; return frameA; },
  get b() { counters.selectedFrameReads += 1; return frameB; },
};
const source: LoadedSpriteSheet = {
  descriptor: {
    kind: 'sprite-sheet', source: 1, frames,
    animations: { run: { frames: ['a', 'b'], frameDurationMs: 100, mode: 'loop' } },
  },
  frames, image: {} as never, width: 48, height: 24,
};

function resetHarness(): void {
  rectBuffers.length = 0; transformBuffers.length = 0;
  bufferCallbacks.length = 0; derivedCallbacks.length = 0; reactionCallbacks.length = 0;
  for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] = 0;
}

function measure(update: () => void) {
  for (let index = 0; index < WARMUP_UPDATES; index += 1) update();
  const before = { ...counters };
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < UPDATES_PER_SAMPLE; index += 1) update();
    samples.push((performance.now() - start) * 1000 / UPDATES_PER_SAMPLE);
  }
  samples.sort((a, b) => a - b);
  return {
    medianUsPerUpdate: Number(samples[Math.floor(SAMPLE_COUNT / 2)]!.toFixed(3)),
    p95UsPerUpdate: Number(samples[Math.ceil(SAMPLE_COUNT * 0.95) - 1]!.toFixed(3)),
    observedPerUpdate: Object.fromEntries((Object.keys(counters) as (keyof typeof counters)[])
      .map((key) => [key, (counters[key] - before[key]) / (SAMPLE_COUNT * UPDATES_PER_SAMPLE)])),
  };
}

function outputChecksums() {
  return {
    rectChecksum: rectBuffers.reduce((sum, buffer) =>
      sum + buffer.reduce((subtotal, slot) => subtotal + slot.values.reduce((a, b) => a + b, 0), 0), 0),
    transformChecksum: transformBuffers.reduce((sum, buffer) =>
      sum + buffer.reduce((subtotal, slot) => subtotal + slot.values.reduce((a, b) => a + b, 0), 0), 0),
  };
}

async function retained(Sprite: ComponentType<SpriteProps>, count: number): Promise<void> {
  resetHarness();
  let elapsed = 0;
  const elapsedMs = { get value() { counters.elapsedReads += 1; return elapsed; } } as never;
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(Fragment, null, Array.from({ length: count }, (_, index) =>
        createElement(Sprite, {
          key: index, source, clip: 'run', elapsedMs, x: index, y: 20,
          rotation: 0.1, scale: 1, flipX: true, anchor: { x: 0.5, y: 0.5 },
        }))));
    });
    assert.equal(bufferCallbacks.length, count * 2);
    assert.equal(derivedCallbacks.length, count * 2);
    const update = () => {
      elapsed += 1000 / 60;
      for (const callback of bufferCallbacks) callback();
      for (const callback of derivedCallbacks) callback();
    };
    const timing = measure(update);
    // The regular valid path must render identical frames for both versions.
    elapsed = 150;
    for (const callback of bufferCallbacks) callback();
    for (const buffer of rectBuffers) assert.deepEqual(buffer[0]!.values, [16, 0, 32, 24]);
    for (let index = 0; index < transformBuffers.length; index += 1) {
      const values = transformBuffers[index]![0]!.values;
      assert.ok(values.every(Number.isFinite));
      assert.ok(Math.abs(values[2]! - (index - Math.cos(0.1) * 16 + Math.sin(0.1) * 12)) < 1e-9);
      assert.ok(Math.abs(values[3]! - (20 - Math.sin(0.1) * 16 - Math.cos(0.1) * 12)) < 1e-9);
    }
    console.log(JSON.stringify({ scenario: 'retained-animated-reflected', active: count, capacity: count, ...timing, ...outputChecksums() }));
  } finally {
    await act(async () => renderer?.unmount());
  }
}

type Item = { readonly x: number };
type BatchProps = {
  scene: string; source: LoadedSpriteSheet; capacity: number;
  commit: { value: { scene: string; current: readonly Item[] } };
  alpha: { value: number };
  select(context: { current: readonly Item[] }): readonly Item[];
  write(writer: SpriteBatchWrite, item: Item, index: number): void;
};

async function batch(SpriteBatch: ComponentType<BatchProps>, active: number, capacity: number): Promise<void> {
  resetHarness();
  const current = Array.from({ length: active }, (_, x) => ({ x }));
  const input: BatchProps = {
    scene: 'play', source, capacity, commit: { value: { scene: 'play', current } }, alpha: { value: 0 },
    select: ({ current: items }) => { counters.itemSelections += 1; return items; },
    write: (writer, item, index) => writer.set(index, 'a', item.x, 20, 0.1, 1),
  };
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = create(createElement(SpriteBatch, input)); });
    assert.equal(reactionCallbacks.length, 1);
    const timing = measure(() => { for (const callback of reactionCallbacks) callback(); });
    const slots = rectBuffers[0]!;
    for (let index = 0; index < capacity; index += 1) {
      assert.deepEqual(slots[index]!.values, index < active ? [0, 0, 16, 16] : [0, 0, 0, 0]);
      assert.deepEqual(transformBuffers[0]![index]!.values, index < active
        ? [Math.cos(0.1), Math.sin(0.1), index, 20] : [1, 0, 0, 0]);
    }
    assert.equal(timing.observedPerUpdate.transformWrites, active);
    assert.equal(timing.observedPerUpdate.publications, 2);
    console.log(JSON.stringify({ scenario: 'batch-valid-items', active, capacity, ...timing, ...outputChecksums() }));
  } finally {
    await act(async () => renderer?.unmount());
  }
}

async function main(): Promise<void> {
  const flag = process.argv.indexOf('--source-dir');
  if (flag !== -1 && process.argv[flag + 1] === undefined) throw new Error('--source-dir requires a path');
  const sourceDir = flag === -1
    ? fileURLToPath(new URL('../src', import.meta.url))
    : resolve(process.argv[flag + 1]!);
  const spriteModule = await import(pathToFileURL(resolve(sourceDir, 'react/sprites/Sprite.tsx')).href);
  const batchModule = await import(pathToFileURL(resolve(sourceDir, 'react/sprites/SpriteBatch.tsx')).href);
  const Sprite = (spriteModule.Sprite ?? spriteModule.default?.Sprite) as ComponentType<SpriteProps>;
  const SpriteBatch = (batchModule.SpriteBatch ?? batchModule.default?.SpriteBatch) as ComponentType<BatchProps>;
  assert.equal(typeof Sprite, 'function');
  assert.equal(typeof SpriteBatch, 'function');
  console.log(JSON.stringify({
    node: process.version, platform: process.platform, arch: process.arch, sourceDir,
    warmupUpdates: WARMUP_UPDATES, samples: SAMPLE_COUNT, updatesPerSample: UPDATES_PER_SAMPLE,
    timingUnit: 'microseconds per callback update; percentiles of batch averages',
  }));
  for (const count of [100, 500, 1000]) await retained(Sprite, count);
  for (const [active, capacity] of [[100, 100], [500, 500], [1000, 1000], [100, 1000]] as const) {
    await batch(SpriteBatch, active, capacity);
  }
}

void main();
