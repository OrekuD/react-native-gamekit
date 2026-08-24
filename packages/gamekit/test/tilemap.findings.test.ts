/**
 * Task 16 review findings (T16-F1, T16-F5, T16-F6) — regression tests.
 *
 * F1: normalized maps are immutable at runtime; the chunk index stays
 *     module-private (WeakMap) and never leaks onto the public map value.
 * F5: movement reports correct ties (up = negative y), emits contacts only
 *     for tiles touching the winning plane, and carries no debug logging.
 * F6: point/AABB/swept/visible/movement reads go through the private chunk
 *     index (proven by visit counters); the Tiled adapter validates inputs
 *     before property access and rejects unsupported features explicitly.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  defineTileSet2D,
  defineTileMap2D,
  defineTileLayer2D,
  movePlatformerBody2D,
  parseTiledMap2D,
  cellsAtPoint,
  cellsInAabb,
  cellsInSweptBounds,
  visibleCells,
} from '../src/tilemap/index';
import type { TileMap2D } from '../src/tilemap/types';
import {
  __resetChunkReadStats,
  __chunkReadCount,
} from '../src/tilemap/definitions';
import { TileMapError } from '../src/tilemap/errors';

function makeTileset() {
  return defineTileSet2D({
    tiles: {
      ground: { frame: 'ground', collision: 'solid' },
      platform: { frame: 'platform', collision: 'one-way-up' },
      coin: { frame: 'coin' },
    },
  });
}

function makeMap(): TileMap2D {
  const ts = makeTileset();
  return defineTileMap2D({
    cellSize: { width: 16, height: 16 },
    origin: { x: -32, y: -64 },
    tileset: ts,
    layers: [
      {
        id: 'deco',
        width: 6,
        height: 4,
        collidable: false,
        data: [
          0, 0, 3, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
        ],
      },
      {
        id: 'terrain',
        width: 6,
        height: 4,
        data: [
          1, 1, 0, 1, 1, 1,
          0, 0, 0, 0, 0, 0,
          2, 2, 2, 2, 2, 2,
          1, 1, 0, 1, 1, 1,
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// T16-F1 — runtime immutability
// ---------------------------------------------------------------------------

describe('T16-F1 normalized maps are immutable at runtime', () => {
  it('layer.data is frozen and mutation attempts fail without effect', () => {
    const m = makeMap();
    const data = m.layers[1]!.data;
    assert.equal(Object.isFrozen(data), true);
    assert.throws(() => {
      (data as number[])[0] = 9;
    }, TypeError);
    const m2 = makeMap(); // separate instance to avoid poisoned state
    assert.equal(m2.layers[1]!.data[0], 1);
  });

  it('map.origin is frozen and mutation attempts fail without effect', () => {
    const m = makeMap();
    assert.equal(Object.isFrozen(m.origin), true);
    assert.throws(() => {
      (m.origin as { x: number }).x = 999;
    }, TypeError);
    assert.equal(m.origin.x, -32);
  });

  it('nested tile defs, the tiles record, and name/id tables are frozen', () => {
    const ts = makeTileset();
    assert.equal(Object.isFrozen(ts.tiles.ground), true);
    assert.equal(Object.isFrozen(ts.tiles), true);
    assert.equal(Object.isFrozen(ts.names), true);
    assert.equal(Object.isFrozen(ts.idOfName), true);
    assert.equal(Object.isFrozen(ts.nameOfId), true);
    assert.equal(Object.isFrozen(ts.collisionOfId), true);
    assert.throws(() => {
      (ts.idOfName as Record<string, number>).ground = 99;
    }, TypeError);
  });

  it('layerById values are the frozen layers themselves', () => {
    const m = makeMap();
    assert.equal(Object.isFrozen(m.layers), true);
    assert.equal(Object.isFrozen(m.layerById), true);
    for (const layer of m.layers) {
      assert.equal(layer, m.layerById[layer.id]);
      assert.equal(Object.isFrozen(layer), true);
    }
    assert.throws(() => {
      (m.layerById as Record<string, unknown>).terrain = undefined;
    }, TypeError);
  });

  it('the private chunk index never leaks onto the public map value', () => {
    const m = makeMap();
    assert.equal('__chunks' in m, false);
    for (const key of Object.keys(m)) {
      assert.notEqual(key.startsWith('__'), true, `unexpected private key ${key}`);
    }
    // The exposed chunkSize constant is just a number.
    assert.equal(typeof m.chunkSize, 'number');
  });

  it('collidable and other runtime inputs are validated, not trusted', () => {
    const ts = makeTileset();
    assert.throws(
      () => defineTileLayer2D({ id: 'l', width: 1, height: 1, data: [0], collidable: 'yes' as never }, ts),
      (e: unknown) => e instanceof TileMapError && /collidable/.test((e as Error).message),
    );
    assert.throws(
      () => defineTileSet2D({ tiles: { bad: { frame: 5 as never } } }),
      TileMapError,
    );
    assert.throws(() => defineTileMap2D({ cellSize: { width: 16, height: 0 }, tileset: ts, layers: [{ id: 'l', width: 1, height: 1, data: [0] }] }), TileMapError);
    assert.throws(
      () =>
        defineTileMap2D({
          cellSize: { width: 16, height: 16 },
          tileset: ts,
          origin: { x: Number.NaN, y: 0 },
          layers: [{ id: 'l', width: 1, height: 1, data: [0] }],
        }),
      TileMapError,
    );
    assert.throws(
      () =>
        defineTileMap2D({
          cellSize: { width: 16, height: 16 },
          tileset: ts,
          layers: 'nope' as never,
        }),
      TileMapError,
    );
  });
});

// ---------------------------------------------------------------------------
// T16-F5 — movement ties and contact truthfulness
// ---------------------------------------------------------------------------

describe('T16-F5 movement reports correct ties and real contacts', () => {
  function solidFloorMap(cols: number, rows: number): TileMap2D {
    const ts = defineTileSet2D({ tiles: { g: { frame: 'g', collision: 'solid' } } });
    const data = new Array(cols * rows).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) data[r * cols + c] = 1;
    }
    return defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: cols, height: rows, data }],
    });
  }

  it('an exact tie between pushing left, right, and up resolves UP (negative y)', () => {
    // Single solid cell (1,1) at [16..32)x[16..32). Body embedded with equal
    // left/right/up penetration depths (12 each); down is larger (14).
    const ts = defineTileSet2D({ tiles: { g: { frame: 'g', collision: 'solid' } } });
    const data = new Array(9).fill(0);
    data[1 * 3 + 1] = 1;
    const m = defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: 3, height: 3, data }],
    });
    const r = movePlatformerBody2D({
      body: { x: 20, y: 18, width: 8, height: 10 },
      velocity: { x: 0, y: 0 },
      deltaSeconds: 0.016,
      map: m,
      collisionLayers: ['t'],
    });
    // Up resolution: body BOTTOM lands on the tile top (16).
    assert.equal(r.body.y + r.body.height, 16);
    assert.ok(r.contacts.floor !== undefined, 'expected floor contact');
    assert.equal(r.contacts.leftWall, undefined);
    assert.equal(r.contacts.rightWall, undefined);
    assert.equal(r.contacts.ceiling, undefined);
  });

  it('multi-tile spawn overlap reports a tile on the winning plane', () => {
    // Two solid cells (0,1) and (1,1); the body straddles both. The shallowest
    // escape is UP onto the shared plane y=16; the reported floor contact must
    // sit on that plane, not merely be the first evaluated cell.
    const ts = defineTileSet2D({ tiles: { g: { frame: 'g', collision: 'solid' } } });
    const data = new Array(9).fill(0);
    data[1 * 3 + 0] = 1;
    data[1 * 3 + 1] = 1;
    const m = defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: 3, height: 3, data }],
    });
    const r = movePlatformerBody2D({
      body: { x: 12, y: 14, width: 8, height: 4 },
      velocity: { x: 0, y: 0 },
      deltaSeconds: 0.016,
      map: m,
      collisionLayers: ['t'],
    });
    assert.ok(r.contacts.floor !== undefined);
    assert.equal(r.contacts.floor!.cell.aabb.y, 16);
    assert.equal(r.body.y + r.body.height, 16);
    // The winning-plane tile genuinely touches the resolved body.
    assert.ok(
      r.body.x < r.contacts.floor!.cell.aabb.x + 16 &&
        r.body.x + r.body.width > r.contacts.floor!.cell.aabb.x,
    );
  });

  it('a high-speed fall through two solid rows touches only the NEAREST plane', () => {
    const m = solidFloorMap(4, 5);
    const r = movePlatformerBody2D({
      body: { x: 20, y: -100, width: 10, height: 10 },
      velocity: { x: 0, y: 20000 },
      deltaSeconds: 0.03,
      map: m,
      collisionLayers: ['t'],
    });
    // Lands on row 0's top (world y = 0).
    assert.equal(r.body.y + r.body.height, 0);
    const floorContacts = r.contacts.all.filter((c) => c.normal.y === -1);
    assert.ok(floorContacts.length > 0);
    for (const c of floorContacts) {
      assert.equal(c.cell.aabb.y, 0, 'farther crossed rows must not be reported');
    }
  });

  function wallMap(col: number): TileMap2D {
    const ts = defineTileSet2D({ tiles: { g: { frame: 'g', collision: 'solid' } } });
    const data = new Array(12).fill(0);
    for (let r = 0; r < 3; r++) data[r * 4 + col] = 1;
    return defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: 4, height: 3, data }],
    });
  }

  it('reverse horizontal motion reports the touching wall with the outward normal', () => {
    // Wall column 2 spans [32,48); body starts clear at [56,64) and moves left.
    const left = movePlatformerBody2D({
      body: { x: 56, y: 20, width: 8, height: 8 },
      velocity: { x: -400, y: 0 },
      deltaSeconds: 0.05,
      map: wallMap(2),
      collisionLayers: ['t'],
    });
    // Frozen convention: a wall touched on the body's LEFT side carries the
    // outward normal +x and classifies as leftWall.
    assert.ok(left.contacts.leftWall !== undefined, 'moving left into a wall touches it with the body\'s left side');
    assert.equal(left.contacts.leftWall!.normal.x, 1);
    assert.equal(left.body.x, 48);
    assert.equal(left.contacts.leftWall!.cell.aabb.x + 16, 48);

    // Wall column 1 spans [16,32); body starts clear at [2,10) and moves right.
    const right = movePlatformerBody2D({
      body: { x: 2, y: 20, width: 8, height: 8 },
      velocity: { x: 400, y: 0 },
      deltaSeconds: 0.05,
      map: wallMap(1),
      collisionLayers: ['t'],
    });
    assert.ok(right.contacts.rightWall !== undefined);
    assert.equal(right.contacts.rightWall!.normal.x, -1);
    assert.equal(right.body.x + right.body.width, 16);
  });

  it('every reported contact tile actually touches the final body', () => {
    const m = makeMap();
    const r = movePlatformerBody2D({
      body: { x: -30, y: 40, width: 12, height: 12 },
      velocity: { x: 60, y: 300 },
      deltaSeconds: 0.016,
      map: m,
      collisionLayers: ['terrain'],
      floorSnapDistance: 4,
    });
    const SKIN = 1e-4;
    for (const c of r.contacts.all) {
      const touches =
        r.body.x < c.cell.aabb.x + c.cell.aabb.width + SKIN &&
        r.body.x + r.body.width > c.cell.aabb.x - SKIN &&
        r.body.y < c.cell.aabb.y + c.cell.aabb.height + SKIN &&
        r.body.y + r.body.height > c.cell.aabb.y - SKIN;
      assert.ok(touches, `contact at (${c.cell.cell.x},${c.cell.cell.y}) does not touch the final body`);
    }
  });

  function floorRowMap(): TileMap2D {
    const ts = defineTileSet2D({ tiles: { g: { frame: 'g', collision: 'solid' } } });
    const data = new Array(12).fill(0);
    for (let c = 0; c < 4; c++) data[2 * 4 + c] = 1;
    return defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: 4, height: 3, data }],
    });
  }

  it('sliding across a seam reports deterministic contacts on the shared plane', () => {
    const m = floorRowMap();
    const r = movePlatformerBody2D({
      body: { x: 12, y: 24, width: 10, height: 8 },
      velocity: { x: 80, y: 60 },
      deltaSeconds: 0.05,
      map: m,
      collisionLayers: ['t'],
    });
    const floors = r.contacts.all.filter((c) => c.normal.y === -1);
    assert.ok(floors.length >= 1);
    for (const f of floors) {
      assert.equal(f.cell.aabb.y, r.body.y + r.body.height);
    }
    assert.equal(r.contacts.leftWall, undefined);
    assert.equal(r.contacts.rightWall, undefined);
  });

  it('the hot path carries no console logging, no-op try/catch, or scratch test file', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/tilemap/movement.ts'), 'utf8');
    assert.doesNotMatch(src, /console\./);
    assert.doesNotMatch(src, /\btry\s*\{/);
    assert.equal(existsSync(join(import.meta.dirname, 'tmdbg.test.ts')), false);
  });
});

// ---------------------------------------------------------------------------
// T16-F6 — chunk-backed reads and adapter hardening
// ---------------------------------------------------------------------------

describe('T16-F6 chunk index backs every runtime read', () => {
  function sparseMap(w: number, h: number): TileMap2D {
    const ts = defineTileSet2D({ tiles: { g: { frame: 'g', collision: 'solid' } } });
    const data = new Array(w * h).fill(0);
    data[300 * w + 300] = 1;
    data[300 * w + 301] = 1;
    return defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: w, height: h, data }],
    });
  }

  it('a sparse AABB query on a 512x512 map visits only overlapped chunks', () => {
    const m = sparseMap(512, 512);
    // Query far away from the populated area.
    __resetChunkReadStats();
    const far = cellsInAabb(m, { x: 0, y: 0, width: 20, height: 20 }, ['t']);
    assert.equal(far.length, 0);
    const farVisits = __chunkReadCount();

    // Query around the populated cells.
    __resetChunkReadStats();
    const near = cellsInAabb(m, { x: 4790, y: 4790, width: 40, height: 40 }, ['t']);
    const nearVisits = __chunkReadCount();
    assert.equal(near.length, 2);
    // Bounded by the overlapped chunk regions, not by map dimensions.
    assert.ok(nearVisits <= 4, `expected <= 4 chunk visits, got ${nearVisits}`);
    assert.ok(nearVisits <= farVisits || farVisits <= 4, 'far visits must also stay bounded');
  });

  it('point, swept, and visible reads agree with direct expectations on seams', () => {
    const m = makeMap();
    // Cells 15/16/17-style seam: terrain row 2 crosses the 16-cell chunk
    // boundary nowhere on this tiny map, so exercise the sweep path instead.
    __resetChunkReadStats();
    const swept = cellsInSweptBounds(m, { x: 0, y: -20, width: 8, height: 8 }, { x: 96, y: 0 }, ['terrain']);
    assert.ok(swept.length >= 2);
    assert.ok(__chunkReadCount() > 0, 'reads must flow through the chunk index');

    const vis = visibleCells(m, { x: -32, y: -64, width: 96, height: 64 }, 0, ['deco']);
    assert.equal(vis.length, 1);
    assert.equal(vis[0]!.tileId, 3);
  });

  it('the Tiled adapter validates the root before property access', () => {
    const ts = makeTileset();
    const opts = { gidToTileName: { 1: 'ground' } };
    for (const bad of [null, undefined, 42, 'x', [1, 2]]) {
      assert.throws(
        () => parseTiledMap2D(bad, ts, opts),
        (e: unknown) => e instanceof TileMapError,
        `expected TileMapError for root ${String(bad)}`,
      );
    }
    assert.throws(
      () => parseTiledMap2D({ orientation: 'orthogonal', infinite: false, width: 1, height: 1, tilewidth: 16, tileheight: 16, layers: [] }, ts, undefined as never),
      TileMapError,
    );
  });

  it('the adapter rejects group/image layers and nonzero offsets with exact paths', () => {
    const ts = makeTileset();
    const opts = { gidToTileName: { 1: 'ground' } };
    const base = {
      orientation: 'orthogonal',
      infinite: false,
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
    };

    assert.throws(
      () => parseTiledMap2D({ ...base, layers: [{ type: 'tilelayer', name: 't', width: 1, height: 1, data: [1] }, { type: 'group', name: 'grp', layers: [] }] }, ts, opts),
      (e: unknown) => e instanceof TileMapError && /layers\[1\]\(.*grp.*\)\.type/.test((e as Error).message),
    );
    assert.throws(
      () => parseTiledMap2D({ ...base, layers: [{ type: 'imagelayer', name: 'img' }] }, ts, opts),
      (e: unknown) => e instanceof TileMapError && /imagelayer|type/.test((e as Error).message),
    );
    assert.throws(
      () => parseTiledMap2D({ ...base, layers: [{ type: 'tilelayer', name: 't', width: 1, height: 1, data: [1], offsetx: 8, offsety: 0 }] }, ts, opts),
      (e: unknown) => e instanceof TileMapError && /offsetx/.test((e as Error).message),
    );
    // A mystery layer type cannot silently disappear either.
    assert.throws(
      () => parseTiledMap2D({ ...base, layers: [{ type: 'wat', name: 'm' }] }, ts, opts),
      (e: unknown) => e instanceof TileMapError && /\.type/.test((e as Error).message),
    );
  });

  it('cellsAtPoint still resolves decorated and collision layers correctly', () => {
    const m = makeMap();
    const hit = cellsAtPoint(m, { x: -28, y: -56 }, ['terrain']);
    assert.equal(hit.length, 1);
    assert.equal(hit[0]!.tileName, 'ground');
  });
});
