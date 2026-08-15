/**
 * Pure geometry helpers (T11.1): AABB centers, translation, expansion, and
 * union, plus vector arithmetic. All functions validate their inputs,
 * preserve them untouched, and return fresh immutable values.
 */
import type { Aabb2D, Point2D, Vector2D } from './types';
import {
  assertValidAabb2D,
  assertValidPoint2D,
  assertValidVector2D,
  GeometryError,
} from './validation';

/** Center of an AABB. */
export function aabbCenter2D(aabb: Aabb2D): Point2D {
  assertValidAabb2D(aabb);
  return Object.freeze({
    x: aabb.x + aabb.width / 2,
    y: aabb.y + aabb.height / 2,
  });
}

/** Translate an AABB by a delta vector, returning a new AABB. */
export function translateAabb2D(aabb: Aabb2D, delta: Vector2D): Aabb2D {
  assertValidAabb2D(aabb);
  assertValidVector2D(delta, 'delta');
  return Object.freeze({
    x: aabb.x + delta.x,
    y: aabb.y + delta.y,
    width: aabb.width,
    height: aabb.height,
  });
}

/**
 * Expand an AABB symmetrically (or per-axis) by the given amounts.
 *
 * A negative inset shrinks the AABB. The expanded result keeps the same
 * width/height semantics; `inset` is the margin added on each side.
 */
export function expandAabb2D(aabb: Aabb2D, inset: number | Vector2D): Aabb2D {
  assertValidAabb2D(aabb);
  const x = typeof inset === 'number' ? inset : inset.x;
  const y = typeof inset === 'number' ? inset : inset.y;
  assertFiniteInset(x, 'inset.x');
  assertFiniteInset(y, 'inset.y');
  const expanded = Object.freeze({
    x: aabb.x - x,
    y: aabb.y - y,
    width: aabb.width + x * 2,
    height: aabb.height + y * 2,
  });
  // A negative inset may legitimately shrink the shape, but never into a
  // malformed (negative-size) result.
  assertValidAabb2D(expanded, 'expanded');
  return expanded;
}

function assertFiniteInset(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      field,
      `expected a finite inset, got ${String(value)}`,
    );
  }
}

/** The smallest AABB containing both inputs (bounding union). */
export function unionAabb2D(first: Aabb2D, second: Aabb2D): Aabb2D {
  assertValidAabb2D(first, 'first');
  assertValidAabb2D(second, 'second');
  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const maxX = Math.max(first.x + first.width, second.x + second.width);
  const maxY = Math.max(first.y + first.height, second.y + second.height);
  return Object.freeze({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  });
}

/** Component-wise vector addition. */
export function addVector2D(first: Vector2D, second: Vector2D): Vector2D {
  assertValidVector2D(first, 'first');
  assertValidVector2D(second, 'second');
  return Object.freeze({ x: first.x + second.x, y: first.y + second.y });
}

/** Component-wise vector subtraction (`first - second`). */
export function subtractVector2D(first: Vector2D, second: Vector2D): Vector2D {
  assertValidVector2D(first, 'first');
  assertValidVector2D(second, 'second');
  return Object.freeze({ x: first.x - second.x, y: first.y - second.y });
}

/** Scale a vector by a finite scalar. */
export function scaleVector2D(vector: Vector2D, scalar: number): Vector2D {
  assertValidVector2D(vector);
  if (!Number.isFinite(scalar)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'scalar',
      `expected a finite number, got ${String(scalar)}`,
    );
  }
  return Object.freeze({ x: vector.x * scalar, y: vector.y * scalar });
}

/** Euclidean length of a vector. */
export function lengthVector2D(vector: Vector2D): number {
  assertValidVector2D(vector);
  return Math.hypot(vector.x, vector.y);
}

/**
 * Normalize a vector to unit length. The zero vector is returned unchanged
 * (never NaN); callers that need a fallback direction choose it explicitly.
 */
export function normalizeVector2D(vector: Vector2D): Vector2D {
  assertValidVector2D(vector);
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) {
    return Object.freeze({ x: 0, y: 0 });
  }
  return Object.freeze({ x: vector.x / length, y: vector.y / length });
}

/** Euclidean distance between two points. */
export function distancePoint2D(first: Point2D, second: Point2D): number {
  assertValidPoint2D(first, 'first');
  assertValidPoint2D(second, 'second');
  return Math.hypot(second.x - first.x, second.y - first.y);
}
