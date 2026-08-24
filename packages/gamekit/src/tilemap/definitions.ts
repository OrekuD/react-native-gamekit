import { tileError } from './errors';
import type {
  TileCell2D,
  TileLayer2D,
  TileMap2D,
  TileSet2D,
  TileLayerInput2D,
  TileMapInput2D,
} from './types';
import type { Aabb2D } from '../geometry/types';

/** Frozen internal chunk size in cells (both axes). T16.0 contract. */
export const TILE_CHUNK_SIZE = 16;

/**
 * Floor division truncating toward negative infinity — REQUIRED for
 * negative cell coordinates (T16.0 contract).
 */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function defineTileSet2D(input: {
  readonly tiles: Readonly<Record<string, { readonly frame: string; readonly collision?: 'solid' | 'one-way-up' }>>;
}): TileSet2D {
  if (input === null || typeof input !== 'object' || input.tiles === null || typeof input.tiles !== 'object') {
    throw tileError('tiles', 'must be an object of named tile definitions');
  }
  const names: string[] = [];
  const tiles: Record<string, { frame: string; collision?: 'solid' | 'one-way-up' }> = {};
  const idOfName: Record<string, number> = {};
  const nameOfId: Record<number, string> = {};
  const collisionOfId: Record<number, 'solid' | 'one-way-up'> = {};
  for (const [name, def] of Object.entries(input.tiles)) {
    if (name.length === 0) throw tileError('tiles', 'tile name must be non-empty');
    if (typeof def?.frame !== 'string' || def.frame.length === 0) {
      throw tileError(`tiles.${name}.frame`, 'must be a non-empty frame name');
    }
    if (def.collision !== undefined && def.collision !== 'solid' && def.collision !== 'one-way-up') {
      throw tileError(`tiles.${name}.collision`, `must be "solid", "one-way-up", or omitted; got ${JSON.stringify(def.collision)}`);
    }
    names.push(name);
    const id = names.length;
    tiles[name] = Object.freeze({ ...def });
    idOfName[name] = id;
    nameOfId[id] = name;
    if (def.collision !== undefined) collisionOfId[id] = def.collision;
  }
  if (names.length === 0) throw tileError('tiles', 'must declare at least one tile');
  if (names.length > 0xffff) throw tileError('tiles', 'v1 supports at most 65535 distinct tiles');
  return Object.freeze({
    names: Object.freeze(names),
    tiles: Object.freeze(tiles),
    idOfName: Object.freeze(idOfName),
    nameOfId: Object.freeze(nameOfId),
    collisionOfId: Object.freeze(collisionOfId),
  });
}

function assertSafeInt(value: number, path: string): void {
  if (!Number.isSafeInteger(value)) {
    throw tileError(path, `must be a safe integer; got ${String(value)}`);
  }
}

export function defineTileLayer2D(
  input: TileLayerInput2D,
  tileset: TileSet2D,
): TileLayer2D {
  const p = `layers[${JSON.stringify(input?.id ?? '')}]`;
  if (input === null || typeof input !== 'object') throw tileError(p, 'must be an object');
  if (typeof input.id !== 'string' || input.id.length === 0) throw tileError(`${p}.id`, 'must be a non-empty string');
  assertSafeInt(input.width, `${p}.width`);
  assertSafeInt(input.height, `${p}.height`);
  if (input.width <= 0 || input.width > 8192) throw tileError(`${p}.width`, `must be in 1..8192; got ${input.width}`);
  if (input.height <= 0 || input.height > 8192) throw tileError(`${p}.height`, `must be in 1..8192; got ${input.height}`);
  if (!Array.isArray(input.data)) throw tileError(`${p}.data`, 'must be a row-major array of tile ids');
  const expected = input.width * input.height;
  if (input.data.length !== expected) {
    throw tileError(`${p}.data`, `length ${input.data.length} must equal width*height (${expected})`);
  }
  const data: number[] = new Array(expected).fill(0);
  for (let i = 0; i < expected; i++) {
    const v = input.data[i]!;
    if (v === 0) continue;
    if (!Number.isSafeInteger(v) || tileset.nameOfId[v] === undefined) {
      throw tileError(`${p}.data[${i}]`, `unknown tile id ${String(v)} for the bound tileset`);
    }
    data[i] = v;
  }
  return Object.freeze({
    id: input.id,
    width: input.width,
    height: input.height,
    collidable: input.collidable ?? true,
    data,
  });
}

export function defineTileMap2D(input: TileMapInput2D): TileMap2D {
  if (input === null || typeof input !== 'object') throw tileError('map', 'must be an object');
  const cw = input.cellSize?.width;
  const ch = input.cellSize?.height;
  if (typeof cw !== 'number' || !Number.isFinite(cw) || cw <= 0) throw tileError('cellSize.width', 'must be finite and > 0');
  if (typeof ch !== 'number' || !Number.isFinite(ch) || ch <= 0) throw tileError('cellSize.height', 'must be finite and > 0');
  const origin = { x: input.origin?.x ?? 0, y: input.origin?.y ?? 0 };
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw tileError('origin', 'must be finite');

  const layers: TileLayer2D[] = [];
  const layerById: Record<string, TileLayer2D> = {};
  for (const layerInput of input.layers) {
    const layer = defineTileLayer2D(layerInput, input.tileset);
    if (layerById[layer.id] !== undefined) {
      throw tileError('layers', `duplicate layer id ${JSON.stringify(layer.id)}`);
    }
    layers.push(layer);
    layerById[layer.id] = layer;
  }

  // World bounds cover every layer.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const layer of layers) {
    minX = Math.min(minX, origin.x);
    minY = Math.min(minY, origin.y);
    maxX = Math.max(maxX, origin.x + layer.width * cw);
    maxY = Math.max(maxY, origin.y + layer.height * ch);
  }
  if (layers.length === 0) throw tileError('layers', 'must declare at least one layer');

  const worldBounds: Aabb2D = Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });

  // Internal chunk index: key `${layerId}|${ccx},${ccy}` -> Int32Array of
  // TILE_CHUNK_SIZE*TILE_CHUNK_SIZE tile ids (0 = empty), row-major within
  // the chunk. Built eagerly; all bundled chunks stay in memory in v1.
  const chunks = new Map<string, Int32Array>();
  for (const layer of layers) {
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const v = layer.data[y * layer.width + x]!;
        if (v === 0) continue;
        const ccx = floorDiv(x, TILE_CHUNK_SIZE);
        const ccy = floorDiv(y, TILE_CHUNK_SIZE);
        const key = `${layer.id}|${ccx},${ccy}`;
        let chunk = chunks.get(key);
        if (chunk === undefined) {
          chunk = new Int32Array(TILE_CHUNK_SIZE * TILE_CHUNK_SIZE);
          chunks.set(key, chunk);
        }
        const lx = x - ccx * TILE_CHUNK_SIZE;
        const ly = y - ccy * TILE_CHUNK_SIZE;
        chunk[ly * TILE_CHUNK_SIZE + lx] = v;
      }
    }
  }

  const map: TileMap2D & { __chunks: Map<string, Int32Array> } = Object.freeze({
    cellSize: Object.freeze({ width: cw, height: ch }),
    origin,
    tileset: input.tileset,
    layers: Object.freeze(layers),
    layerById: Object.freeze(layerById),
    worldBounds,
    chunkSize: TILE_CHUNK_SIZE,
    __chunks: chunks,
  }) as TileMap2D & { __chunks: Map<string, Int32Array> };
  return map;
}

/** Internal: read one cell's tile id (0 when outside the finite map). */
export function tileAt(map: TileMap2D, layerId: string, cx: number, cy: number): number {
  const layer = map.layerById[layerId];
  if (layer === undefined) return 0;
  if (cx < 0 || cy < 0 || cx >= layer.width || cy >= layer.height) return 0;
  return layer.data[cy * layer.width + cx]!;
}

/** Convert a cell coordinate to its world AABB. */
export function cellAabb(map: TileMap2D, cx: number, cy: number): Aabb2D {
  return Object.freeze({
    x: map.origin.x + cx * map.cellSize.width,
    y: map.origin.y + cy * map.cellSize.height,
    width: map.cellSize.width,
    height: map.cellSize.height,
  });
}

/** Frozen immutable query result builder. */
export function makeCell(map: TileMap2D, layerId: string, cx: number, cy: number, tileId: number): TileCell2D {
  return Object.freeze({
    layerId,
    tileId,
    tileName: map.tileset.nameOfId[tileId]!,
    collision: map.tileset.collisionOfId[tileId],
    cell: Object.freeze({ x: cx, y: cy }),
    aabb: cellAabb(map, cx, cy),
  });
}
