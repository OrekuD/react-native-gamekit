/**
 * Deterministic spatial hash broad phase (T11.5).
 *
 * `buildSpatialHash2D` validates and freezes a plain immutable index;
 * `querySpatialHash2D` returns candidate ids whose bounds share a cell
 * with the query bounds, deduplicated and in original insertion order. The
 * broad phase is conservative: it returns candidates, never a narrow-phase
 * collision claim.
 */
import type { Aabb2D } from '../geometry/types';
import {
  assertValidAabb2D,
  GeometryError,
} from '../geometry/validation';

/** One indexed item with a stable identifier and AABB bounds. */
export interface SpatialHashItem2D {
  /** Stable identifier; must be unique within one index. */
  readonly id: string;
  /** AABB bounds in world coordinates. */
  readonly bounds: Aabb2D;
}

/** A frozen, immutable spatial-hash index. */
export interface SpatialHashIndex2D {
  /** Positive finite cell size in world units. */
  readonly cellSize: number;
  /** The ordered items, deduplicated by identifier. */
  readonly items: readonly SpatialHashItem2D[];
}

/** Options for building an index. */
export interface BuildSpatialHash2DOptions {
  /** Items to index, in the order candidates must be returned. */
  readonly items: readonly SpatialHashItem2D[];
  /** Positive finite cell size in world units. */
  readonly cellSize: number;
}

/** Build a spatial-hash index over the given items. */
export function buildSpatialHash2D(options: BuildSpatialHash2DOptions): SpatialHashIndex2D {
  const { items, cellSize } = options;
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'cellSize',
      `expected a positive finite number, got ${String(cellSize)}`,
    );
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new GeometryError(
        'GEOMETRY_INVALID_NUMBER',
        'items.id',
        `expected unique item ids, got duplicate "${item.id}"`,
      );
    }
    seen.add(item.id);
    assertValidAabb2D(item.bounds, `items.${item.id}.bounds`);
  }
  return Object.freeze({
    cellSize,
    items: Object.freeze(items.map((item) => Object.freeze(item))),
  });
}

/** Query candidates whose bounds share a cell with the query bounds. */
export function querySpatialHash2D(index: SpatialHashIndex2D, bounds: Aabb2D): readonly string[] {
  assertValidAabb2D(bounds, 'bounds');
  const result: string[] = [];
  for (const item of index.items) {
    if (sharesCell(item.bounds, bounds, index.cellSize)) {
      result.push(item.id);
    }
  }
  return result;
}

/** True when the two AABBs occupy at least one common cell. */
function sharesCell(first: Aabb2D, second: Aabb2D, cellSize: number): boolean {
  const firstMinX = Math.floor(first.x / cellSize);
  const firstMaxX = Math.floor((first.x + first.width) / cellSize);
  const firstMinY = Math.floor(first.y / cellSize);
  const firstMaxY = Math.floor((first.y + first.height) / cellSize);
  const secondMinX = Math.floor(second.x / cellSize);
  const secondMaxX = Math.floor((second.x + second.width) / cellSize);
  const secondMinY = Math.floor(second.y / cellSize);
  const secondMaxY = Math.floor((second.y + second.height) / cellSize);
  return (
    firstMinX <= secondMaxX &&
    firstMaxX >= secondMinX &&
    firstMinY <= secondMaxY &&
    firstMaxY >= secondMinY
  );
}
