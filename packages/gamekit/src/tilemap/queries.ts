import type { Aabb2D, Point2D } from '../geometry/types';
import type { TileCell2D, TileMap2D } from './types';
import { forEachCellInSpan, makeCell } from './definitions';

/**
 * Bounded cell queries (T16.2, T16-F6).
 *
 * Deterministic order: layer order (map declaration), then row-major within
 * a layer. Spans are clamped to the finite map before iteration; queries
 * outside the map return an empty frozen array. All reads flow through the
 * private chunk index — each overlapped 16x16 chunk region is fetched once.
 */

function clampSpan(
  layer: { width: number; height: number },
  minCx: number, minCy: number, maxCx: number, maxCy: number,
): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const x0 = Math.max(0, minCx);
  const y0 = Math.max(0, minCy);
  const x1 = Math.min(layer.width - 1, maxCx);
  const y1 = Math.min(layer.height - 1, maxCy);
  if (x0 > x1 || y0 > y1) return undefined;
  return { x0, y0, x1, y1 };
}

function collectSpan(
  map: TileMap2D,
  layerId: string,
  span: { x0: number; y0: number; x1: number; y1: number },
  out: TileCell2D[],
): void {
  forEachCellInSpan(map, layerId, span.x0, span.y0, span.x1, span.y1, (cx, cy, id) => {
    out.push(makeCell(map, layerId, cx, cy, id));
  });
}

/** All non-empty cells in the given layers overlapping the point. */
export function cellsAtPoint(
  map: TileMap2D,
  point: Point2D,
  layerIds?: readonly string[],
): readonly TileCell2D[] {
  const out: TileCell2D[] = [];
  const cx = Math.floor((point.x - map.origin.x) / map.cellSize.width);
  const cy = Math.floor((point.y - map.origin.y) / map.cellSize.height);
  for (const layer of map.layers) {
    if (layerIds !== undefined && !layerIds.includes(layer.id)) continue;
    const span = clampSpan(layer, cx, cy, cx, cy);
    if (span === undefined) continue;
    collectSpan(map, layer.id, span, out);
  }
  return Object.freeze(out);
}

/** All non-empty cells whose AABBs intersect the query AABB. */
export function cellsInAabb(
  map: TileMap2D,
  aabb: Aabb2D,
  layerIds?: readonly string[],
): readonly TileCell2D[] {
  const out: TileCell2D[] = [];
  const minCx = Math.floor((aabb.x - map.origin.x) / map.cellSize.width);
  const minCy = Math.floor((aabb.y - map.origin.y) / map.cellSize.height);
  const maxCx = Math.floor((aabb.x + aabb.width - map.origin.x - 1e-9) / map.cellSize.width);
  const maxCy = Math.floor((aabb.y + aabb.height - map.origin.y - 1e-9) / map.cellSize.height);
  for (const layer of map.layers) {
    if (layerIds !== undefined && !layerIds.includes(layer.id)) continue;
    const span = clampSpan(layer, minCx, minCy, maxCx, maxCy);
    if (span === undefined) continue;
    collectSpan(map, layer.id, span, out);
  }
  return Object.freeze(out);
}

/**
 * Cells overlapped by the swept bounds of a body moving by `displacement`.
 * The swept bounds are the union AABB of start and end positions — bounded,
 * never unbounded even for very large displacements (clamped to the map).
 */
export function cellsInSweptBounds(
  map: TileMap2D,
  body: Aabb2D,
  displacement: { x: number; y: number },
  layerIds?: readonly string[],
): readonly TileCell2D[] {
  const minX = Math.min(body.x, body.x + displacement.x);
  const minY = Math.min(body.y, body.y + displacement.y);
  return cellsInAabb(
    map,
    { x: minX, y: minY, width: body.width + Math.abs(displacement.x), height: body.height + Math.abs(displacement.y) },
    layerIds,
  );
}

/**
 * Non-empty cells inside the visible region (camera bounds + overscan).
 * Same deterministic ordering as `cellsInAabb`.
 */
export function visibleCells(
  map: TileMap2D,
  visibleBounds: Aabb2D,
  overscanCells: number,
  layerIds?: readonly string[],
): readonly TileCell2D[] {
  const out: TileCell2D[] = [];
  const minCx = Math.floor((visibleBounds.x - map.origin.x) / map.cellSize.width) - overscanCells;
  const minCy = Math.floor((visibleBounds.y - map.origin.y) / map.cellSize.height) - overscanCells;
  const maxCx =
    Math.ceil((visibleBounds.x + visibleBounds.width - map.origin.x) / map.cellSize.width) - 1 + overscanCells;
  const maxCy =
    Math.ceil((visibleBounds.y + visibleBounds.height - map.origin.y) / map.cellSize.height) - 1 + overscanCells;
  for (const layer of map.layers) {
    if (layerIds !== undefined && !layerIds.includes(layer.id)) continue;
    const span = clampSpan(layer, minCx, minCy, maxCx, maxCy);
    if (span === undefined) continue;
    collectSpan(map, layer.id, span, out);
  }
  return Object.freeze(out);
}
