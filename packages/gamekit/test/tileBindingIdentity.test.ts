/**
 * GS-TILE-01 binding-identity tests.
 *
 * The tile-layer UI update runs headlessly here with fake shared values,
 * buffers, and a controllable request bridge: stale deliveries, same-size
 * replacements, and per-binding pending state are all observable without a
 * native runtime.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_TILE_WINDOW,
  bindingGeneration,
  buildTileWindowSnapshot,
  updateTileLayerUI,
  type TileLayerUIParams,
  type TileWindowSnapshot,
} from '../src/react/tilemap/tilePresentation';
import { defineTileMap2D, defineTileSet2D } from '../src/tilemap/definitions';

function tileset() {
  return defineTileSet2D({ tiles: { solid: { frame: 's', collision: 'solid' } } });
}

function mapWithRow(idValue: number) {
  return defineTileMap2D({
    cellSize: { width: 16, height: 16 },
    tileset: tileset(),
    layers: [{ id: 't', width: 4, height: 4, data: [0, 0, 0, 0, idValue, idValue, idValue, idValue, 0, 0, 0, 0, 0, 0, 0, 0] }],
  });
}

const FRAME_FLAT = Object.freeze([0, 0, 0, 0, 0, 0, 16, 16]);

interface Harness {
  params: TileLayerUIParams;
  window: { value: TileWindowSnapshot };
  pendingGen: { value: number };
  rectWrites: Array<readonly [number, number, number, number]>;
  xformWrites: Array<readonly [number, number, number, number]>;
  requested: Array<() => void>;
  warned: string[];
}

interface SharedSlot {
  window: { value: TileWindowSnapshot };
  pendingGen: { value: number };
}

function harness(generation: number, shared?: SharedSlot): Harness {
  const window = shared?.window ?? { value: EMPTY_TILE_WINDOW };
  const pendingGen = shared?.pendingGen ?? { value: -1 };
  const warnedCapacity = { value: false };
  const capacityWarnPending = { value: false };
  const rectWrites: Array<readonly [number, number, number, number]> = [];
  const xformWrites: Array<readonly [number, number, number, number]> = [];
  const rects = {
    value: Array.from({ length: 64 }, () => ({
      setXYWH: (x: number, y: number, w: number, h: number) => {
        rectWrites.push([x, y, w, h]);
      },
    })),
  };
  const xforms = {
    value: Array.from({ length: 64 }, () => ({
      set: (a: number, b: number, c: number, d: number) => {
        xformWrites.push([a, b, c, d]);
      },
    })),
  };
  const requested: Array<() => void> = [];
  const warned: string[] = [];
  const params: TileLayerUIParams = {
    camera: null,
    viewport: { value: { visibleLogicalBounds: { x: 0, y: 0, width: 64, height: 64 } } },
    window,
    pendingGen,
    warnedCapacity,
    capacityWarnPending,
    rects,
    xforms,
    requestWindow: (gen, x0, y0, x1, y1) => {
      const map = mapWithRow(1);
      const snapshot = buildTileWindowSnapshot(map, 't', x0, y0, x1, y1, FRAME_FLAT);
      window.value = Object.freeze({ ...snapshot, gen });
      if (pendingGen.value === gen) {
        pendingGen.value = -1;
      }
    },
    scheduleOnRN: (fn) => {
      requested.push(fn);
    },
    onBeyondCapacity: () => {
      warned.push('beyond-capacity');
    },
    generation,
    capacity: 64,
    originX: 0,
    originY: 0,
    cw: 16,
    ch: 16,
    layerWidth: 4,
    layerHeight: 4,
    padWorld: 16,
    px: 1,
    py: 1,
    minZoom: 1,
  };
  return { params, window, pendingGen, rectWrites, xformWrites, requested, warned };
}

describe('GS-TILE-01 tile-window binding identity', () => {
  it('bindings get distinct stable generations from identity alone', () => {
    const key = {};
    assert.equal(bindingGeneration(key), bindingGeneration(key), 'one binding keeps its generation');
    assert.notEqual(bindingGeneration({}), bindingGeneration({}), 'each binding mints one generation');
  });

  it('a same-size replacement while delayed shows no old tiles', () => {
    const first = harness(1);
    // First binding requests its window; the bridge holds the delivery.
    assert.equal(updateTileLayerUI(first.params), -1, 'missing window requests');
    assert.equal(first.requested.length, 1, 'one request scheduled');

    // Rebind to a same-size map: the SAME window slot, a new generation.
    const shared = { window: first.window, pendingGen: first.pendingGen };
    const second = harness(2, shared);
    assert.equal(updateTileLayerUI(second.params), -1, 'the new binding requests too');

    // The stale first delivery lands: it must not satisfy the new binding.
    first.requested[0]!();
    assert.equal(updateTileLayerUI(second.params), -1, 'stale window never fills the new binding');
    assert.equal(second.requested.length, 1, 'a fresh request is scheduled on the new binding');

    // The current delivery fills with current tiles only.
    second.requested[0]!();
    const filled = updateTileLayerUI(second.params);
    assert.ok(filled > 0, 'the current window fills');
  });

  it('a late stale request cannot overwrite the new window', () => {
    const first = harness(1);
    updateTileLayerUI(first.params);
    // Same slot, new binding: the stale delivery is still in flight.
    const shared = { window: first.window, pendingGen: first.pendingGen };
    const second = harness(2, shared);
    updateTileLayerUI(second.params);
    second.requested[0]!();
    const before = second.window.value;
    assert.equal(before.gen, 2, 'the new window is published');
    // Late stale delivery overwrites the shared slot transiently...
    first.requested[0]!();
    assert.equal(second.window.value.gen, 1, 'the stale write lands in the slot');
    // ...but the update still refuses to display it and re-requests.
    assert.equal(updateTileLayerUI(second.params), -1, 'stale overwrite never displays');
  });

  it('pending requests do not stick across bindings', () => {
    const first = harness(1);
    updateTileLayerUI(first.params);
    assert.equal(first.pendingGen.value, 1, 'the first binding marks its request pending');
    // A new binding with a missing window must request even though the old
    // binding left a pending mark behind (separate harness, same shape as a
    // remount reusing the shared values).
    const second = harness(2);
    second.pendingGen.value = 1;
    assert.equal(updateTileLayerUI(second.params), -1, 'missing window requests');
    assert.equal(second.requested.length, 1, 'the new binding requests despite the old pending mark');
  });

  it('a remount at identical coordinates requests instead of reusing', () => {
    const first = harness(7);
    updateTileLayerUI(first.params);
    first.requested[0]!();
    assert.ok(updateTileLayerUI(first.params) > 0, 'the first mount fills');
    // Remount: fresh empty window under the same generation shape.
    const second = harness(8);
    assert.equal(updateTileLayerUI(second.params), -1, 'no window survives the remount');
    assert.equal(second.requested.length, 1, 'the remount requests its window');
  });

  it('a published window fills tiles from the transferred snapshot', () => {
    const h = harness(3);
    assert.equal(updateTileLayerUI(h.params), -1);
    h.requested[0]!();
    const filled = updateTileLayerUI(h.params);
    assert.ok(filled > 0, 'filled slots reported');
    assert.ok(
      h.rectWrites.some(([, , w, hh]) => w === 16 && hh === 16),
      'frame rectangles come from the frame table',
    );
    assert.ok(
      h.xformWrites.some(([, , tx, ty]) => tx === 0 && ty === 16),
      'tiles place at their cell top-left corners',
    );
  });
});
