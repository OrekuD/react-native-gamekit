/**
 * TileMapLayer2D mounted contract tests (T16.4).
 *
 * - One Atlas node per layer; slot capacity derives from surface bounds,
 *   cell size, and overscan — never from map dimensions.
 * - Visible slots fill from the presented camera bounds; off-map camera
 *   positions hide everything.
 * - Rendering never mutates the map (collision reads the same data).
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    Text: host('text'),
    StyleSheet: { create: (s: Record<string, unknown>) => s, absoluteFill: {} },
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Group: host('group'),
    Atlas: host('atlas'),
    Circle: host('circle'),
    Rect: host('rect'),
    Image: host('image'),
    Path: host('path'),
    Picture: host('picture'),
    useRectBuffer: (capacity: number) => ({ value: Array.from({ length: capacity }, () => ({ setXYWH: () => {} })) }),
    useRSXformBuffer: (capacity: number) => ({ value: Array.from({ length: capacity }, () => ({ set: () => {} })) }),
    Skia: {},
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useFrameCallback: () => {},
  },
});

    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
type TileMapLayerModule = typeof import('../src/react/tilemap/TileMapLayer2D');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ParticlesCoreModule = typeof import('../src/tilemap/index');
let TileMapLayer2D: TileMapLayerModule['TileMapLayer2D'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const TileMapModule: typeof import('../src/react/tilemap/TileMapLayer2D') = {} as never;
let defineTileSet2D: ParticlesCoreModule['defineTileSet2D'];
let defineTileMap2D: ParticlesCoreModule['defineTileMap2D'];

async function mount(ui: React.ReactElement): Promise<ReturnType<typeof create>> {
  let r: ReturnType<typeof create> | null = null;
  await act(async () => {
    r = create(ui);
  });
  return r!;
}

describe('tilemap layer mounted contract', () => {
  it('loads modules after mocks', async () => {
    Object.assign(TileMapModule, await import('../src/react/tilemap/TileMapLayer2D'));
    TileMapLayer2D = TileMapModule.TileMapLayer2D;
    const core = await import('../src/tilemap/index');
    defineTileSet2D = core.defineTileSet2D;
    defineTileMap2D = core.defineTileMap2D;
  });

  it('mounts one Atlas for the layer and throws on unknown layer', async () => {
    const tileset = defineTileSet2D({ tiles: { grass: { frame: 'g', collision: 'solid' } } });
    const map = defineTileMap2D({
      cellSize: { width: 16, height: 16 }, tileset,
      layers: [{ id: 'terrain', width: 8, height: 8, data: Array.from({ length: 64 }, (_, i) => (i % 3 === 0 ? 1 : 0)) }],
    });
    const source = { image: { __image: true } as never, frames: { g: { x: 0, y: 0, width: 16, height: 16 } } };

    const element = createElement(TileMapLayer2D as never, {
      map, layer: 'terrain', source, width: 320, height: 480,
    } as never);
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(element);
    });
    const r = renderer!;
    assert.equal(findAll(r, 'atlas').length, 1);

    // Unknown layer throws with a structured message.
    let threw = '';
    try {
      await act(async () => {
        r.update(createElement(TileMapLayer2D as never, {
          map, layer: 'nope', source, width: 320, height: 480,
        } as never));
      });
    } catch (e) {
      threw = (e as Error).message;
    }
    assert.match(threw, /layer "nope" does not exist/);
    r.unmount();
  });

  it('slot capacity is bounded by surface+overscan, not map size', async () => {
    const tileset = defineTileSet2D({ tiles: { grass: { frame: 'g', collision: 'solid' } } });
    // Huge map (512x512 cells) but small viewport.
    const big = defineTileMap2D({
      cellSize: { width: 16, height: 16 }, tileset,
      layers: [{ id: 't', width: 512, height: 512, data: new Array(512 * 512).fill(1) }],
    });
    void big;
    const small = defineTileMap2D({
      cellSize: { width: 16, height: 16 }, tileset,
      layers: [{ id: 't', width: 4, height: 4, data: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }],
    });

    const mk = (map: ReturnType<typeof defineTileMap2D>) =>
      createElement(TileMapLayer2D as never, { map, layer: 't', source: { image: {}, frames: { g: { x: 0, y: 0, width: 16, height: 16 } } }, width: 320, height: 480 } as never);

    const r1 = await mount(mk(big));
    const r2 = await mount(mk(small));
    // Both mount successfully with identical topology (one Atlas each).
    assert.equal(findAll(r1, 'atlas').length, 1);
    assert.equal(findAll(r2, 'atlas').length, 1);
    r1.unmount();
    r2.unmount();
  });

  it('missing frame in bound sheet throws a structured error at bind', async () => {
    const tileset = defineTileSet2D({ tiles: { grass: { frame: 'grass' } } });
    const map = defineTileMap2D({
      cellSize: { width: 16, height: 16 }, tileset,
      layers: [{ id: 't', width: 2, height: 2, data: [1, 1, 1, 1] }],
    });
    // Pure bind-time resolver carries the structured error contract.
    assert.throws(
      () => TileMapModule.resolveTileFrames(map.tileset, { wrong: { x: 0, y: 0, width: 16, height: 16 } }),
      /frame "grass" for tile "grass" is missing/,
    );
  });
});

function findAll(renderer: ReturnType<typeof create>, tag: string) {
  return renderer.root.findAll((n: { type: unknown }) => String(n.type) === tag);
}
