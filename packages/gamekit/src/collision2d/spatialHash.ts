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
  assertFiniteNumber,
  assertRecordShape,
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

/** A frozen, process-local handle. Copying/serializing it loses queryability. */
export interface SpatialHashIndex2D {
  /** Positive finite cell size in world units. */
  readonly cellSize: number;
  /** Cloned items in insertion order. Duplicate identifiers are rejected. */
  readonly items: readonly SpatialHashItem2D[];
}

/** Options for building an index. */
export interface BuildSpatialHash2DOptions {
  /** Items to index, in the order candidates must be returned. */
  readonly items: readonly SpatialHashItem2D[];
  /** Positive finite cell size in world units. */
  readonly cellSize: number;
}

/** Maximum cells an item or query may OCCUPY per axis (bounded execution). */
export const MAX_SPATIAL_HASH_SPAN_CELLS = 1024;

/**
 * Maximum cells visited by ONE item insert or ONE query (GS-COLLISION-02).
 *
 * The per-axis bound alone permits ~1M cell visits per operation. This
 * resource guard rejects oversized spans before enumerating cells; it is
 * not a guarantee of frame latency on any device.
 */
export const MAX_SPATIAL_HASH_TOTAL_CELLS = 65_536;

/**
 * Maximum item-to-cell references across an entire index. Overlapping
 * items count separately. This also bounds bucket references scanned by
 * any one query. Reuse static indexes and choose an appropriate cell size;
 * even an accepted index may be too costly to rebuild every frame.
 */
export const MAX_SPATIAL_HASH_CELL_REFERENCES = 262_144;

/** Opaque per-index internal buckets and order, never exposed publicly. */
const internalState = new WeakMap<
  SpatialHashIndex2D,
  { readonly cells: ReadonlyMap<string, readonly string[]>; readonly order: ReadonlyMap<string, number> }
>();

/** Build a spatial-hash index over the given items. */
export function buildSpatialHash2D(options: BuildSpatialHash2DOptions): SpatialHashIndex2D {
  assertRecordShape(options, 'options');
  const { items, cellSize } = options;
  assertFiniteNumber(cellSize, 'cellSize');
  if (cellSize <= 0) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'cellSize',
      `expected a positive finite number, got ${cellSize}`,
    );
  }
  const { prepared, order } = prepareItems(items, cellSize);
  const cells = new Map<string, string[]>();
  for (const { item, range } of prepared) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        const key = cellKey(x, y);
        const bucket = cells.get(key);
        if (bucket === undefined) {
          cells.set(key, [item.id]);
        } else {
          bucket.push(item.id);
        }
      }
    }
  }
  for (const bucket of cells.values()) Object.freeze(bucket);
  const index = Object.freeze({
    cellSize,
    items: Object.freeze(prepared.map(({ item }) => item)),
  });
  // Neither map escapes or changes after construction; copying them adds
  // work without adding ownership protection.
  internalState.set(index, { cells, order });
  return index;
}

interface PreparedItem {
  readonly item: SpatialHashItem2D;
  readonly range: CellRange;
}

/** Validate the complete aggregate before allocating any cell buckets. */
function prepareItems(items: readonly SpatialHashItem2D[], cellSize: number): {
  readonly prepared: readonly PreparedItem[];
  readonly order: ReadonlyMap<string, number>;
} {
  if (!Array.isArray(items)) {
    throw new GeometryError('GEOMETRY_INVALID_SHAPE', 'items', 'expected an array of items');
  }
  // Every item occupies at least one cell, so this check also bounds the
  // validation pass and rejects oversized sparse arrays without reading them.
  assertReferenceBudget(items.length);
  const order = new Map<string, number>();
  const prepared: PreparedItem[] = [];
  let references = 0;
  for (let position = 0; position < items.length; position += 1) {
    const source: SpatialHashItem2D = items[position]!;
    assertRecordShape(source, `items.${position}`);
    if (typeof source.id !== 'string') {
      throw new GeometryError('GEOMETRY_INVALID_SHAPE', `items.${position}.id`, 'expected a string identifier');
    }
    if (order.has(source.id)) {
      throw new GeometryError('GEOMETRY_DUPLICATE_ID', 'items.id', `expected unique item ids, got duplicate "${source.id}"`);
    }
    assertValidAabb2D(source.bounds, `items.${source.id}.bounds`);
    const { x, y, width, height } = source.bounds;
    const bounds = Object.freeze({ x, y, width, height });
    const range = rangeOf(bounds, cellSize);
    references += (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    assertReferenceBudget(references);
    const item = Object.freeze({ id: source.id, bounds });
    prepared.push({ item, range });
    order.set(item.id, position);
  }
  return { prepared, order };
}

function assertReferenceBudget(references: number): void {
  if (references > MAX_SPATIAL_HASH_CELL_REFERENCES) {
    throw new GeometryError(
      'GEOMETRY_SPATIAL_INDEX_RANGE',
      'items',
      `items require ${references} cell references, exceeding the aggregate maximum of ${MAX_SPATIAL_HASH_CELL_REFERENCES}`,
    );
  }
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
  const range = rangeOf(bounds, index.cellSize);
  const seen = new Set<string>();
  const collected: string[] = [];
  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      const bucket = state.cells.get(cellKey(x, y));
      if (bucket === undefined) continue;
      for (const id of bucket) {
        if (!seen.has(id)) {
          seen.add(id);
          collected.push(id);
        }
      }
    }
  }
  // Preserve original insertion order regardless of bucket order.
  collected.sort((a, b) => state.order.get(a)! - state.order.get(b)!);
  // The public result is frozen (T11-FF5): the immutable contract is
  // runtime-enforced, not only a type-level promise.
  return Object.freeze(collected);
}

interface CellRange {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Validate scalar loop limits once, without allocating per-cell objects. */
function rangeOf(bounds: Aabb2D, cellSize: number): CellRange {
  const minX = cellIndex(bounds.x, cellSize);
  const maxX = cellIndex(bounds.x + bounds.width, cellSize);
  const minY = cellIndex(bounds.y, cellSize);
  const maxY = cellIndex(bounds.y + bounds.height, cellSize);
  assertSpan(maxX - minX, 'x');
  assertSpan(maxY - minY, 'y');
  assertTotalCells(maxX - minX, maxY - minY);
  return { minX, maxX, minY, maxY };
}

/** Validate a derived cell index as a finite safe integer. */
function cellIndex(coord: number, cellSize: number): number {
  const index = Math.floor(coord / cellSize);
  if (!Number.isSafeInteger(index)) {
    throw new GeometryError(
      'GEOMETRY_SPATIAL_INDEX_RANGE',
      'bounds',
      `coordinate ${coord} produces an unsafe cell index`,
    );
  }
  return index;
}

/** Reject spans that would block the JS thread (bounded execution). */
function assertSpan(span: number, axis: 'x' | 'y'): void {
  const cells = span + 1; // The inclusive loop visits span + 1 cells.
  if (cells > MAX_SPATIAL_HASH_SPAN_CELLS) {
    throw new GeometryError(
      'GEOMETRY_SPATIAL_INDEX_RANGE',
      `bounds.${axis}`,
      `bounds occupy ${cells} cells, exceeding the maximum of ${MAX_SPATIAL_HASH_SPAN_CELLS}`,
    );
  }
}

/** Reject total occupied cells beyond the work budget (GS-COLLISION-02). */
function assertTotalCells(spanX: number, spanY: number): void {
  // Both axes already passed assertSpan, so the product cannot overflow.
  const total = (spanX + 1) * (spanY + 1);
  if (total > MAX_SPATIAL_HASH_TOTAL_CELLS) {
    throw new GeometryError(
      'GEOMETRY_SPATIAL_INDEX_RANGE',
      'bounds',
      `bounds occupy ${total} cells, exceeding the total maximum of ${MAX_SPATIAL_HASH_TOTAL_CELLS}`,
    );
  }
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}
