/**
 * Geometry validation and structured errors (T11.1).
 *
 * Mirrors the package's structured-error style (`GameAssetError`): a stable
 * machine-readable code plus the offending field. Validation happens at
 * public operation boundaries; helpers never coerce or reorder malformed
 * values into valid shapes.
 *
 * Numeric policy (GS-GEOMETRY-01): validators require the declared record
 * shape and finite numeric components. Malformed plain data fails with a
 * structured error; diagnostics never invoke object coercion hooks. Errors
 * thrown by caller-provided getters or proxy traps remain caller errors.
 * Arithmetic helpers target ordinary game-world magnitudes: derived-value
 * overflow remains out of contract, except expandAabb2D validates its
 * result. normalizeVector2D supports every finite input component,
 * including extremes whose unscaled Euclidean length would overflow.
 */
import type { Aabb2D, Circle2D, Point2D, Segment2D, Vector2D } from './types';

/** Stable error codes for geometry and collision input. */
export type GeometryErrorCode =
  | 'GEOMETRY_INVALID_NUMBER'
  | 'GEOMETRY_INVALID_SIZE'
  | 'GEOMETRY_INVALID_BITS'
  | 'GEOMETRY_INVALID_SEGMENT'
  | 'GEOMETRY_INVALID_SHAPE'
  | 'GEOMETRY_DUPLICATE_ID'
  | 'GEOMETRY_SPATIAL_INDEX_RANGE';

/** A structured geometry or collision input failure. */
export class GeometryError extends Error {
  /** Stable machine-readable code. */
  readonly code: GeometryErrorCode;
  /** Field path within the value that caused the failure. */
  readonly field: string;

  constructor(code: GeometryErrorCode, field: string, message: string) {
    super(`${code} at ${field}: ${message}`);
    this.name = 'GeometryError';
    this.code = code;
    this.field = field;
  }
}

/** Describe invalid values without calling object/function coercion hooks. */
function describeValue(value: unknown): string {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    return typeof value;
  }
  return String(value);
}

/** Assert a finite number (rejects NaN and ±Infinity). */
export function assertFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      field,
      `expected a finite number, got ${describeValue(value)}`,
    );
  }
}

/** Assert a finite, nonnegative size (width, height, radius). */
export function assertNonnegativeSize(value: number, field: string): void {
  assertFiniteNumber(value, field);
  if (value < 0) {
    throw new GeometryError(
      'GEOMETRY_INVALID_SIZE',
      field,
      `expected a nonnegative size, got ${value}`,
    );
  }
}

/** Assert an unsigned 32-bit integer (collision filters and bit masks). */
export function assertUnsigned32Bits(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new GeometryError(
      'GEOMETRY_INVALID_BITS',
      field,
      `expected an unsigned 32-bit integer, got ${describeValue(value)}`,
    );
  }
}

/** Internal record guard shared with collision boundaries; not a public export. */
export function assertRecordShape(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_SHAPE',
      name,
      `expected a non-array object, got ${Array.isArray(value) ? 'an array' : describeValue(value)}`,
    );
  }
}

/** Validate a point or vector component pair. */
export function assertValidPoint2D(point: Point2D, name = 'point'): void {
  assertRecordShape(point, name);
  assertFiniteNumber(point.x, `${name}.x`);
  assertFiniteNumber(point.y, `${name}.y`);
}

/** Validate a vector (same shape as a point, distinct naming). */
export function assertValidVector2D(vector: Vector2D, name = 'vector'): void {
  assertRecordShape(vector, name);
  assertFiniteNumber(vector.x, `${name}.x`);
  assertFiniteNumber(vector.y, `${name}.y`);
}

/** Validate an AABB: finite corner, finite nonnegative size. */
export function assertValidAabb2D(aabb: Aabb2D, name = 'aabb'): void {
  assertRecordShape(aabb, name);
  assertFiniteNumber(aabb.x, `${name}.x`);
  assertFiniteNumber(aabb.y, `${name}.y`);
  assertNonnegativeSize(aabb.width, `${name}.width`);
  assertNonnegativeSize(aabb.height, `${name}.height`);
}

/** Validate a circle: finite center, finite nonnegative radius. */
export function assertValidCircle2D(circle: Circle2D, name = 'circle'): void {
  assertRecordShape(circle, name);
  assertFiniteNumber(circle.x, `${name}.x`);
  assertFiniteNumber(circle.y, `${name}.y`);
  assertNonnegativeSize(circle.radius, `${name}.radius`);
}
/** Validate a segment: finite endpoints that are not both degenerate checks. */
export function assertValidSegment2D(segment: Segment2D, name = 'segment'): void {
  assertRecordShape(segment, name);
  assertValidPoint2D(segment.start, `${name}.start`);
  assertValidPoint2D(segment.end, `${name}.end`);
  if (segment.start.x === segment.end.x && segment.start.y === segment.end.y) {
    throw new GeometryError(
      'GEOMETRY_INVALID_SEGMENT',
      name,
      'expected distinct endpoints, got a zero-length segment',
    );
  }
}
