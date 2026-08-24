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
import { recordChunkRead } from './chunkStats';

/** Frozen internal chunk size in cells (both axes). T16.0 contract. */
export const TILE_CHUNK_SIZE = 16;

/**
 * Floor division truncating toward negative infinity — REQUIRED for
 * negative cell coordinates (T16.0 contract).
 */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

// ---------------------------------------------------------------------------
// Private chunk index (T16-F1/F6)
//
// The index is stored in a module-private WeakMap keyed by the map value, so
// consumers can neither mutate it nor depend on it through the public map.
// Every runtime tile read flows through `tileAt`, which consults this index.
// Visit instrumentation lives in ./chunkStats and is re-exported only via
// rn-gamekit/testing (T16-RF4).
// ---------------------------------------------------------------------------

type ChunkIndex = Map<string, Int32Array>;

const chunkIndexes = new WeakMap<TileMap2D, ChunkIndex>();

function buildChunkIndex(layers: readonly TileLayer2D[]): ChunkIndex {
  const chunks: ChunkIndex = new Map<string, Int32Array>();
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
  return chunks;
}

export function defineTileSet2D(input: {
  readonly tiles: Readonly<Record<string, { readonly frame: string; readonly collision?: 'solid' | 'one-way-up' }>>;
}): TileSet2D {
  if (input === null || typeof input !== 'object' || input.tiles === null || typeof input.tiles !== 'object' || Array.isArray(input.tiles)) {
    throw tileError('tiles', 'must be an object of named tile definitions');
  }
  const names: string[] = [];
  const tiles: Record<string, { frame: string; collision?: 'solid' | 'one-way-up' }> = {};
  const idOfName: Record<string, number> = {};
  const nameOfId: Record<number, string> = {};
  const collisionOfId: Record<number, 'solid' | 'one-way-up'> = {};
  for (const [name, defUnknown] of Object.entries(input.tiles)) {
    if (name.length === 0) throw tileError('tiles', 'tile name must be non-empty');
    const def = defUnknown as { frame?: unknown; collision?: unknown } | null;
    if (def === null || typeof def !== 'object') {
      throw tileError(`tiles.${JSON.stringify(name)}`, 'must be a tile definition object');
    }
    if (typeof def.frame !== 'string' || def.frame.length === 0) {
      throw tileError(`tiles.${JSON.stringify(name)}.frame`, 'must be a non-empty frame name');
    }
    if (def.collision !== undefined && def.collision !== 'solid' && def.collision !== 'one-way-up') {
      throw tileError(`tiles.${JSON.stringify(name)}.collision`, `must be "solid", "one-way-up", or omitted; got ${JSON.stringify(def.collision)}`);
    }
    names.push(name);
    const id = names.length;
    tiles[name] = Object.freeze({ frame: def.frame, ...(def.collision !== undefined ? { collision: def.collision as 'solid' | 'one-way-up' } : {}) });
    idOfName[name] = id;
    nameOfId[id] = name;
    if (def.collision !== undefined) collisionOfId[id] = def.collision as 'solid' | 'one-way-up';
  }
  if (names.length === 0) throw tileError('tiles', 'must declare at least one tile');
  if (names.length > 0xffff) throw tileError('tiles', 'v1 supports at most 65535 distinct tiles');
  return Object.freeze({
    names: Object.freeze(names.slice()),
    tiles: Object.freeze(tiles),
    idOfName: Object.freeze(idOfName),
    nameOfId: Object.freeze(nameOfId),
    collisionOfId: Object.freeze(collisionOfId),
  });
}

function assertSafeInt(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw tileError(path, `must be a safe integer; got ${String(value)}`);
  }
}

export function defineTileLayer2D(
  input: TileLayerInput2D,
  tileset: TileSet2D,
): TileLayer2D {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw tileError('layers[]', 'must be a layer object');
  }
  const p = `layers[${JSON.stringify(input?.id ?? '')}]`;
  if (typeof input.id !== 'string' || input.id.length === 0) throw tileError(`${p}.id`, 'must be a non-empty string');
  assertSafeInt(input.width, `${p}.width`);
  assertSafeInt(input.height, `${p}.height`);
  if (input.width <= 0 || input.width > 8192) throw tileError(`${p}.width`, `must be in 1..8192; got ${input.width}`);
  if (input.height <= 0 || input.height > 8192) throw tileError(`${p}.height`, `must be in 1..8192; got ${input.height}`);
  if (!Array.isArray(input.data)) throw tileError(`${p}.data`, 'must be a row-major array of tile ids');
  // T16-F1: collidable is validated at runtime, never trusted from types.
  if (
    input.collidable !== undefined &&
    typeof input.collidable !== 'boolean'
  ) {
    throw tileError(`${p}.collidable`, `must be a boolean or omitted; got ${typeof input.collidable}`);
  }
  const expected = input.width * input.height;
  if (input.data.length !== expected) {
    throw tileError(`${p}.data`, `length ${input.data.length} must equal width*height (${expected})`);
  }
  const data: number[] = new Array(expected).fill(0);
  for (let i = 0; i < expected; i++) {
    const v = input.data[i];
    if (v === 0) continue;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || tileset.nameOfId[v] === undefined) {
      throw tileError(`${p}.data[${i}]`, `unknown tile id ${String(v)} for the bound tileset`);
    }
    data[i] = v;
  }
  return Object.freeze({
    id: input.id,
    width: input.width,
    height: input.height,
    collidable: input.collidable ?? true,
    // T16-F1: owned frozen copy — mutation attempts throw and never stick.
    data: Object.freeze(data),
  });
}

export function defineTileMap2D(input: TileMapInput2D): TileMap2D {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw tileError('map', 'must be an object');
  if (input.tileset === undefined || input.tileset.names === undefined) {
    throw tileError('tileset', 'must be a value produced by defineTileSet2D');
  }
  const cw = input.cellSize?.width;
  const ch = input.cellSize?.height;
  if (typeof cw !== 'number' || !Number.isFinite(cw) || cw <= 0) throw tileError('cellSize.width', 'must be finite and > 0');
  if (typeof ch !== 'number' || !Number.isFinite(ch) || ch <= 0) throw tileError('cellSize.height', 'must be finite and > 0');
  if (!Array.isArray(input.layers)) throw tileError('layers', 'must be an array of layer inputs');
  const originX = input.origin?.x ?? 0;
  const originY = input.origin?.y ?? 0;
  if (typeof originX !== 'number' || !Number.isFinite(originX)) throw tileError('origin.x', 'must be a finite number');
  if (typeof originY !== 'number' || !Number.isFinite(originY)) throw tileError('origin.y', 'must be a finite number');
  const origin: Point2DFrozen = Object.freeze({ x: originX, y: originY });

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
  if (layers.length === 0) throw tileError('layers', 'must declare at least one layer');

  // World bounds cover every layer.
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const layer of layers) {
    maxX = Math.max(maxX, origin.x + layer.width * cw);
    maxY = Math.max(maxY, origin.y + layer.height * ch);
  }

  const worldBounds: Aabb2D = Object.freeze({ x: origin.x, y: origin.y, width: maxX - origin.x, height: maxY - origin.y });

  const map: TileMap2D = Object.freeze({
    cellSize: Object.freeze({ width: cw, height: ch }),
    // T16-F1: frozen public origin.
    origin,
    tileset: input.tileset,
    layers: Object.freeze(layers.slice()),
    layerById: Object.freeze(layerById),
    worldBounds,
    chunkSize: TILE_CHUNK_SIZE,
  });

  // T16-F6: the chunk index lives OUTSIDE the public value.
  chunkIndexes.set(map, buildChunkIndex(layers));
  return map;
}

interface Point2DFrozen {
  readonly x: number;
  readonly y: number;
}

/** Internal: read one cell's tile id (0 when outside the finite map). */
export function tileAt(map: TileMap2D, layerId: string, cx: number, cy: number): number {
  const layer = map.layerById[layerId];
  if (layer === undefined) return 0;
  if (cx < 0 || cy < 0 || cx >= layer.width || cy >= layer.height) return 0;
  // T16-F6: every read flows through the private chunk index.
  const chunks = chunkIndexes.get(map);
  if (chunks === undefined) return 0;
  const ccx = floorDiv(cx, TILE_CHUNK_SIZE);
  const ccy = floorDiv(cy, TILE_CHUNK_SIZE);
  recordChunkRead();
  const chunk = chunks.get(`${layerId}|${ccx},${ccy}`);
  if (chunk === undefined) return 0;
  return chunk[(cy - ccy * TILE_CHUNK_SIZE) * TILE_CHUNK_SIZE + (cx - ccx * TILE_CHUNK_SIZE)]!;
}

/**
 * Internal: iterate non-empty cells inside an inclusive cell span in
 * global row-major order, fetching each overlapped chunk region once
 * (T16-F6). `visit` receives (layerId, cx, cy, tileId); returning false
 * from `visit` stops iteration early.
 */
export function forEachCellInSpan(
  map: TileMap2D,
  layerId: string,
  x0: number, y0: number, x1: number, y1: number,
  visit: (cx: number, cy: number, tileId: number) => boolean | void,
): void {
  const chunks = chunkIndexes.get(map);
  if (chunks === undefined) return;
  const bandY0 = floorDiv(y0, TILE_CHUNK_SIZE);
  const bandY1 = floorDiv(y1, TILE_CHUNK_SIZE);
  const bandX0 = floorDiv(x0, TILE_CHUNK_SIZE);
  const bandX1 = floorDiv(x1, TILE_CHUNK_SIZE);
  // T16-RF4: GLOBAL row-major order. For each chunk-Y band we fetch the
  // intersecting chunk references ONCE (one lookup per chunk), then iterate
  // global rows; within a row we visit the chunk-X segments left to right.
  // This is exactly global row-major while keeping lookups bounded by the
  // overlapped chunk regions.
  const bandRefs: (Int32Array | undefined)[] = [];
  for (let bcy = bandY0; bcy <= bandY1; bcy++) {
    const rowStart = Math.max(y0, bcy * TILE_CHUNK_SIZE);
    const rowEnd = Math.min(y1, (bcy + 1) * TILE_CHUNK_SIZE - 1);
    // Fetch every intersecting chunk reference once per band.
    bandRefs.length = 0;
    for (let bcx = bandX0; bcx <= bandX1; bcx++) {
      recordChunkRead();
      bandRefs.push(chunks.get(`${layerId}|${bcx},${bcy}`));
    }
    for (let cy = rowStart; cy <= rowEnd; cy++) {
      const ly = cy - bcy * TILE_CHUNK_SIZE;
      const rowBase = ly * TILE_CHUNK_SIZE;
      for (let bcx = bandX0; bcx <= bandX1; bcx++) {
        const chunk = bandRefs[bcx - bandX0];
        if (chunk === undefined) continue;
        const lxStart = Math.max(x0, bcx * TILE_CHUNK_SIZE) - bcx * TILE_CHUNK_SIZE;
        const lxEnd = Math.min(x1, (bcx + 1) * TILE_CHUNK_SIZE - 1) - bcx * TILE_CHUNK_SIZE;
        for (let lx = lxStart; lx <= lxEnd; lx++) {
          const v = chunk[rowBase + lx]!;
          if (v === 0) continue;
          const stop = visit(bcx * TILE_CHUNK_SIZE + lx, cy, v);
          if (stop === false) return;
        }
      }
    }
  }
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
