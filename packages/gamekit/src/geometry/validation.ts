/**
 * Geometry validation and structured errors (T11.1).
 *
 * Mirrors the package's structured-error style (`GameAssetError`): a stable
 * machine-readable code plus the offending field. Validation happens at
 * public operation boundaries; helpers never coerce or reorder malformed
 * values into valid shapes.
 */
import type { Aabb2D, Circle2D, Point2D, Segment2D, Vector2D } from './types';

/** Stable error codes for geometry and collision input. */
export type GeometryErrorCode =
  | 'GEOMETRY_INVALID_NUMBER'
  | 'GEOMETRY_INVALID_SIZE'
  | 'GEOMETRY_INVALID_BITS'
  | 'GEOMETRY_INVALID_SEGMENT';

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

/** Assert a finite number (rejects NaN and ±Infinity). */
export function assertFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      field,
      `expected a finite number, got ${String(value)}`,
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
      `expected an unsigned 32-bit integer, got ${String(value)}`,
    );
  }
}

/** Validate a point or vector component pair. */
export function assertValidPoint2D(point: Point2D, name = 'point'): void {
  assertFiniteNumber(point.x, `${name}.x`);
  assertFiniteNumber(point.y, `${name}.y`);
}

/** Validate a vector (same shape as a point, distinct naming). */
export function assertValidVector2D(vector: Vector2D, name = 'vector'): void {
  assertFiniteNumber(vector.x, `${name}.x`);
  assertFiniteNumber(vector.y, `${name}.y`);
}

/** Validate an AABB: finite corner, finite nonnegative size. */
export function assertValidAabb2D(aabb: Aabb2D, name = 'aabb'): void {
  assertFiniteNumber(aabb.x, `${name}.x`);
  assertFiniteNumber(aabb.y, `${name}.y`);
  assertNonnegativeSize(aabb.width, `${name}.width`);
  assertNonnegativeSize(aabb.height, `${name}.height`);
}

/** Validate a circle: finite center, finite nonnegative radius. */
export function assertValidCircle2D(circle: Circle2D, name = 'circle'): void {
  assertFiniteNumber(circle.x, `${name}.x`);
  assertFiniteNumber(circle.y, `${name}.y`);
  assertNonnegativeSize(circle.radius, `${name}.radius`);
}

/** Validate a segment: finite endpoints that are not both degenerate checks. */
export function assertValidSegment2D(segment: Segment2D, name = 'segment'): void {
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
