import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TILE_CHUNK_SIZE,
  defineTileMap2D,
  defineTileSet2D,
} from '../src/tilemap/definitions';
import { cellsAtPoint, cellsInAabb, cellsInSweptBounds, visibleCells } from '../src/tilemap/queries';
import { movePlatformerBody2D } from '../src/tilemap/movement';
import { parseTiledMap2D } from '../src/tilemap/tiledAdapter';
import type { TileCell2D, TileMap2D } from '../src/tilemap/types';

function makeMap(): TileMap2D {
  const tileset = defineTileSet2D({
    tiles: {
      grass: { frame: 'grass', collision: 'solid' },
      platform: { frame: 'platform', collision: 'one-way-up' },
      coin: { frame: 'coin' },
    },
  });
  // 6x4 map; row-major. Terrain floor at y=3 with a gap at x=2.
  const terrain = [
    1, 1, 1, 0, 1, 1,
    0, 0, 0, 0, 0, 0,
    2, 2, 2, 2, 2, 2, // one-way row (id 2 = platform)
    1, 1, 0, 1, 1, 1,
  ];
  const deco = new Array(24).fill(3); // coin everywhere (decorative layer)
  return defineTileMap2D({
    cellSize: { width: 16, height: 16 },
    tileset,
    layers: [
      { id: 'deco', width: 6, height: 4, data: deco, collidable: false },
      { id: 'terrain', width: 6, height: 4, data: terrain },
    ],
    origin: { x: -32, y: -64 }, // exercise negative world origin
  });
}

describe('T16.1 definitions and validation', () => {
  it('assigns ids by declaration order and freezes output', () => {
    const ts = defineTileSet2D({
      tiles: { grass: { frame: 'g', collision: 'solid' }, coin: { frame: 'c' } },
    });
    assert.equal(ts.idOfName.grass, 1);
    assert.equal(ts.idOfName.coin, 2);
    assert.equal(ts.collisionOfId[2], undefined);
    assert.ok(Object.isFrozen(ts));
  });

  it('rejects malformed definitions with exact paths', () => {
    assert.throws(() => defineTileSet2D({ tiles: {} }), /tiles: must declare/);
    assert.throws(
      () => defineTileSet2D({ tiles: { bad: { frame: '' } } }),
      /tiles\."bad"\.frame/,
    );
    assert.throws(
      () => defineTileSet2D({ tiles: { bad: { frame: 'f', collision: 'slope' as never } } }),
      /tiles\."bad"\.collision/,
    );
  });

  it('validates layer dims/data length/duplicate ids/unknown tiles', () => {
    const ts = defineTileSet2D({ tiles: { grass: { frame: 'g', collision: 'solid' } } });
    assert.throws(
      () =>
        defineTileMap2D({
          cellSize: { width: 16, height: 16 },
          tileset: ts,
          layers: [
            { id: 'a', width: 2, height: 2, data: [1] },
          ],
        }),
      /layers\["a"\]\.data: length 1 must equal/,
    );
    assert.throws(
      () =>
        defineTileMap2D({
          cellSize: { width: 16, height: 16 },
          tileset: ts,
          layers: [
            { id: 'a', width: 2, height: 2, data: [1, 99, 0, 0] },
          ],
        }),
      /data\[1\]: unknown tile id 99/,
    );
    assert.throws(
      () =>
        defineTileMap2D({
          cellSize: { width: 16, height: 16 },
          tileset: ts,
          layers: [
            { id: 'a', width: 1, height: 1, data: [1] },
            { id: 'a', width: 1, height: 1, data: [1] },
          ],
        }),
      /duplicate layer id "a"/,
    );
    assert.throws(
      () =>
        defineTileMap2D({
          cellSize: { width: 0, height: 16 },
          tileset: ts,
          layers: [{ id: 'a', width: 1, height: 1, data: [1] }],
        }),
      /cellSize\.width/,
    );
  });

  it('worldBounds uses origin and covers all layers; chunk size frozen', () => {
    const m = makeMap();
    assert.equal(m.chunkSize, TILE_CHUNK_SIZE);
    assert.equal(m.worldBounds.x, -32);
    assert.equal(m.worldBounds.y, -64);
    assert.equal(m.worldBounds.width, 96);
    assert.equal(m.worldBounds.height, 64);
  });

  it('caller buffers are cloned — later mutation cannot affect the map', () => {
    const ts = defineTileSet2D({ tiles: { grass: { frame: 'g', collision: 'solid' } } });
    const data = [1, 1, 1, 1];
    const m = defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: 2, height: 2, data }],
    });
    (data as number[])[0] = 0;
    const after = m.layers[0]!.data[0];
    assert.equal(after, 1);
  });
});

describe('T16.2 bounded queries', () => {
  it('point query returns layered results in declaration order', () => {
    const m = makeMap();
    // World (-16, -16) is cell (1,3): terrain solid over deco coin.
    const hit = cellsAtPoint(m, { x: -16, y: -16 });
    assert.equal(hit.length, 2);
    assert.equal(hit[0]!.layerId, 'deco');
    assert.equal(hit[1]!.layerId, 'terrain');
    assert.equal(hit[1]!.collision, 'solid');
    assert.deepEqual([hit[1]!.cell.x, hit[1]!.cell.y], [1, 3]);
  });

  it('negative coordinates use floor division (origin-shifted)', () => {
    const m = makeMap();
    // Cell (0,0) spans [-32,-16)x[-64,-48). Point just inside.
    const hit = cellsAtPoint(m, { x: -31.9, y: -63.9 });
    assert.equal(hit.length, 2);
    assert.deepEqual([hit[0]!.cell.x, hit[0]!.cell.y], [0, 0]);
  });

  it('outside the finite map returns empty results', () => {
    const m = makeMap();
    assert.equal(cellsAtPoint(m, { x: 9999, y: 9999 }).length, 0);
    assert.equal(
      cellsInAabb(m, { x: 9999, y: 9999, width: 10, height: 10 }).length,
      0,
    );
  });

  it('aabb query skips empties and honors layer filter', () => {
    const m = makeMap();
    // One-way row (row 2) spans world y [-32,-16): all 6 cells are platforms.
    const all = cellsInAabb(m, { x: -32, y: -32, width: 96, height: 16 }, ['terrain']);
    assert.equal(all.length, 6);
    const terrainOnly = cellsInAabb(m, { x: -32, y: -32, width: 96, height: 16 }, ['terrain']);
    assert.ok(terrainOnly.every((c) => c.layerId === 'terrain'));
    assert.equal(terrainOnly.length, 6);
  });

  it('swept bounds union start/end', () => {
    const m = makeMap();
    const body = { x: -32, y: -80, width: 12, height: 12 };
    const swept = cellsInSweptBounds(m, body, { x: 400, y: 400 }, ['terrain']);
    // Swept region covers every column and row of the 6x4 map.
    assert.ok(swept.length >= 16);
  });

  it('visibleCells respects overscan and clamps to map', () => {
    const m = makeMap();
    const vis = visibleCells(m, { x: -32, y: -64, width: 320, height: 480 }, 1, ['terrain']);
    // Whole 6x4 terrain map fits within a 320x480 view + overscan.
    assert.equal(vis.length, 16); // total non-empty terrain cells
  });

  it('oracle: optimized AABB query equals brute-force scan', () => {
    const m = makeMap();
    const box = { x: -20, y: -30, width: 40, height: 40 };
    const fast = cellsInAabb(m, box, ['terrain']);
    const slow: TileCell2D[] = [];
    const layer = m.layers.find((l) => l.id === 'terrain')!;
    for (let cy = 0; cy < layer.height; cy++) {
      for (let cx = 0; cx < layer.width; cx++) {
        const id = layer.data[cy * layer.width + cx]!;
        if (id === 0) continue;
        const ax = m.origin.x + cx * 16;
        const ay = m.origin.y + cy * 16;
        const aabb = { x: ax, y: ay, width: 16, height: 16 };
        const inter =
          box.x < aabb.x + 16 && box.x + box.width > aabb.x &&
          box.y < aabb.y + 16 && box.y + box.height > aabb.y;
        if (!inter) continue;
        slow.push(Object.freeze({
          layerId: 'terrain', tileId: id,
          tileName: m.tileset.nameOfId[id]!,
          collision: m.tileset.collisionOfId[id],
          cell: Object.freeze({ x: cx, y: cy }),
          aabb: Object.freeze(aabb),
        }));
      }
    }
    assert.deepEqual(fast.map((c) => c.cell), slow.map((c) => c.cell));
  });
});

describe('T16.3 collision and movement', () => {
  const BODY = { x: 0, y: -28, width: 12, height: 12 }; // standing zone above floor

  function flat(): TileMap2D {
    const ts = defineTileSet2D({
      tiles: {
        ground: { frame: 'g', collision: 'solid' },
        oneway: { frame: 'o', collision: 'one-way-up' },
      },
    });
    return defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [
        { id: 't', width: 8, height: 4, data: [
          0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0,
          2, 2, 2, 2, 2, 2, 2, 2,
          1, 1, 1, 1, 1, 1, 1, 1,
        ] },
      ],
    });
  }

  it('falls onto solid floor and reports floor contact + zero vy', () => {
    const m = flat();
    const r = movePlatformerBody2D({
      body: BODY, velocity: { x: 0, y: 100 }, deltaSeconds: 1,
      map: m, collisionLayers: ['t'],
    });
    // Floor top at y = 2*16 = 32; body bottom clamps to 32.
    assert.equal(r.body.y, 32 - 12);
    assert.equal(r.velocity.y, 0);
    assert.ok(r.contacts.floor !== undefined);
    assert.ok(Math.abs(r.contacts.floor.normal.y + 1) < 1e-9);
  });

  it('high-speed descent does not tunnel through a single solid row', () => {
    const m = flat();
    const high = movePlatformerBody2D({
      body: { x: 0, y: -300, width: 12, height: 12 },
      velocity: { x: 0, y: 5000 }, deltaSeconds: 0.5,
      map: m, collisionLayers: ['t'],
    });
    assert.equal(high.body.y, 32 - 12);
    assert.equal(high.velocity.y, 0);
  });

  it('wall clamp zeroes vx on horizontal impact', () => {
    const ts = defineTileSet2D({ tiles: { g: { frame: 'g', collision: 'solid' } } });
    const wall = defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: 4, height: 1, data: [1, 0, 0, 1] }],
      origin: { x: 0, y: 0 },
    });
    const r = movePlatformerBody2D({
      body: { x: 20, y: 0, width: 10, height: 14 },
      velocity: { x: -1000, y: 0 }, deltaSeconds: 0.1,
      map: wall, collisionLayers: ['t'],
    });
    // Solid occupies [0,16). Body left clamps to 16.
    assert.equal(r.body.x, 16);
    assert.equal(r.velocity.x, 0);
    assert.ok(r.contacts.leftWall !== undefined);
    assert.equal(r.remainingDisplacement.x < 0, true);
  });

  it('one-way blocks descent from above but not ascent from below', () => {
    const m = flat(); // one-way row at y=32..48
    // Start ABOVE the platform top (bottom <= 32) and fall onto it.
    const onto = movePlatformerBody2D({
      body: { x: 0, y: 26, width: 12, height: 6 },
      velocity: { x: 0, y: 50 }, deltaSeconds: 1,
      map: m, collisionLayers: ['t'],
    });
    assert.equal(onto.body.y, 32 - 6);
    assert.ok(onto.contacts.floor !== undefined);

    // Rising through the underside must not be blocked by the one-way row.
    const rising = movePlatformerBody2D({
      body: { x: 0, y: 44, width: 12, height: 6 },
      velocity: { x: 0, y: -100 }, deltaSeconds: 1,
      map: m, collisionLayers: ['t'],
    });
    // Passes the row entirely upward toward the top of the map.
    assert.ok(rising.body.y < 32);
  });

  it('horizontal support along one-way top works while walking', () => {
    const m = flat();
    // Standing exactly on the one-way top, small downward pull each call.
    const stand = movePlatformerBody2D({
      body: { x: 20, y: 32 - 6, width: 10, height: 6 },
      velocity: { x: 40, y: 10 }, deltaSeconds: 0.05,
      map: m, collisionLayers: ['t'],
    });
    assert.ok(stand.contacts.floor !== undefined);
    assert.equal(stand.body.y, 32 - 6);
    assert.ok(stand.displacement.x > 0);
  });

  it('dropThroughOneWay ignores the platform for that call only', () => {
    const m = flat();
    const drop = movePlatformerBody2D({
      body: { x: 0, y: 26, width: 12, height: 6 },
      velocity: { x: 0, y: 50 }, deltaSeconds: 1,
      map: m, collisionLayers: ['t'],
      dropThroughOneWay: true,
    });
    // Falls past the one-way row (top 32) to the solid floor (top 48).
    assert.equal(drop.body.y, 48 - 6);
    assert.ok(drop.contacts.floor !== undefined);
  });

  it('floor snap pulls resting bodies onto tops within distance', () => {
    const m = flat();
    const snapped = movePlatformerBody2D({
      body: { x: 0, y: 32 - 6 - 3, width: 10, height: 6 },
      velocity: { x: 0, y: 1 }, deltaSeconds: 0.01,
      map: m, collisionLayers: ['t'],
      floorSnapDistance: 6,
    });
    assert.equal(snapped.body.y, 32 - 6);
    assert.ok(snapped.contacts.floor !== undefined);
  });

  it('spawn-inside solid resolves upward deterministically', () => {
    const m = flat();
    // Frozen tie/depth rule: least-penetration face wins (up here: 7 < 10).
    const r = movePlatformerBody2D({
      body: { x: 16, y: 49, width: 10, height: 6 }, // shallow embed in solid
      velocity: { x: 0, y: 0 }, deltaSeconds: 0.016,
      map: m, collisionLayers: ['t'],
    });
    assert.equal(r.body.y + r.body.height, 48);
    assert.ok(r.contacts.floor !== undefined);
  });

  it('ceiling contact classifies when ascending into solids', () => {
    const ts = defineTileSet2D({ tiles: { g: { frame: 'g', collision: 'solid' } } });
    const ceilingMap = defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset: ts,
      layers: [{ id: 't', width: 4, height: 2, data: [1, 1, 1, 1, 0, 0, 0, 0].slice(0, 8).map((v, i) => (i < 4 ? 1 : 0)) }],
      origin: { x: 0, y: 0 },
    });
    // Row 0 = solid ceiling; body starts under it and rises.
    const r = movePlatformerBody2D({
      body: { x: 8, y: 20, width: 8, height: 8 },
      velocity: { x: 0, y: -100 }, deltaSeconds: 0.1,
      map: ceilingMap, collisionLayers: ['t'],
    });
    assert.equal(r.body.y, 16);
    assert.ok(r.contacts.ceiling !== undefined);
  });

  it('teleport-scale displacement outside the map leaves body untouched', () => {
    const m = flat();
    const far = movePlatformerBody2D({
      body: { x: 100000, y: 100000, width: 10, height: 10 },
      velocity: { x: 0, y: 0 }, deltaSeconds: 0.016,
      map: m, collisionLayers: ['t'],
    });
    assert.equal(far.body.x, 100000);
    assert.equal(far.contacts.all.length, 0);
    assert.equal(far.displacement.x, 0);
    assert.equal(far.displacement.y, 0);
  });

  it('decorative layers never collide even when overlapped', () => {
    const m = makeMap();
    const r = movePlatformerBody2D({
      // Fully inside the deco-covered gap cell (3,0); terrain is empty there,
      // so any reported contact would have to come from the decorative layer.
      body: { x: 18, y: -62, width: 8, height: 8 },
      velocity: { x: 0, y: 0 }, deltaSeconds: 0.016,
      map: m, collisionLayers: ['terrain'],
    });
    assert.equal(r.contacts.all.length, 0);
  });
});

describe('T16.5 narrow Tiled adapter', () => {
  const tileset = defineTileSet2D({
    tiles: { ground: { frame: 'g', collision: 'solid' } },
  });

  const valid = {
    orientation: 'orthogonal',
    infinite: false,
    width: 2, height: 2, tilewidth: 16, tileheight: 16,
    layers: [
      { type: 'tilelayer', name: 'terrain', width: 2, height: 2, data: [1, 0, 0, 1] },
    ],
  };

  it('accepts the supported subset and maps gids', () => {
    const input = parseTiledMap2D(valid, tileset, {
      gidToTileName: { 1: 'ground' },
      collidableLayers: ['terrain'],
    });
    assert.equal(input.cellSize.width, 16);
    assert.equal(input.layers[0]!.id, 'terrain');
    assert.equal(input.layers[0]!.collidable, true);
    const m = defineTileMap2D(input);
    assert.equal(m.layers[0]!.data[0], 1);
    assert.equal(m.layers[0]!.data[1], 0);
  });

  it('rejects unsupported features with source paths', () => {
    assert.throws(
      () => parseTiledMap2D({ ...valid, orientation: 'isometric' }, tileset, { gidToTileName: {} }),
      /orientation: only "orthogonal"/,
    );
    assert.throws(
      () => parseTiledMap2D({ ...valid, infinite: true }, tileset, { gidToTileName: {} }),
      /infinite: infinite maps/,
    );
    assert.throws(
      () =>
        parseTiledMap2D(
          { ...valid, layers: [{ type: 'objectgroup', name: 'objs' }] },
          tileset,
          { gidToTileName: {} },
        ),
      /"objectgroup" layers are not supported/,
    );
    assert.throws(
      () =>
        parseTiledMap2D(
          { ...valid, layers: [{ ...valid.layers[0], compression: 'zlib' }] },
          tileset,
          { gidToTileName: { 1: 'ground' } },
        ),
      /compression/,
    );
    assert.throws(
      () =>
        parseTiledMap2D(
          { ...valid, layers: [{ ...valid.layers[0], data: [2147483649, 0, 0, 0] }] },
          tileset,
          { gidToTileName: { 1: 'ground' } },
        ),
      /flip\/rotation flags/,
    );
    assert.throws(
      () => parseTiledMap2D(valid, tileset, { gidToTileName: {} }),
      /gid 1 has no mapping/,
    );
  });
});

describe('GS-TILE-05 exact query edge semantics', () => {
  function exactMap(origin = { x: 0, y: 0 }): TileMap2D {
    const tileset = defineTileSet2D({ tiles: { solid: { frame: 's', collision: 'solid' } } });
    return defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      origin,
      tileset,
      layers: [{ id: 't', width: 4, height: 4, data: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }],
    });
  }

  function cellsOf(map: TileMap2D, aabb: { x: number; y: number; width: number; height: number }): string {
    return cellsInAabb(map, aabb, ['t'])
      .map((c) => `${c.cell.x},${c.cell.y}`)
      .join(' ');
  }

  it('exact boundaries select half-open cells without epsilon', () => {
    const map = exactMap();
    assert.equal(cellsOf(map, { x: 0, y: 0, width: 32, height: 16 }), '0,0 1,0');
    assert.equal(cellsOf(map, { x: 16, y: 0, width: 16, height: 16 }), '1,0', 'starts exactly on a boundary');
    assert.equal(cellsOf(map, { x: 0, y: 0, width: 32.0001, height: 16 }), '0,0 1,0 2,0', 'overshoot reaches the next cell');
  });

  it('tiny positive extents still select their cell', () => {
    const map = exactMap();
    assert.equal(cellsOf(map, { x: 0, y: 0, width: 1e-12, height: 1e-12 }), '0,0');
    assert.equal(cellsOf(map, { x: 20, y: 20, width: 1e-9, height: 1e-9 }), '1,1');
  });

  it('zero-size queries use point semantics', () => {
    const map = exactMap();
    assert.equal(cellsOf(map, { x: 5, y: 5, width: 0, height: 0 }), '0,0', 'interior point selects its cell');
    assert.equal(cellsOf(map, { x: 16, y: 0, width: 0, height: 0 }), '1,0', 'boundary point selects the cell it opens');
  });

  it('negative origins and large coordinates stay exact', () => {
    const map = exactMap({ x: -16, y: -16 });
    assert.equal(cellsOf(map, { x: 0, y: 0, width: 16, height: 16 }), '1,1');
    const big = exactMap();
    assert.equal(cellsOf(big, { x: 1e6, y: 0, width: 32, height: 16 }), '', 'outside the finite map stays empty');
  });

  it('endpoint movement touches exactly abutting walls', () => {
    const tileset = defineTileSet2D({ tiles: { solid: { frame: 's', collision: 'solid' } } });
    const wall = defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset,
      layers: [{ id: 't', width: 3, height: 1, data: [0, 1, 0] }],
    });
    // Body edge exactly abuts the wall's left face; moving in reports contact.
    const into = movePlatformerBody2D({
      body: { x: 0, y: 0, width: 16, height: 16 },
      velocity: { x: 500, y: 0 },
      deltaSeconds: 0.016,
      map: wall,
      collisionLayers: ['t'],
    });
    assert.equal(into.contacts.rightWall?.normal.x, -1, 'abutting motion into the wall contacts');
    assert.equal(into.body.x, 0, 'the body stops at the abutting plane');
    // Moving away from the same abutment reports nothing.
    const away = movePlatformerBody2D({
      body: { x: 0, y: 0, width: 16, height: 16 },
      velocity: { x: -500, y: 0 },
      deltaSeconds: 0.016,
      map: wall,
      collisionLayers: ['t'],
    });
    assert.equal(away.contacts.all.length, 0, 'leaving the abutment is contact-free');
  });
});

describe('GS-TILE-02 single collision eligibility policy', () => {
  function decoSolidMap(): TileMap2D {
    const tileset = defineTileSet2D({ tiles: { solid: { frame: 's', collision: 'solid' } } });
    return defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset,
      layers: [
        // Solid-looking but decorative: must never block, even selected.
        { id: 'deco', width: 3, height: 1, data: [1, 1, 1], collidable: false },
        { id: 't', width: 3, height: 1, data: [0, 0, 0] },
      ],
    });
  }

  it('a non-collidable layer reports no collision even when selected', () => {
    const map = decoSolidMap();
    const cells = cellsInAabb(map, { x: 0, y: 0, width: 48, height: 16 }, ['deco']);
    assert.ok(cells.length > 0, 'the decorative cells are still queried');
    for (const cell of cells) {
      assert.equal(cell.collision, undefined, 'decoration carries no collision role');
    }
    const r = movePlatformerBody2D({
      body: { x: 0, y: 0, width: 8, height: 8 },
      velocity: { x: 500, y: 0 },
      deltaSeconds: 0.016,
      map,
      collisionLayers: ['deco'],
    });
    assert.equal(r.contacts.all.length, 0, 'selected decoration does not block');
    assert.equal(r.body.x, 8, 'motion is unobstructed');
  });

  it('an unselected solid layer does not block', () => {
    const tileset = defineTileSet2D({ tiles: { solid: { frame: 's', collision: 'solid' } } });
    const map = defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset,
      layers: [{ id: 't', width: 3, height: 1, data: [0, 1, 0] }],
    });
    const r = movePlatformerBody2D({
      body: { x: 0, y: 0, width: 16, height: 16 },
      velocity: { x: 500, y: 0 },
      deltaSeconds: 0.016,
      map,
      collisionLayers: [],
    });
    assert.equal(r.contacts.all.length, 0, 'omitted layers never collide');
    assert.equal(r.body.x, 8, 'motion passes through the unselected wall');
  });

  it('unknown collision layer ids fail at the boundary', () => {
    const map = decoSolidMap();
    assert.throws(
      () =>
        movePlatformerBody2D({
          body: { x: 0, y: 0, width: 8, height: 8 },
          velocity: { x: 0, y: 0 },
          deltaSeconds: 0.016,
          map,
          collisionLayers: ['nope'],
        }),
      /unknown collision layer/,
    );
  });

  it('duplicate layer selections report once', () => {
    const tileset = defineTileSet2D({ tiles: { solid: { frame: 's', collision: 'solid' } } });
    const map = defineTileMap2D({
      cellSize: { width: 16, height: 16 },
      tileset,
      layers: [{ id: 't', width: 3, height: 1, data: [0, 1, 0] }],
    });
    const r = movePlatformerBody2D({
      body: { x: 0, y: 0, width: 16, height: 16 },
      velocity: { x: 500, y: 0 },
      deltaSeconds: 0.016,
      map,
      collisionLayers: ['t', 't'],
    });
    assert.equal(r.contacts.all.length, 1, 'one wall reports one contact');
  });
});
