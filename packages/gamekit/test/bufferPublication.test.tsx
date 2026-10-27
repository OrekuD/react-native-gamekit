/** GS-REACT-03: mounted writers must publish coherent buffers to Skia. */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';
import { createElement, useMemo, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

type Slot = { values: number[]; setXYWH(...values: number[]): void; set(...values: number[]): void };
type BufferSlot = Slot | Float32Array;
type Shared<T> = { value: T; modify(modifier?: (value: T) => T, forceUpdate?: boolean): void };
type Buffer = { name: string; shared: Shared<BufferSlot[]>; peek(): BufferSlot[]; modifier(slot: BufferSlot, index: number): void };
type Snapshot = Record<string, number[][]>;
type Mapper = { prepare(): unknown; react: ((value: unknown) => void) | undefined; inputs: Set<string> };
let reading: Set<string> | undefined;
const buffers: Buffer[] = [];
const mappers: Mapper[] = [];
const publications: { name: string; force: boolean | undefined; snapshot: Snapshot }[] = [];
const requests: (() => void)[] = [];
let nextGuard = 0;

(globalThis as Record<string, unknown>).__DEV__ = false;

function shared<T>(initial: T, name: string): Shared<T> {
  let value = initial;
  return {
    get value() { reading?.add(name); return value; },
    set value(next) { value = next; },
    modify(modifier, force) {
      if (modifier !== undefined) value = modifier(value);
      publications.push({ name, force, snapshot: snapshot() });
    },
  };
}

function snapshot(): Snapshot {
  return Object.fromEntries(buffers.map((buffer) => [buffer.name, buffer.peek().map((slot) =>
    slot instanceof Float32Array ? [...slot] : [...slot.values])]));
}

function useBuffer(kind: string, capacity: number, modifier: Buffer['modifier']) {
  const buffer = useMemo(() => {
    const slots = Array.from({ length: capacity }, (): BufferSlot => {
      if (kind === 'colors') return new Float32Array([0, 0, 0, 1]);
      return {
        values: kind === 'rects' ? [0, 0, 0, 0] : [1, 0, 0, 0],
        setXYWH(...values: number[]) { this.values = values; },
        set(...values: number[]) { this.values = values; },
      };
    });
    const value = { name: `buffer:${kind}`, shared: shared(slots, `buffer:${kind}`), peek: () => slots, modifier };
    buffers.push(value);
    return value;
  }, [capacity]);
  buffer.modifier = modifier;
  return buffer.shared;
}

function useMapper(prepare: Mapper['prepare'], react?: Mapper['react']) {
  const mapper = useMemo(() => {
    const value: Mapper = { prepare, inputs: new Set(), react };
    mappers.push(value);
    return value;
  }, []);
  mapper.prepare = prepare;
  mapper.react = react;
  return { value: undefined };
}

function runMappers(): void {
  for (const mapper of mappers) {
    mapper.inputs.clear();
    reading = mapper.inputs;
    const value = mapper.prepare();
    reading = undefined;
    mapper.react?.(value);
  }
}

function runBufferModifiers(): void {
  for (const buffer of buffers) buffer.peek().forEach(buffer.modifier);
}

function deliverRequests(): void {
  for (const request of requests.splice(0)) request();
}

function assertPublishedTogether(names: string[]): void {
  assert.deepEqual(publications.map(({ name }) => name).sort(), names.map((name) => `buffer:${name}`).sort());
  for (const publication of publications) {
    assert.equal(publication.force, true, 'host-object mutations force publication');
    assert.deepEqual(publication.snapshot, snapshot(), 'all writes finish before the first publication');
  }
}

function assertInputsAreReadOnly(): void {
  for (const mapper of mappers) {
    assert.deepEqual([...mapper.inputs].filter((name) => /^(buffer|guard):/.test(name)), [],
      'output buffers and mutable request guards are not mapper inputs');
  }
}

const host = (tag: string) => ({ children, ...props }: Record<string, unknown>) => createElement(tag, props, children as never);
mock.module('@shopify/react-native-skia', { namedExports: {
  Atlas: host('atlas'), Group: host('group'), Picture: host('picture'), Skia: {},
  useRectBuffer: (capacity: number, modifier: Buffer['modifier']) => useBuffer('rects', capacity, modifier),
  useRSXformBuffer: (capacity: number, modifier: Buffer['modifier']) => useBuffer('xforms', capacity, modifier),
  useColorBuffer: (capacity: number, modifier: Buffer['modifier']) => useBuffer('colors', capacity, modifier),
} });
mock.module('react-native-reanimated', { namedExports: {
  useSharedValue: (initial: unknown) => useMemo(() => shared(initial,
    typeof initial === 'object' && initial !== null && 'ids' in initial ? 'window' : `guard:${nextGuard++}`), []),
  useDerivedValue: (fn: () => unknown) => useMapper(fn),
  useAnimatedReaction: (prepare: Mapper['prepare'], react: Mapper['react']) => useMapper(prepare, react),
} });
mock.module('react-native-worklets', { namedExports: {
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => requests.push(() => fn(...args)),
} });

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let SpriteBatch: typeof import('../src/react/sprites/SpriteBatch')['SpriteBatch'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let TileMapLayer2D: typeof import('../src/react/tilemap/TileMapLayer2D')['TileMapLayer2D'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let ParticleView: typeof import('../src/react/particles/ParticleView')['ParticleView'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let GameWorldContext: typeof import('../src/react/sprites/GameWorld2D')['GameWorldContext'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let core: typeof import('../src/index');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let tiles: typeof import('../src/tilemap/index');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let particles: typeof import('../src/particles/index');

before(async () => {
  ({ SpriteBatch } = await import('../src/react/sprites/SpriteBatch'));
  ({ TileMapLayer2D } = await import('../src/react/tilemap/TileMapLayer2D'));
  ({ ParticleView } = await import('../src/react/particles/ParticleView'));
  ({ GameWorldContext } = await import('../src/react/sprites/GameWorld2D'));
  core = await import('../src/index');
  tiles = await import('../src/tilemap/index');
  particles = await import('../src/particles/index');
});
beforeEach(() => {
  buffers.length = 0; mappers.length = 0; publications.length = 0; requests.length = 0;
  reading = undefined; nextGuard = 0;
});

async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(element); });
  runBufferModifiers();
  runMappers();
  return renderer;
}

function spriteProps() {
  const descriptor = core.spriteSheet(1, { frames: { f: { x: 8, y: 16, width: 16, height: 16 } }, animations: {} });
  return {
    scene: 'play', capacity: 2, source: { descriptor, frames: descriptor.frames, image: {} },
    commit: shared({ scene: 'play', current: [{ x: 20, y: 30 }] }, 'commit'), alpha: shared(0, 'alpha'),
    select: ({ current }: { current: readonly { x: number; y: number }[] }) => current,
    write: (writer: { set(index: number, frame: string, x: number, y: number, rotation: number, scale: number): void }, item: { x: number; y: number }, index: number) => writer.set(index, 'f', item.x, item.y, 0, 1),
  };
}

function tileProps() {
  const tileset = tiles.defineTileSet2D({ tiles: { grass: { frame: 'g' } } });
  const map = tiles.defineTileMap2D({ cellSize: { width: 16, height: 16 }, tileset,
    layers: [{ id: 'ground', width: 2, height: 2, data: [1, 0, 0, 1] }] });
  return { map, layer: 'ground', source: { image: {}, frames: { g: { x: 32, y: 48, width: 16, height: 16 } } }, width: 32, height: 32, overscan: 0 };
}

function worldViewport() {
  return shared<{ visibleLogicalBounds: { x: number; y: number; width: number; height: number } } | undefined>(
    { visibleLogicalBounds: { x: 0, y: 0, width: 32, height: 32 } }, 'viewport');
}

describe('GS-REACT-03 buffer publication', () => {
  it('publishes sprite rects and transforms after coherent move, hide and reappear writes', async () => {
    const props = spriteProps();
    const renderer = await mount(createElement(SpriteBatch as never, props as never));
    for (const items of [[{ x: 20, y: 30 }], [{ x: 60, y: 70 }], [], [{ x: 80, y: 90 }]]) {
      publications.length = 0;
      props.commit.value = { scene: 'play', current: items };
      runMappers();
      assertPublishedTogether(['rects', 'xforms']);
      assert.equal(snapshot()['buffer:rects']![0]![2], items.length === 0 ? 0 : 16);
    }
    publications.length = 0;
    props.commit.value = { scene: 'menu', current: [] };
    runMappers();
    assertPublishedTogether(['rects', 'xforms']);
    assert.ok(snapshot()['buffer:rects']!.every((rect) => rect[2] === 0));
    await act(async () => renderer.unmount());
  });

  it('keeps sprite outputs outside mapper inputs and rerender modifiers cannot erase written slots', async () => {
    const props = spriteProps();
    const renderer = await mount(createElement(SpriteBatch as never, props as never));
    assertInputsAreReadOnly();
    const before = snapshot();
    await act(async () => renderer.update(createElement(SpriteBatch as never, props as never)));
    runBufferModifiers();
    assert.deepEqual(snapshot(), before, 'a late Skia initializer cannot reset the authoritative writer output');
    await act(async () => renderer.unmount());
  });

  it('a late buffer modifier after a React rerender preserves visible sprite slots', async () => {
    const props = spriteProps();
    const renderer = await mount(createElement(SpriteBatch as never, props as never));
    const before = snapshot();
    await act(async () => renderer.update(createElement(SpriteBatch as never, props as never)));
    runBufferModifiers();
    assert.deepEqual(snapshot(), before);
    await act(async () => renderer.unmount());
  });

  it('publishes tile buffers after bounded window delivery and never subscribes to request guards', async () => {
    const props = tileProps();
    const viewport = worldViewport();
    const renderer = await mount(createElement(GameWorldContext.Provider, { value: { viewport } as never },
      createElement(TileMapLayer2D as never, props as never)));
    assert.equal(requests.length, 1);
    deliverRequests();
    publications.length = 0;
    runMappers();
    assertPublishedTogether(['rects', 'xforms']);
    assertInputsAreReadOnly();
    assert.ok(snapshot()['buffer:rects']!.some((rect) => rect[2] === 16));
    const before = snapshot();
    runBufferModifiers();
    assert.deepEqual(snapshot(), before);
    await act(async () => renderer.unmount());
  });

  it('hides and publishes existing tile slots while viewport or replacement window is unavailable', async () => {
    const props = tileProps();
    const viewport = worldViewport();
    const tree = (nextProps = props) => createElement(GameWorldContext.Provider, { value: { viewport } as never },
      createElement(TileMapLayer2D as never, nextProps as never));
    const renderer = await mount(tree());
    deliverRequests(); runMappers();
    viewport.value = undefined;
    publications.length = 0; runMappers();
    assert.ok(snapshot()['buffer:rects']!.every((rect) => rect[2] === 0), 'missing viewport clears old cells');
    assertPublishedTogether(['rects', 'xforms']);
    viewport.value = { visibleLogicalBounds: { x: 0, y: 0, width: 32, height: 32 } };
    runMappers();
    const replacement = { ...props, source: { image: {}, frames: { g: { x: 64, y: 48, width: 16, height: 16 } } } };
    await act(async () => renderer.update(tree(replacement)));
    publications.length = 0; runMappers();
    assert.ok(snapshot()['buffer:rects']!.every((rect) => rect[2] === 0), 'old source cannot remain while replacement window is pending');
    assertPublishedTogether(['rects', 'xforms']);
    assert.equal(requests.length, 1, 'one bounded request per generation');
    deliverRequests(); publications.length = 0; runMappers();
    assertPublishedTogether(['rects', 'xforms']);
    assert.equal(snapshot()['buffer:rects']![0]![0], 64);
    await act(async () => renderer.unmount());
  });

  it('hides old tile source slots immediately when a replacement generation awaits its window', async () => {
    const props = tileProps();
    const viewport = worldViewport();
    const tree = (nextProps = props) => createElement(GameWorldContext.Provider, { value: { viewport } as never },
      createElement(TileMapLayer2D as never, nextProps as never));
    const renderer = await mount(tree());
    deliverRequests(); runMappers();
    await act(async () => renderer.update(tree({ ...props, source: { image: {}, frames: { g: { x: 64, y: 48, width: 16, height: 16 } } } })));
    runMappers();
    assert.ok(snapshot()['buffer:rects']!.every((rect) => rect[2] === 0));
    await act(async () => renderer.unmount());
  });

  it('hides old tile slots while a same-generation window for a new visible region is pending', async () => {
    const props = tileProps();
    const map = tiles.defineTileMap2D({ cellSize: { width: 16, height: 16 }, tileset: props.map.tileset,
      layers: [{ id: 'ground', width: 8, height: 8, data: new Array(64).fill(1) }] });
    const viewport = worldViewport();
    const renderer = await mount(createElement(GameWorldContext.Provider, { value: { viewport } as never },
      createElement(TileMapLayer2D as never, { ...props, map } as never)));
    deliverRequests(); runMappers();
    assert.ok(snapshot()['buffer:rects']!.some((rect) => rect[2]! > 0));
    viewport.value = { visibleLogicalBounds: { x: 64, y: 64, width: 32, height: 32 } };
    publications.length = 0; runMappers();
    assert.ok(snapshot()['buffer:rects']!.every((rect) => rect[2] === 0));
    assert.equal(requests.length, 1);
    assertPublishedTogether(['rects', 'xforms']);
    await act(async () => renderer.unmount());
  });

  it('publishes particle rect, transform and faded color together and uses texture modulation', async () => {
    const effect = particles.defineParticleEffect({ capacity: 2, space: 'screen', overflow: 'drop-new',
      particle: { kind: 'sprite', sheet: 'sheet', frame: 'f', size: { width: 16, height: 16 } },
      burst: { count: 1 }, lifetimeSeconds: { min: 2, max: 2 }, speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 }, fadeOut: true });
    const system = particles.createParticleSystem({ effects: { spark: effect } });
    system.emit('spark', { position: { x: 20, y: 30 }, seed: 1 });
    const binding = system.bindPresentation();
    const presentation = { clock: shared(0, 'clock'), registry: shared(binding.buildUiRegistry(), 'registry') };
    const props = { system, effect: 'spark', width: 100, height: 100, presentation,
      spriteSource: { image: {}, frame: { x: 0, y: 0, width: 16, height: 16 } } };
    const renderer = await mount(createElement(ParticleView as never, props as never));
    assert.equal(renderer.root.findByType('atlas' as never).props.colorBlendMode, 'modulate');
    for (const [time, alpha] of [[1, 0.5], [2, 0]]) {
      presentation.clock.value = time!;
      publications.length = 0; runMappers();
      assertPublishedTogether(['rects', 'xforms', 'colors']);
      assert.equal(snapshot()['buffer:colors']![0]![3], alpha);
    }
    assertInputsAreReadOnly();
    const before = snapshot(); runBufferModifiers();
    assert.deepEqual(snapshot(), before);
    await act(async () => renderer.unmount());
    system.dispose();
  });
});
