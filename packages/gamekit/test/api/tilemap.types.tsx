import {
  defineTileMap2D,
  defineTileSet2D,
  movePlatformerBody2D,
} from 'rn-gamekit/tilemap';
import type { TileMap2D, TileSet2D } from 'rn-gamekit/tilemap';

const tileset: TileSet2D = defineTileSet2D({
  tiles: {
    grass: { frame: 'grass', collision: 'solid' },
    platform: { frame: 'platform', collision: 'one-way-up' },
  },
});

const level: TileMap2D = defineTileMap2D({
  cellSize: { width: 16, height: 16 },
  origin: { x: 0, y: 0 },
  tileset,
  layers: [
    { id: 'terrain', width: 4, height: 2, data: [1, 1, 0, 0, 2, 2, 2, 2] },
  ],
});

const result = movePlatformerBody2D({
  body: { x: 8, y: 8, width: 12, height: 12 },
  velocity: { x: 40, y: 100 },
  deltaSeconds: 0.016,
  map: level,
  collisionLayers: ['terrain'],
  dropThroughOneWay: false,
  floorSnapDistance: 2,
});

void result.body;
void result.velocity;
void result.displacement;
void result.remainingDisplacement;
void result.contacts.floor?.cell.tileName;
void result.contacts.all.length;

void level.layerById;

export { level, result };
