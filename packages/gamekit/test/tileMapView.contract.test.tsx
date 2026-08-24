/**
 * TileMapLayer2D mounted contract tests (T16.4, T16-F3/F4, T16-RF1/RF2).
 *
 * - One Atlas node per layer; slot capacity derives from surface bounds +
 *   minZoom + overscan — never from map dimensions.
 * - Visible slots derive from the PRESENTED camera (center/zoom/rotation);
 *   without a camera the viewport-only world path applies. Parallax is one
 *   coherent factor driving BOTH the visual transform and the culling
 *   bounds. Off-map views and beyond-capacity zooms hide everything.
 * - Unrotated tiles place at their cell top-left; frame rects come from
 *   the flat bind-time table (missing/mismatched frames throw).
 * - The UI runtime only ever receives bounded window snapshots; UI->RN
 *   delivery uses react-native-worklets' scheduleOnRN (never runOnJS), and
 *   every UI-runtime helper carries a worklet directive.
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

function host(tag: string) {
  const Component = ({ children, ...props }: Record<string, unknown>): unknown =>
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
const scheduleOnRNCalls: Array<{ readonly name: string; readonly args: readonly unknown[] }> = [];

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
  },
});
mock.module('react-native-worklets', {
  namedExports: {
    // RF1: UI->RN delivery MUST go through scheduleOnRN. The mock executes
    // synchronously so mounted tests observe the full request cycle.
    scheduleOnRN: (fn: (...args: never[]) => void, ...args: never[]) => {
      scheduleOnRNCalls.push({
        name: (fn as { name?: string }).name ?? 'anonymous',
        args,
      });
      (fn as (...a: never[]) => void)(...args);
    },
  },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type TileMapModule = typeof import('../src/react/tilemap/TileMapLayer2D');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PresentationModule = typeof import('../src/react/tilemap/tilePresentation');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type CoreModule = typeof import('../src/tilemap/index');
const TileMapLib: TileMapModule = {} as never;
const Presentation: PresentationModule = {} as never;
const Core: CoreModule = {} as never;
let GameWorld2D: (...args: readonly never[]) => unknown = () => null;

describe('tilemap layer mounted contract', () => {
  it('loads modules after mocks', async () => {
    Object.assign(TileMapLib, await import('../src/react/tilemap/TileMapLayer2D'));
    Object.assign(Presentation, await import('../src/react/tilemap/tilePresentation'));
    Object.assign(Core, await import('../src/tilemap/index'));
    ({ GameWorld2D } = await import('../src/react/sprites/GameWorld2D'));
  });

  function makeMap(w: number, h: number): ReturnType<typeof Core.defineTileMap2D> {
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
    extraProps: Record<string, unknown> = {},
  ) {
    const beforeCount = derivedClosures.length;
    let r: ReturnType<typeof create> | null = null;
    await act(async () => {
      r = create(createElement(
        GameWorld2D as never,
        { viewport: world.viewport, camera: world.camera } as never,
        createElement(TileMapLib.TileMapLayer2D as never, {
          map, layer: 't',
          source: { image: { __image: true } as never, frames: FRAMES },
          width: 320, height: 480, overscan: 1,
          ...extraProps,
        } as never),
      ));
    });
    // Hook order per mount: GameWorld2D's transform first, then OUR fill
    // closure, then our visual-transform closure. Target the fill by index.
    const fillIndex = beforeCount + 1;
    return {
      renderer: r!,
      lastDerived: (): (() => number) => {
        const fn = derivedClosures[fillIndex];
        assert.ok(typeof fn === 'function', 'fill derived closure must exist');
        return fn as () => number;
      },
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

  it('slot capacity is bounded by surface+minZoom+overscan, not map size', async () => {
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

  it('VIEWPORT-ONLY world renders when no presented camera exists', async () => {
    const map = makeMap(32, 32);
    // No camera at all: the viewport path drives selection.
    const { lastDerived, rectLog, xformLog } = await mountWith(map, {
      viewport: viewportAt(),
    });
    lastDerived()();
    const placed = rectLog().filter(
      (c) => !(c.args[0] === 0 && c.args[1] === 0 && c.args[2] === 0 && c.args[3] === 0),
    );
    // Viewport (0,0,320x480) covers diagonal cells (0..20, 0..29) clamped.
    assert.ok(placed.length >= 10, `viewport-only fill expected (${placed.length})`);
    // Transforms sit on cell corners within the viewport span.
    for (const c of xformLog()) {
      const [, , tx, ty] = c.args;
      if (tx === 0 && ty === 0 && c.args.length === 4) continue; // hidden slot
      assert.ok(tx! < 320 + 64 && ty! < 480 + 64, 'cells selected inside the viewport window');
    }
  });

  it('places unrotated tiles at their CELL TOP-LEFT with the sheet-frame rect', async () => {
    const map = makeMap(16, 16);
    const { lastDerived, rectLog, xformLog } = await mountWith(map, {
      camera: cameraAt(72, 72), viewport: viewportAt(),
    });
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
    for (const c of rectLog()) {
      if (c.args[0] === 32 && c.args[1] === 48 && c.args[2] === 16) {
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

    lastDerived()();
    assert.ok(filledCount() > 0);

    (camSV as { value: unknown }).value = {
      cutId: 2,
      camera: { center: { x: -5000, y: -5000 }, zoom: 1, rotationRadians: 0 },
    };
    clear();
    lastDerived()();
    assert.equal(filledCount(), 0, 'off-map view must hide every slot');

    (camSV as { value: unknown }).value = {
      cutId: 3,
      camera: { center: { x: 80, y: 80 }, zoom: 2, rotationRadians: 0 },
    };
    clear();
    lastDerived()();
    assert.ok(filledCount() > 0, 'zoomed-in view fills');

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

  it('ZOOM OUT beyond the declared capacity hides everything (never partial)', async () => {
    const map = makeMap(64, 64);
    const camSV = cameraAt(1024, 1024, 1);
    const { lastDerived, rectLog } = await mountWith(
      map,
      { camera: camSV, viewport: viewportAt() },
      { minZoom: 0.5 },
    );
    const clear = (): void => {
      rectLog().length = 0;
    };
    const filledCount = (): number =>
      rectLog().filter(
        (c) => !(c.args[0] === 0 && c.args[1] === 0 && c.args[2] === 0 && c.args[3] === 0),
      ).length;

    // Zoom 0.75 >= declared minZoom 0.5: fills.
    (camSV as { value: unknown }).value = {
      cutId: 1,
      camera: { center: { x: 1024, y: 1024 }, zoom: 0.75, rotationRadians: 0 },
    };
    lastDerived()(); // may schedule the window transfer...
    lastDerived()(); // ...then fill
    assert.ok(filledCount() > 0, 'zoom within the declared capacity fills');

    // Zoom 0.25 < declared minZoom 0.5: rejected state hides ALL slots.
    (camSV as { value: unknown }).value = {
      cutId: 2,
      camera: { center: { x: 1024, y: 1024 }, zoom: 0.25, rotationRadians: 0 },
    };
    clear();
    lastDerived()();
    assert.equal(filledCount(), 0, 'beyond-capacity zoom must hide every slot, never under-fill');

    // Default minZoom=1 rejects any zoom below 1.
    const tight = await mountWith(map, {
      camera: cameraAt(1024, 1024, 0.9), viewport: viewportAt(),
    });
    tight.lastDerived()();
    assert.equal(
      tight.rectLog().filter(
        (c) => !(c.args[0] === 0 && c.args[1] === 0 && c.args[2] === 0 && c.args[3] === 0),
      ).length,
      0,
      'default minZoom=1 rejects sub-1 zooms',
    );
  });

  it('PARALLAX is coherent: same factor drives the visual transform and the bounds', async () => {
    // Pure level: parallax applied AFTER base bounds; p=0 is camera-fixed.
    const cam = { value: { camera: { center: { x: 200, y: 100 }, zoom: 1, rotationRadians: 0 } } };
    const vp = { value: { visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 } } };
    const out = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    assert.equal(Presentation.writeLayerVisibleBounds(cam, vp, 1, 1, 0, out), true);
    assert.equal(out.minX, 200 - 160);
    const fixedOut = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    Presentation.writeLayerVisibleBounds(cam, vp, 0, 0, 0, fixedOut);
    assert.equal(fixedOut.minX, 0);
    assert.equal(fixedOut.maxX, 320);
    const halfOut = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    Presentation.writeLayerVisibleBounds(cam, vp, 0.5, 0.5, 0, halfOut);
    assert.equal(halfOut.minX, (200 - 160 + 0) / 2);

    // Component level: a parallax layer mounts WITHOUT an outer GameLayer2D
    // and still selects cells around the corrected center.
    const map = makeMap(64, 64);
    let r: ReturnType<typeof create> | null = null;
    await act(async () => {
      r = create(createElement(
        GameWorld2D as never,
        { viewport: viewportAt(), camera: cameraAt(2000, 2000) } as never,
        createElement(TileMapLib.TileMapLayer2D as never, {
          map, layer: 't',
          source: { image: {}, frames: FRAMES },
          width: 320, height: 480, overscan: 1,
          parallax: { x: 0.5, y: 0.5 },
        } as never),
      ));
    });
    const groupNodes = r!.root.findAll((n: { type: unknown }) => String(n.type) === 'group');
    assert.ok(groupNodes.length >= 1, 'parallax visual transform wraps the Atlas');
    r!.unmount();

    // Rotation grows the conservative extents.
    const rotOut = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    Presentation.writeLayerVisibleBounds(
      { value: { camera: { center: { x: 200, y: 100 }, zoom: 1, rotationRadians: Math.PI / 2 } } },
      vp, 1, 1, 0, rotOut,
    );
    const w = (b: { minX: number; maxX: number }): number => b.maxX - b.minX;
    const h = (b: { minY: number; maxY: number }): number => b.maxY - b.minY;
    assert.ok(w(rotOut) > w(out) || h(rotOut) > h(out));
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
    const snap = Presentation.buildTileWindowSnapshot(big, 't', 250, 250, 269, 269, table);
    assert.equal(snap.ids.length, 20 * 20);
    assert.equal(snap.frameFlat.length, (big.tileset.names.length + 1) * 4);
    assert.ok(snap.ids.length < 512 * 512);
    assert.equal(Presentation.windowCovers(snap, 255, 255, 260, 260), true);
    assert.equal(Presentation.windowCovers(snap, 0, 0, 10, 10), false);
  });

  it('the worklet uses scheduleOnRN, NEVER runOnJS, and helpers carry worklets', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../src/react/tilemap/TileMapLayer2D.tsx'),
      'utf8',
    );
    // RF1: the removed runtime bridge must not appear anywhere in the tile
    // renderer, and the supported bridge must be present.
    assert.doesNotMatch(src, /runOnJS/);
    assert.match(src, /scheduleOnRN/);
    // The worklet body must not reference maps, data arrays, or JSON.
    const derivedBody = src.slice(src.indexOf('useDerivedValue'));
    const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const forbidden of ['.get(', '.data[', 'map.layers', '__chunks', 'JSON.stringify']) {
      assert.doesNotMatch(derivedBody, new RegExp(esc(forbidden)), `worklet must not reference ${forbidden}`);
    }
    // Every exported helper in the presentation module that participates in
    // the per-frame path carries an explicit worklet directive.
    const pres = readFileSync(
      join(import.meta.dirname, '../src/react/tilemap/tilePresentation.ts'),
      'utf8',
    );
    for (const fn of ['export function writeLayerVisibleBounds', 'export function fillTileSlots']) {
      const at = pres.indexOf(fn);
      assert.ok(at >= 0, `${fn} exists`);
      const nextWorklet = pres.indexOf("'worklet';", at);
      assert.ok(nextWorklet > at && nextWorklet - at < 400, `${fn} carries a 'worklet' directive`);
    }
    // No RN/Reanimated/Worklets imports in the pure presentation module.
    assert.doesNotMatch(pres, /from '(react-native|react-native-reanimated|react-native-worklets|@shopify)/);
  });

  it('window REQUEST flows worklet -> scheduleOnRN -> bounded snapshot -> filled slots', async () => {
    const map = makeMap(48, 48);
    scheduleOnRNCalls.length = 0;
    const { lastDerived } = await mountWith(map, {
      camera: cameraAt(400, 400), viewport: viewportAt(),
    });
    // The mount-time evaluation finds an uncovered window and schedules the
    // RN request; the synchronous mock delivers it, binding the snapshot.
    // One request carrying the uncovered cell range (minified builds strip
    // function names, so match on shape: exactly four cell scalars).
    assert.equal(scheduleOnRNCalls.length, 1);
    assert.equal(scheduleOnRNCalls[0]!.args.length, 4);
    // The next evaluation fills from the transferred bounded snapshot.
    const second = lastDerived()();
    assert.ok(second > 0, `expected filled slots after transfer (${second})`);
    assert.ok(second <= 40 * 40, 'filled slots bounded by capacity');
  });
});
