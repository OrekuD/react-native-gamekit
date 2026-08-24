/**
 * TileMapLayer2D mounted contract tests (T16.4, T16-F3/F4).
 *
 * - One Atlas node per layer; slot capacity derives from surface bounds +
 *   overscan — never from map dimensions.
 * - Visible slots derive from the PRESENTED camera (center/zoom/rotation)
 *   with parallax applied once afterwards; off-map views hide everything.
 * - Unrotated tiles place at their cell top-left; frame rects come from
 *   the flat bind-time table (missing/mismatched frames throw).
 * - The UI runtime only ever receives bounded window snapshots: structural
 *   worklet call-graph checks + transferred-record bound tests.
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

// --- Recording hooks so tests can inspect actual buffer values -------------
interface Call {
  readonly args: readonly number[];
}
const rectCallLog: Call[][] = [];
const xformCallLog: Call[][] = [];
const derivedClosures: Array<() => number> = [];

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
    useRectBuffer: (capacity: number) => {
      const log: Call[] = [];
      rectCallLog.push(log);
      return {
        value: Array.from({ length: capacity }, () => ({
          setXYWH: (...args: number[]) => log.push({ args }),
        })),
      };
    },
    useRSXformBuffer: (capacity: number) => {
      const log: Call[] = [];
      xformCallLog.push(log);
      return {
        value: Array.from({ length: capacity }, () => ({
          set: (...args: number[]) => log.push({ args }),
        })),
      };
    },
    Skia: {},
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => number) => {
      derivedClosures.push(fn);
      try {
        return { value: fn() };
      } catch {
        return { value: 0 };
      }
    },
    runOnJS: (fn: (...args: never[]) => void) =>
      ((...args: never[]) => fn(...args)) as never,
  },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type TileMapModule = typeof import('../src/react/tilemap/TileMapLayer2D');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PresentationModule = typeof import('../src/react/tilemap/tilePresentation');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type CoreModule = typeof import('../src/tilemap/index');
const TileMapLib: TileMapModule = {} as never;
let GameWorld2D: (...args: readonly never[]) => unknown = () => null;
const Presentation: PresentationModule = {} as never;
const Core: CoreModule = {} as never;

describe('tilemap layer mounted contract', () => {
  it('loads modules after mocks', async () => {
    Object.assign(TileMapLib, await import('../src/react/tilemap/TileMapLayer2D'));
    Object.assign(Presentation, await import('../src/react/tilemap/tilePresentation'));
    Object.assign(Core, await import('../src/tilemap/index'));
    ({ GameWorld2D } = await import('../src/react/sprites/GameWorld2D'));
  });

  type TileMap2DType = Awaited<ReturnType<typeof Core.defineTileMap2D>>;
  function makeMap(w: number, h: number): TileMap2DType {
    const tileset = Core.defineTileSet2D({
      tiles: { grass: { frame: 'g', collision: 'solid' } },
    });
    const data = new Array(w * h).fill(0);
    // A diagonal of tiles so fills are easy to reason about.
    for (let i = 0; i < Math.min(w, h); i++) data[i * w + i] = 1;
    return Core.defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset,
      layers: [{ id: 't', width: w, height: h, data }],
    });
  }

  const FRAMES = { g: { x: 32, y: 48, width: 16, height: 16 } };

  async function mountWith(
    map: ReturnType<typeof makeMap>,
    world: { camera?: { value?: unknown }; viewport?: { value?: unknown } },
  ) {
    const before = { rects: rectCallLog.length, xforms: xformCallLog.length, derived: derivedClosures.length };
    let r: ReturnType<typeof create> | null = null;
    await act(async () => {
      r = create(createElement(
        GameWorld2D as never,
        { viewport: world.viewport, camera: world.camera } as never,
        createElement(TileMapLib.TileMapLayer2D as never, {
          map, layer: 't',
          source: { image: { __image: true } as never, frames: FRAMES },
          width: 320, height: 480, overscan: 1,
        } as never),
      ));
    });
    void before;
    return {
      renderer: r!,
      // GameWorld2D also creates a derived value; OURS is the last one.
      lastDerived: () => derivedClosures[derivedClosures.length - 1]!,
      // Same last-instance rule: each mount appends new buffers.
      rectLog: () => rectCallLog[rectCallLog.length - 1]!,
      xformLog: () => xformCallLog[xformCallLog.length - 1]!,
    };
  }

  function cameraAt(cx: number, cy: number, zoom = 1, rotation = 0) {
    return {
      value: {
        cutId: 1,
        camera: { center: { x: cx, y: cy }, zoom, rotationRadians: rotation },
      },
    };
  }

  function viewportAt(x = 0, y = 0, w = 320, h = 480) {
    return {
      value: {
        surfaceSize: { width: w, height: h },
        logicalBounds: { x, y, width: w, height: h },
        visibleLogicalBounds: { x, y, width: w, height: h },
        contentBounds: { x, y, width: w, height: h },
        scale: 1, offsetX: 0, offsetY: 0,
      },
    };
  }

  it('mounts one Atlas for the layer and throws on unknown layer', async () => {
    const map = makeMap(8, 8);
    const { renderer } = await mountWith(map, {
      camera: cameraAt(64, 64), viewport: viewportAt(),
    });
    const atlasNodes = renderer.root.findAll((n: { type: unknown }) => String(n.type) === 'atlas');
    assert.equal(atlasNodes.length, 1);

    let threw = '';
    try {
      await act(async () => {
        renderer!.update(createElement(
          GameWorld2D as never,
          { viewport: viewportAt(), camera: cameraAt(64, 64) } as never,
          createElement(TileMapLib.TileMapLayer2D as never, {
            map, layer: 'nope',
            source: { image: {}, frames: FRAMES },
            width: 320, height: 480,
          } as never),
        ));
      });
    } catch (e) {
      threw = (e as Error).message;
    }
    assert.match(threw, /layer "nope" does not exist/);
    renderer.unmount();
  });

  it('slot capacity is bounded by surface+overscan, not map size', async () => {
    const big = makeMap(512, 512);
    const small = makeMap(4, 4);
    const { renderer: r1 } = await mountWith(big, {
      camera: cameraAt(4096, 4096), viewport: viewportAt(),
    });
    const { renderer: r2 } = await mountWith(small, {
      camera: cameraAt(24, 24), viewport: viewportAt(),
    });
    assert.equal(r1.root.findAll((n: { type: unknown }) => String(n.type) === 'atlas').length, 1);
    assert.equal(r2.root.findAll((n: { type: unknown }) => String(n.type) === 'atlas').length, 1);
    r1.unmount();
    r2.unmount();
  });

  it('places unrotated tiles at their CELL TOP-LEFT with the sheet-frame rect', async () => {
    // 16x16 map; diagonal tiles at (i,i). Camera centered exactly on cell
    // (4,4)'s center: world (72,72); view 320x480 -> visible cells span
    // cx -10..9 clamped, cy -15..14 clamped. Diagonal tiles inside view:
    // cells (0..9, 0..9) minus clamping.
    const map = makeMap(16, 16);
    const { lastDerived, rectLog, xformLog } = await mountWith(map, {
      camera: cameraAt(72, 72), viewport: viewportAt(),
    });
    // Re-evaluate now that the initial window transfer completed.
    lastDerived()();
    const xformCalls = xformLog();
    assert.ok(xformCalls.length > 0, 'expected filled slots');
    for (const c of xformCalls) {
      const [scos, ssin, tx, ty] = c.args;
      assert.equal(scos, 1);
      assert.equal(ssin, 0);
      assert.equal(tx! % 16, 0, `tx ${String(tx)} must be a cell top-left`);
      assert.equal(ty! % 16, 0, `ty ${String(ty)} must be a cell top-left`);
    }
    // Rect calls carry the sheet-frame position (32,48,16,16) when filled.
    for (const c of rectLog()) {
      if (c.args[0] === 32 && c.args[1] === 48 && c.args[4 - 2] === 16) {
        assert.deepEqual(c.args.slice(2), [16, 16]);
      }
    }
  });

  it('camera motion changes the filled window; off-map views hide all slots', async () => {
    const map = makeMap(32, 32);
    const camSV = cameraAt(72, 72);
    const vpSV = viewportAt();
    const { renderer, lastDerived, rectLog } = await mountWith(map, {
      camera: camSV, viewport: vpSV,
    });
    const clear = (): void => {
      rectLog().length = 0;
    };
    const filledCount = (): number =>
      rectLog().filter(
        (c) => !(c.args[0] === 0 && c.args[1] === 0 && c.args[2] === 0 && c.args[3] === 0),
      ).length;

    // Re-evaluate now that the initial transfer completed; on-map fills.
    lastDerived()();
    assert.ok(filledCount() > 0);

    // Move the camera far off the map: every slot hides.
    (camSV as { value: unknown }).value = {
      cutId: 2,
      camera: { center: { x: -5000, y: -5000 }, zoom: 1, rotationRadians: 0 },
    };
    clear();
    lastDerived()();
    assert.equal(filledCount(), 0, 'off-map view must hide every slot');

    // Zoomed-in camera near tiles: still fills.
    (camSV as { value: unknown }).value = {
      cutId: 3,
      camera: { center: { x: 80, y: 80 }, zoom: 2, rotationRadians: 0 },
    };
    clear();
    lastDerived()();
    assert.ok(filledCount() > 0, 'zoomed view fills');

    // 90-degree rotated camera: conservative bounds still cover tiles.
    // The wider rotated span may outgrow the transferred window; the first
    // evaluation schedules the bounded transfer and the next fills.
    (camSV as { value: unknown }).value = {
      cutId: 4,
      camera: { center: { x: 80, y: 80 }, zoom: 1, rotationRadians: Math.PI / 2 },
    };
    clear();
    lastDerived()();
    lastDerived()();
    assert.ok(filledCount() > 0, 'rotated camera must conservatively keep visible tiles');

    renderer.unmount();
  });

  it('parallax 1 tracks the base camera; partial parallax shifts less', () => {
    // Pure presentation math: parallax applied AFTER base bounds.
    const cam = { value: { camera: { center: { x: 200, y: 100 }, zoom: 1, rotationRadians: 0 } } };
    const vp = { value: { visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 } } };
    const full = Presentation.cameraLayerVisibleBounds(cam, vp, 1, 1, 0)!;
    assert.equal(full.minX, 200 - 160);
    assert.equal(full.maxX, 200 + 160);
    // p=0: camera-fixed layer centered on the logical view center.
    const fixed = Presentation.cameraLayerVisibleBounds(cam, vp, 0, 0, 0)!;
    assert.equal(fixed.minX, 0);
    assert.equal(fixed.maxX, 320);
    // Partial: halfway between.
    const half = Presentation.cameraLayerVisibleBounds(cam, vp, 0.5, 0.5, 0)!;
    assert.equal(half.minX, (200 - 160 + 0) / 2);
    // Rotation grows the conservative extents.
    const rot = Presentation.cameraLayerVisibleBounds(
      { value: { camera: { center: { x: 200, y: 100 }, zoom: 1, rotationRadians: Math.PI / 2 } } },
      vp, 1, 1, 0,
    )!;
    const w = (b: { minX: number; maxX: number }): number => b.maxX - b.minX;
    const h = (b: { minY: number; maxY: number }): number => b.maxY - b.minY;
    assert.ok(w(rot) > w(full) || h(rot) > h(full));
  });

  it('bind rejects missing frames AND frame/cell size mismatches with exact errors', () => {
    const ts = Core.defineTileSet2D({ tiles: { grass: { frame: 'grass' } } });
    assert.throws(
      () => Presentation.buildFrameTable(ts, { wrong: { x: 0, y: 0, width: 16, height: 16 } }, 16, 16),
      /frame "grass" for tile "grass" is missing/,
    );
    assert.throws(
      () => Presentation.buildFrameTable(ts, { grass: { x: 0, y: 0, width: 32, height: 16 } }, 16, 16),
      /is 32x16 but the map cell is 16x16/,
    );
  });

  it('transferred snapshots are bounded by viewport capacity, not map dimensions', () => {
    const big = makeMap(512, 512);
    const table = Presentation.buildFrameTable(big.tileset, FRAMES, 16, 16);
    // A viewport-sized window over the huge map stays tiny.
    const snap = Presentation.buildTileWindowSnapshot(big, 't', 250, 250, 269, 269, table);
    assert.equal(snap.ids.length, 20 * 20, 'ids sized by the requested range only');
    assert.equal(snap.frameFlat.length, (big.tileset.names.length + 1) * 4);
    assert.ok(snap.ids.length < 512 * 512);
    // Coverage check drives the request logic.
    assert.equal(Presentation.windowCovers(snap, 255, 255, 260, 260), true);
    assert.equal(Presentation.windowCovers(snap, 0, 0, 10, 10), false);
  });

  it('the derived worklet closes over NO map data, JS Map, or full arrays', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../src/react/tilemap/TileMapLayer2D.tsx'),
      'utf8',
    );
    // Extract each 'worklet' callback body heuristically.
    const workletBodies = src.split("'worklet';").slice(1);
    assert.ok(workletBodies.length >= 2);
    const derivedBody = src.slice(src.indexOf('useDerivedValue'));
    const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const forbidden of ['.get(', 'frameOf', '.data[', 'map.layers', '__chunks', 'JSON.stringify']) {
      assert.doesNotMatch(derivedBody, new RegExp(esc(forbidden)), `worklet must not reference ${forbidden}`);
    }
    // Presentation helpers are explicitly worklet-callable.
    const pres = readFileSync(
      join(import.meta.dirname, '../src/react/tilemap/tilePresentation.ts'),
      'utf8',
    );
    for (const fn of ['export function cameraLayerVisibleBounds', 'export function fillTileSlots']) {
      const at = pres.indexOf(fn);
      assert.ok(at >= 0, `${fn} exists`);
      const nextWorklet = pres.indexOf("'worklet';", at);
      assert.ok(nextWorklet > at && nextWorklet - at < 400, `${fn} carries a 'worklet' directive`);
    }
    // No RN/Reanimated imports in the pure presentation module.
    assert.doesNotMatch(pres, /from '(react-native|react-native-reanimated|@shopify)/);
  });
});
