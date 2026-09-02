import type { Aabb2D } from 'rn-gamekit';
import { defineTileMap2D, defineTileSet2D, type TileMap2D } from 'rn-gamekit/tilemap';

export const MOSSY_CAVERN_3_CELL_SIZE = 64;
export const MOSSY_CAVERN_3_COLUMNS = 88;
export const MOSSY_CAVERN_3_ROWS = 14;
export const MOSSY_CAVERN_3_WORLD_WIDTH =
  MOSSY_CAVERN_3_COLUMNS * MOSSY_CAVERN_3_CELL_SIZE;
export const MOSSY_CAVERN_3_WORLD_HEIGHT =
  MOSSY_CAVERN_3_ROWS * MOSSY_CAVERN_3_CELL_SIZE;

export const MOSSY_CAVERN_3_VISUAL_PLATFORMS = Object.freeze([
  Object.freeze({ x: 0, y: 704, width: 5632, height: 192, oneWay: false }),
  Object.freeze({ x: 384, y: 512, width: 384, height: 192, oneWay: false }),
  Object.freeze({ x: 896, y: 448, width: 320, height: 24, oneWay: true }),
  Object.freeze({ x: 1408, y: 576, width: 320, height: 128, oneWay: false }),
  Object.freeze({ x: 1920, y: 384, width: 384, height: 24, oneWay: true }),
  Object.freeze({ x: 2432, y: 512, width: 384, height: 192, oneWay: false }),
  Object.freeze({ x: 3008, y: 320, width: 320, height: 24, oneWay: true }),
  Object.freeze({ x: 3520, y: 512, width: 448, height: 192, oneWay: false }),
  Object.freeze({ x: 4160, y: 384, width: 320, height: 24, oneWay: true }),
  Object.freeze({ x: 4736, y: 512, width: 384, height: 192, oneWay: false }),
  Object.freeze({ x: 5248, y: 320, width: 320, height: 24, oneWay: true }),
]);

export interface MossyCavern3Sensor {
  readonly id: string;
  readonly bounds: Aabb2D;
}

export interface MossyCavern3Checkpoint extends MossyCavern3Sensor {
  readonly respawnBody: Aabb2D;
}

export interface MossyCavern3Level {
  readonly map: TileMap2D;
  readonly collisionLayers: readonly string[];
  readonly spawnBody: Aabb2D;
  readonly crystals: readonly MossyCavern3Sensor[];
  readonly checkpoints: readonly MossyCavern3Checkpoint[];
  readonly hazards: readonly MossyCavern3Sensor[];
  readonly exit: MossyCavern3Sensor;
  readonly deathY: number;
}

const tileset = defineTileSet2D({
  tiles: {
    stone: { frame: 'stone', collision: 'solid' },
    'moss-bridge': { frame: 'moss-bridge', collision: 'one-way-up' },
  },
});

function indexOf(column: number, row: number): number {
  return row * MOSSY_CAVERN_3_COLUMNS + column;
}

function buildCollisionData(): readonly number[] {
  const stone = tileset.idOfName.stone!;
  const bridge = tileset.idOfName['moss-bridge']!;
  const data = Array.from(
    { length: MOSSY_CAVERN_3_COLUMNS * MOSSY_CAVERN_3_ROWS },
    () => 0,
  );
  const place = (column: number, row: number, tile: number): void => {
    data[indexOf(column, row)] = tile;
  };
  const row = (from: number, to: number, y: number, tile: number): void => {
    for (let x = from; x <= to; x += 1) place(x, y, tile);
  };

  row(0, 87, 11, stone);
  row(0, 87, 12, stone);
  row(0, 87, 13, stone);
  row(6, 11, 8, stone);
  row(14, 18, 7, bridge);
  row(22, 26, 9, stone);
  row(30, 35, 6, bridge);
  row(38, 43, 8, stone);
  row(47, 51, 5, bridge);
  row(55, 61, 8, stone);
  row(65, 69, 6, bridge);
  row(74, 79, 8, stone);
  row(82, 86, 5, bridge);
  for (let y = 0; y < MOSSY_CAVERN_3_ROWS; y += 1) {
    place(0, y, stone);
    place(87, y, stone);
  }
  return Object.freeze(data);
}

const map = defineTileMap2D({
  cellSize: {
    width: MOSSY_CAVERN_3_CELL_SIZE,
    height: MOSSY_CAVERN_3_CELL_SIZE,
  },
  layers: [
    {
      collidable: true,
      data: buildCollisionData(),
      height: MOSSY_CAVERN_3_ROWS,
      id: 'terrain',
      width: MOSSY_CAVERN_3_COLUMNS,
    },
  ],
  tileset,
});

const playerBodyAt = (x: number, y: number): Aabb2D =>
  Object.freeze({ x, y, width: 42, height: 64 });

const crystals = Object.freeze([
  Object.freeze({ id: 'mooncap-1', bounds: Object.freeze({ x: 720, y: 440, width: 44, height: 60 }) }),
  Object.freeze({ id: 'mooncap-2', bounds: Object.freeze({ x: 1560, y: 570, width: 44, height: 60 }) }),
  Object.freeze({ id: 'mooncap-3', bounds: Object.freeze({ x: 2290, y: 420, width: 44, height: 60 }) }),
  Object.freeze({ id: 'mooncap-4', bounds: Object.freeze({ x: 3520, y: 440, width: 44, height: 60 }) }),
  Object.freeze({ id: 'mooncap-5', bounds: Object.freeze({ x: 4760, y: 420, width: 44, height: 60 }) }),
]);

const checkpoints = Object.freeze([
  Object.freeze({
    id: 'lantern-grove',
    bounds: Object.freeze({ x: 1792, y: 592, width: 96, height: 112 }),
    respawnBody: playerBodyAt(1818, 640),
  }),
  Object.freeze({
    id: 'elder-root',
    bounds: Object.freeze({ x: 3968, y: 592, width: 96, height: 112 }),
    respawnBody: playerBodyAt(3994, 640),
  }),
]);

const hazards = Object.freeze([
  Object.freeze({ id: 'thorns-1', bounds: Object.freeze({ x: 1088, y: 674, width: 128, height: 30 }) }),
  Object.freeze({ id: 'thorns-2', bounds: Object.freeze({ x: 2752, y: 674, width: 192, height: 30 }) }),
  Object.freeze({ id: 'poison-bloom', bounds: Object.freeze({ x: 4416, y: 626, width: 90, height: 78 }) }),
]);

export const MOSSY_CAVERN_3_LEVEL: MossyCavern3Level = Object.freeze({
  checkpoints,
  collisionLayers: Object.freeze(['terrain']),
  crystals,
  deathY: MOSSY_CAVERN_3_WORLD_HEIGHT + 192,
  exit: Object.freeze({
    id: 'moon-gate',
    bounds: Object.freeze({ x: 5312, y: 544, width: 112, height: 160 }),
  }),
  hazards,
  map,
  spawnBody: playerBodyAt(128, 640),
});

export function checkpointById(
  level: MossyCavern3Level,
  id: string | null,
): MossyCavern3Checkpoint | undefined {
  return id === null ? undefined : level.checkpoints.find((checkpoint) => checkpoint.id === id);
}
