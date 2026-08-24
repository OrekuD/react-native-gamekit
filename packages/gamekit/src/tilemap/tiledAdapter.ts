import { tileError } from './errors';
import type { TileMapInput2D, TileSet2D } from './types';

/**
 * Narrow Tiled JSON adapter (T16.5).
 *
 * Accepts ONLY the finite orthogonal subset used by the reference level:
 * - `orientation: "orthogonal"`, `infinite: false`
 * - `layers` of `type: "tilelayer"` with inline numeric `data` (no base64,
 *   no compression, no chunks)
 * - `objects`/`objectgroup` layers are rejected
 * - No per-tile flips (high GID bits) — rejected with a source path
 *
 * Raw Tiled JSON never enters fixed-step or rendering hot paths; the output
 * is a normalized Gamekit map input.
 */
export interface TiledAdapterOptions {
  /**
   * Map Tiled global tile ids to Gamekit tile names. The referenced names
   * must exist on the provided tileset.
   */
  readonly gidToTileName: Readonly<Record<number, string>>;
  /** Layers to convert, in order. Defaults to every tilelayer. */
  readonly layerIds?: readonly string[];
  /** Decorative flag applied to converted layers. Defaults to true for
   * layers not listed in `collisionLayers`? Kept explicit instead: */
  readonly collidableLayers?: readonly string[];
}

interface TiledJsonLike {
  orientation?: unknown;
  infinite?: unknown;
  width?: unknown;
  height?: unknown;
  tilewidth?: unknown;
  tileheight?: unknown;
  layers?: unknown;
}

function reject(cond: boolean, path: string, message: string): void {
  if (cond) throw tileError(path, message);
}

export function parseTiledMap2D(
  json: unknown,
  tileset: TileSet2D,
  options: TiledAdapterOptions,
): TileMapInput2D {
  const root = json as TiledJsonLike;
  reject(root.orientation !== 'orthogonal', 'orientation', `only "orthogonal" is supported; got ${JSON.stringify(root.orientation)}`);
  reject(root.infinite === true, 'infinite', 'infinite maps are not supported in v1');
  const width = root.width;
  const height = root.height;
  reject(typeof width !== 'number' || !Number.isSafeInteger(width) || width <= 0, 'width', 'must be a positive integer');
  reject(typeof height !== 'number' || !Number.isSafeInteger(height) || height <= 0, 'height', 'must be a positive integer');
  const tw = root.tilewidth;
  const th = root.tileheight;
  reject(typeof tw !== 'number' || !Number.isFinite(tw) || tw <= 0, 'tilewidth', 'must be finite and > 0');
  reject(typeof th !== 'number' || !Number.isFinite(th) || th <= 0, 'tileheight', 'must be finite and > 0');

  const layersRaw = Array.isArray(root.layers) ? root.layers : [];
  const wanted = options.layerIds;
  const collidableLayers = options.collidableLayers;

  const layers: TileMapInput2D['layers'] = [];
  layersRaw.forEach((rawLayer, index) => {
    const layer = rawLayer as {
      type?: unknown; name?: unknown; data?: unknown; width?: unknown; height?: unknown;
      objects?: unknown; compression?: unknown; encoding?: unknown; chunks?: unknown;
    };
    if (layer.type === 'objectgroup') {
      throw tileError(`layers[${index}]`, 'object layers are not supported in v1');
    }
    if (layer.type !== 'tilelayer') return;
    const name = typeof layer.name === 'string' ? layer.name : `layer${index}`;
    if (wanted !== undefined && !wanted.includes(name)) return;
    const p = `layers[${index}](${JSON.stringify(name)})`;
    reject(layer.encoding !== undefined && layer.encoding !== 'csv', `${p}.encoding`, `only inline CSV-free numeric arrays are supported; got ${JSON.stringify(layer.encoding)}`);
    reject(layer.compression !== undefined, `${p}.compression`, 'compressed layers are not supported in v1');
    reject(layer.chunks !== undefined, `${p}.chunks`, 'chunked (infinite) layers are not supported in v1');
    reject(!Array.isArray(layer.data), `${p}.data`, 'must be an inline array of gids');
    const layerWidth = layer.width;
    const layerHeight = layer.height;
    reject(typeof layerWidth !== 'number' || layerWidth !== width, `${p}.width`, `must equal map width ${String(width)}`);
    reject(typeof layerHeight !== 'number' || layerHeight !== height, `${p}.height`, `must equal map height ${String(height)}`);

    const gidData = layer.data as unknown[];
    reject(gidData.length !== (width as number) * (height as number), `${p}.data`, `length must equal width*height (${String(width)}*${String(height)})`);

    // Convert gids -> Gamekit ids. Flip bits (0x80000000 and up) unsupported.
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
      const gid = raw;
      const mapped = options.gidToTileName[gid];
      reject(mapped === undefined, `${p}.data[${i}]`, `gid ${gid} has no mapping in gidToTileName`);
      const tileName = mapped as string;
      const gamekitId = tileset.idOfName[tileName] ?? -1;
      reject(gamekitId === -1, `${p}.data[${i}]`, `mapped tile name ${JSON.stringify(tileName)} is missing from the bound tileset`);
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
