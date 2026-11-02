import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';
import { createElement, useMemo } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SpriteBatch as SpriteBatchComponent, SpriteBatchWrite } from '../src/react/sprites/SpriteBatch';

type Slot = { values: number[]; setXYWH(...values: number[]): void; set(...values: number[]): void };
type Mapper = { prepare(): unknown; react(value: unknown): void };
const buffers: Record<string, Slot[]> = {};
const mappers: Mapper[] = [];
const publications: number[][][] = [];

(globalThis as Record<string, unknown>).__DEV__ = false;

function snapshot() { return buffers.rects!.map((slot) => [...slot.values]); }

function useBuffer(kind: string, capacity: number) {
  return useMemo(() => {
    const slots = Array.from({ length: capacity }, () => ({
      values: kind === 'rects' ? [0, 0, 0, 0] : [1, 0, 0, 0],
      setXYWH(...values: number[]) { this.values = values; },
      set(...values: number[]) { this.values = values; },
    }));
    buffers[kind] = slots;
    return { value: slots, modify: () => publications.push(snapshot()) };
  }, [kind, capacity]);
}

mock.module('@shopify/react-native-skia', { namedExports: {
  Atlas: () => null,
  useRectBuffer: (capacity: number) => useBuffer('rects', capacity),
  useRSXformBuffer: (capacity: number) => useBuffer('xforms', capacity),
} });
mock.module('react-native-reanimated', { namedExports: {
  useAnimatedReaction: (prepare: Mapper['prepare'], react: Mapper['react']) => {
    const mapper = useMemo(() => {
      const value = { prepare, react };
      mappers.push(value);
      return value;
    }, []);
    mapper.prepare = prepare;
    mapper.react = react;
  },
} });

let SpriteBatch: typeof SpriteBatchComponent;
before(async () => { ({ SpriteBatch } = await import('../src/react/sprites/SpriteBatch')); });
beforeEach(() => { mappers.length = 0; publications.length = 0; });

function update() { for (const mapper of mappers) mapper.react(mapper.prepare()); }
function assertHidden() {
  assert.ok(snapshot().every((rect) => rect[2] === 0 && rect[3] === 0));
  assert.equal(publications.length, 2, 'both buffers are published');
  for (const publication of publications) assert.deepEqual(publication, snapshot());
}

type Item = { x: number; skip?: boolean; fail?: boolean };
function props() {
  return {
    scene: 'play', capacity: 3,
    source: {
      descriptor: {
        kind: 'sprite-sheet', source: 1, animations: {},
        frames: { f: { x: 0, y: 0, width: 16, height: 16 } },
      }, image: {}, width: 16, height: 16,
      frames: { f: { x: 0, y: 0, width: 16, height: 16 } },
    },
    commit: { value: { scene: 'play', current: [{ x: 20 }, { x: 30 }] as readonly (Item | undefined)[] | undefined } },
    alpha: { value: 0 },
    select: ({ current }: { current: readonly (Item | undefined)[] }) => current,
    write: (writer: SpriteBatchWrite, item: Item, index: number) => {
      if (item.fail) throw new Error('author write failed');
      if (!item.skip) writer.set(index, 'f', item.x, 0, 0, 1);
    },
  };
}

async function mount(input: ReturnType<typeof props>): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(SpriteBatch as never, input as never)); });
  update();
  publications.length = 0;
  return renderer;
}

describe('SpriteBatch update lifecycle', () => {
  it('hides a missing same-scene snapshot without calling select', async () => {
    const input = props();
    const select = mock.fn(input.select);
    input.select = select;
    const renderer = await mount(input);
    input.commit.value = { scene: 'play', current: undefined };
    update();
    assert.equal(select.mock.callCount(), 1);
    assertHidden();
    await act(async () => renderer.unmount());
  });

  it('clears sparse, undefined and skipped items instead of retaining old slots', async () => {
    const input = props();
    const renderer = await mount(input);
    for (const current of [[undefined, { x: 30, skip: true }], new Array<Item>(2), []]) {
      input.commit.value = { scene: 'play', current: [{ x: 20 }, { x: 30 }] };
      update();
      input.commit.value = { scene: 'play', current };
      publications.length = 0;
      update();
      assertHidden();
    }
    input.commit.value = { scene: 'play', current: [{ x: 80 }] };
    update();
    assert.equal(snapshot()[0]![2], 16, 'hidden slots can reappear');
    assert.equal(buffers.xforms![0]!.values[2], 80);
    await act(async () => renderer.unmount());
  });

  it('preserves indexed writes and multiple writes in one mapper', async () => {
    const input = props();
    input.write = (writer, item, index) => {
      if (index === 0) {
        writer.set(1, 'f', item.x, 0, 0, 1);
        writer.set(0, 'f', 90, 0, 0, 1);
        writer.set(2, 'f', 100, 0, 0, 1);
      }
    };
    const renderer = await mount(input);
    assert.deepEqual(snapshot().map((rect) => rect[2]), [16, 16, 0]);
    assert.equal(buffers.xforms![1]!.values[2], 20);
    await act(async () => renderer.unmount());
  });

  it('clears partial writes and preserves the original error when culling bounds fail', async () => {
    let fail = false;
    const error = new Error('author bounds failed');
    const input = {
      ...props(),
      cull: {
        camera: { value: { camera: { center: { x: 25, y: 0 }, zoom: 1, rotationRadians: 0 } } },
        viewport: { value: { visibleLogicalBounds: { x: 0, y: 0, width: 100, height: 100 } } },
        bounds: (item: Item) => {
          if (fail && item.x === 30) throw error;
          return { x: item.x, y: 0, width: 16, height: 16 };
        },
      },
    };
    const renderer = await mount(input);
    assert.deepEqual(snapshot().map((rect) => rect[2]), [16, 16, 0]);
    fail = true;
    assert.throws(update, (caught) => caught === error);
    assertHidden();
    await act(async () => renderer.unmount());
  });

  it('hides an existing batch when development overflow throws', async () => {
    const input = props();
    const renderer = await mount(input);
    (globalThis as Record<string, unknown>).__DEV__ = true;
    try {
      input.commit.value = { scene: 'play', current: Array.from({ length: 4 }, () => ({ x: 0 })) };
      assert.throws(update, /overflow: 4 items selected with capacity 3/);
      assertHidden();
    } finally {
      (globalThis as Record<string, unknown>).__DEV__ = false;
      await act(async () => renderer.unmount());
    }
  });

  for (const failure of ['write', 'select', 'frame'] as const) {
    it(`clears and publishes slots before propagating a ${failure} error`, async () => {
      const input = props();
      let fail = false;
      const originalSelect = input.select;
      const originalWrite = input.write;
      input.select = (context) => {
        if (fail && failure === 'select') throw new Error('author select failed');
        return originalSelect(context);
      };
      input.write = (writer, item, index) => {
        if (fail && index === 1) {
          if (failure === 'write') throw new Error('author write failed');
          if (failure === 'frame') writer.set(index, 'missing', item.x, 0, 0, 1);
        }
        originalWrite(writer, item, index);
      };
      const renderer = await mount(input);
      fail = true;
      assert.throws(update, failure === 'frame' ? /missing/ : /author .* failed/);
      assertHidden();
      fail = false;
      publications.length = 0;
      update();
      assert.deepEqual(snapshot().map((rect) => rect[2]), [16, 16, 0]);
      await act(async () => renderer.unmount());
    });
  }
});
