import { tileError } from './errors';
import type { TileMapInput2D, TileSet2D } from './types';

/**
 * Narrow Tiled JSON adapter (T16.5, hardened per T16-F6).
 *
 * Accepts ONLY the finite orthogonal subset used by the reference level:
 * - `orientation: "orthogonal"`, `infinite: false`
 * - `layers` of `type: "tilelayer"` with inline numeric `data` (no base64,
 *   no compression, no chunks)
 * - EVERY other layer type (objectgroup, group, imagelayer, ...) is rejected
 *   with its exact source path — nothing silently disappears
 * - Nonzero `offsetx`/`offsety` are rejected (v1 has no layer offsets)
 * - No per-tile flips (high GID bits) — rejected with a source path
 *
 * The root value, options object, and every layer entry are validated BEFORE
 * any property access, so malformed input always surfaces as a structured
 * TileMapError instead of a TypeError. Raw Tiled JSON never enters
 * fixed-step or rendering hot paths; the output is a normalized Gamekit map
 * input.
 */
export interface TiledAdapterOptions {
  /**
   * Map Tiled global tile ids to Gamekit tile names. The referenced names
   * must exist on the provided tileset.
   */
  readonly gidToTileName: Readonly<Record<number, string>>;
  /** Layers to convert, in order. Defaults to every tilelayer. */
  readonly layerIds?: readonly string[];
  /** Layers that contribute collision; unlisted layers stay decorative. */
  readonly collidableLayers?: readonly string[];
}

function reject(cond: boolean, path: string, message: string): void {
  if (cond) throw tileError(path, message);
}

function assertPlainObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw tileError(path, `expected an object; got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`);
  }
}

export function parseTiledMap2D(
  json: unknown,
  tileset: TileSet2D,
  options: TiledAdapterOptions,
): TileMapInput2D {
  // Validate inputs BEFORE any property access (T16-F6).
  assertPlainObject(json, 'root');
  assertPlainObject(options as unknown, 'options');
  const gidMap = options.gidToTileName as Record<string, string> | null;
  if (gidMap === null || typeof gidMap !== 'object' || Array.isArray(gidMap)) {
    throw tileError('options.gidToTileName', 'must be an object mapping gids to tile names');
  }
  if (options.layerIds !== undefined) {
    if (!Array.isArray(options.layerIds)) throw tileError('options.layerIds', 'must be an array of layer names');
    for (let i = 0; i < options.layerIds.length; i++) {
      if (typeof options.layerIds[i] !== 'string') {
        throw tileError(`options.layerIds[${i}]`, 'must be a string');
      }
    }
  }
  if (options.collidableLayers !== undefined) {
    if (!Array.isArray(options.collidableLayers)) throw tileError('options.collidableLayers', 'must be an array of layer names');
    for (let i = 0; i < options.collidableLayers.length; i++) {
      if (typeof options.collidableLayers[i] !== 'string') {
        throw tileError(`options.collidableLayers[${i}]`, 'must be a string');
      }
    }
  }
  if (tileset === undefined || tileset.idOfName === undefined) {
    throw tileError('tileset', 'must be a value produced by defineTileSet2D');
  }

  const root = json as Record<string, unknown>;
  reject(root.orientation !== 'orthogonal', 'root.orientation', `only "orthogonal" is supported; got ${JSON.stringify(root.orientation)}`);
  reject(root.infinite === true, 'root.infinite', 'infinite maps are not supported in v1');
  const width = root.width;
  const height = root.height;
  reject(typeof width !== 'number' || !Number.isSafeInteger(width) || width <= 0, 'root.width', 'must be a positive integer');
  reject(typeof height !== 'number' || !Number.isSafeInteger(height) || height <= 0, 'root.height', 'must be a positive integer');
  const tw = root.tilewidth;
  const th = root.tileheight;
  reject(typeof tw !== 'number' || !Number.isFinite(tw) || tw <= 0, 'root.tilewidth', 'must be finite and > 0');
  reject(typeof th !== 'number' || !Number.isFinite(th) || th <= 0, 'root.tileheight', 'must be finite and > 0');

  reject(!Array.isArray(root.layers), 'root.layers', 'must be an array of layer objects');
  const layersRaw = root.layers as unknown[];
  const wanted = options.layerIds;
  const collidableLayers = options.collidableLayers;

  const layers: TileMapInput2D['layers'] = [];
  layersRaw.forEach((rawLayerUnknown, index) => {
    assertPlainObject(rawLayerUnknown, `layers[${index}]`);
    const layer = rawLayerUnknown as Record<string, unknown>;
    const rawType = layer.type;
    reject(
      typeof rawType !== 'string',
      `layers[${index}].type`,
      `must be a string layer type; got ${JSON.stringify(rawType)}`,
    );
    // T16-F6: tilelayer is the ONLY accepted type — every other layer type
    // (objectgroup, group, imagelayer, unknown future types) is rejected
    // with its exact source path instead of being silently skipped.
    reject(
      rawType !== 'tilelayer',
      `layers[${index}](${JSON.stringify(String(layer.name ?? ''))}).type`,
      `"${String(rawType)}" layers are not supported in v1`,
    );
    const name = typeof layer.name === 'string' && layer.name.length > 0 ? layer.name : `layer${index}`;
    if (wanted !== undefined && !wanted.includes(name)) return;
    const p = `layers[${index}](${JSON.stringify(name)})`;
    // T16-F6: nonzero layer offsets change cell placement — rejected, not ignored.
    reject(layer.offsetx !== undefined && layer.offsetx !== 0, `${p}.offsetx`, `nonzero layer offsets are not supported in v1; got ${JSON.stringify(layer.offsetx)}`);
    reject(layer.offsety !== undefined && layer.offsety !== 0, `${p}.offsety`, `nonzero layer offsets are not supported in v1; got ${JSON.stringify(layer.offsety)}`);
    reject(layer.encoding !== undefined && layer.encoding !== 'csv', `${p}.encoding`, `only inline CSV-free numeric arrays are supported; got ${JSON.stringify(layer.encoding)}`);
    reject(layer.compression !== undefined, `${p}.compression`, 'compressed layers are not supported in v1');
    reject(layer.chunks !== undefined, `${p}.chunks`, 'chunked (infinite) layers are not supported in v1');
    reject(!Array.isArray(layer.data), `${p}.data`, 'must be an inline array of gids');
    const layerWidth = layer.width;
    const layerHeight = layer.height;
    reject(layerWidth !== width, `${p}.width`, `must equal map width ${String(width)}`);
    reject(layerHeight !== height, `${p}.height`, `must equal map height ${String(height)}`);

    const gidData = layer.data as unknown[];
    reject(gidData.length !== (width as number) * (height as number), `${p}.data`, `length must equal width*height (${String(width)}*${String(height)})`);

    // Convert gids -> Gamekit ids. Flip bits unsupported.
    const out: number[] = new Array(gidData.length);
    for (let i = 0; i < gidData.length; i++) {
      const rawUnknown = gidData[i];
      const raw = typeof rawUnknown === 'number' ? rawUnknown : -1;
      reject(!Number.isSafeInteger(raw) || raw < 0, `${p}.data[${i}]`, `must be a non-negative safe integer; got ${JSON.stringify(rawUnknown)}`);
      if (raw === 0) {
        out[i] = 0;
        continue;
      }
      const FLIP_BITS = 0x80000000 | 0x40000000 | 0x20000000;
      reject((raw & FLIP_BITS) !== 0, `${p}.data[${i}]`, 'per-tile flip/rotation flags are not supported in v1');
      const mapped = gidMap[raw];
      reject(mapped === undefined, `${p}.data[${i}]`, `gid ${raw} has no mapping in gidToTileName`);
      const gamekitId = tileset.idOfName[mapped as string] ?? -1;
      reject(gamekitId === -1, `${p}.data[${i}]`, `mapped tile name ${JSON.stringify(mapped)} is missing from the bound tileset`);
      out[i] = gamekitId;
    }

    layers.push({
      id: name,
      width: width as number,
      height: height as number,
      data: out,
      collidable: collidableLayers ? collidableLayers.includes(name) : true,
    });
  });

  reject(layers.length === 0, 'layers', 'no tilelayers matched; at least one is required');

  return {
    cellSize: { width: tw as number, height: th as number },
    tileset,
    layers,
    origin: { x: 0, y: 0 },
  };
}
