/**
 * Deterministic spatial hash broad phase (T11.5).
 *
 * `buildSpatialHash2D` validates and freezes a plain immutable index value;
 * the per-cell buckets live in an internal WeakMap so callers can never
 * mutate or depend on them. `querySpatialHash2D` visits only the query's
 * cells and returns candidate ids deduplicated and in original insertion
 * order. The broad phase is conservative: it returns candidates, never a
 * narrow-phase collision claim.
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

/** Opaque per-index internal buckets and order, never exposed publicly. */
const internalState = new WeakMap<
  SpatialHashIndex2D,
  { readonly cells: ReadonlyMap<string, readonly string[]>; readonly order: ReadonlyMap<string, number> }
>();

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
  const cells = new Map<string, string[]>();
  const order = new Map<string, number>();
  const frozenItems: SpatialHashItem2D[] = [];
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
    const frozen = Object.freeze(item);
    frozenItems.push(frozen);
    order.set(item.id, frozenItems.length - 1);
    for (const cell of cellsOf(item.bounds, cellSize)) {
      const key = cellKey(cell.x, cell.y);
      const bucket = cells.get(key);
      if (bucket === undefined) {
        cells.set(key, [item.id]);
      } else {
        bucket.push(item.id);
      }
    }
  }
  const index = Object.freeze({
    cellSize,
    items: Object.freeze(frozenItems),
  });
  internalState.set(index, {
    cells: new Map([...cells.entries()].map(([key, ids]) => [key, Object.freeze(ids)])),
    order: new Map(order),
  });
  return index;
}

/** Query candidates whose bounds share a cell with the query bounds. */
export function querySpatialHash2D(index: SpatialHashIndex2D, bounds: Aabb2D): readonly string[] {
  assertValidAabb2D(bounds, 'bounds');
  const state = internalState.get(index);
  if (state === undefined) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'index',
      'expected an index built by buildSpatialHash2D',
    );
  }
  const seen = new Set<string>();
  const collected: string[] = [];
  for (const cell of cellsOf(bounds, index.cellSize)) {
    const bucket = state.cells.get(cellKey(cell.x, cell.y));
    if (bucket === undefined) {
      continue;
    }
    for (const id of bucket) {
      if (!seen.has(id)) {
        seen.add(id);
        collected.push(id);
      }
    }
  }
  // Preserve original insertion order regardless of bucket order.
  collected.sort((a, b) => state.order.get(a)! - state.order.get(b)!);
  return collected;
}

interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Every cell an AABB occupies, in deterministic order. */
function* cellsOf(bounds: Aabb2D, cellSize: number): Generator<Cell> {
  const minX = Math.floor(bounds.x / cellSize);
  const maxX = Math.floor((bounds.x + bounds.width) / cellSize);
  const minY = Math.floor(bounds.y / cellSize);
  const maxY = Math.floor((bounds.y + bounds.height) / cellSize);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      yield { x, y };
    }
  }
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}
