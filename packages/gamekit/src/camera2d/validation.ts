/**
 * Camera2D validation (T12.1, T12-F6).
 *
 * Reuses the Task 11 structured `GeometryError` codes so failures identify
 * the operation and the invalid field. Validation happens at public
 * operation boundaries; values are never coerced. Outer shapes are checked
 * BEFORE field dereferencing, so null, arrays, and missing nested objects
 * produce structured errors instead of incidental `TypeError`s.
 */
import type { Aabb2D, Point2D } from '../geometry/types';
import { assertFiniteNumber, assertNonnegativeSize, GeometryError } from '../geometry/validation';
import type { Camera2D } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Assert the outer shape of a camera before dereferencing fields. */
export function assertCameraShape(camera: unknown, field: string): asserts camera is Camera2D {
  if (!isRecord(camera)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      field,
      `expected a camera record, got ${camera === null ? 'null' : typeof camera}`,
    );
  }
  if (!isRecord(camera.center)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      `${field}.center`,
      `expected a point record, got ${camera.center === null ? 'null' : typeof camera.center}`,
    );
  }
}

/** Assert a valid camera value (shape + fields). */
export function assertValidCamera2D(camera: Camera2D): void {
  assertCameraShape(camera, 'camera');
  assertFiniteNumber(camera.center.x, 'camera.center.x');
  assertFiniteNumber(camera.center.y, 'camera.center.y');
  assertFiniteNumber(camera.zoom, 'camera.zoom');
  if (!(camera.zoom > 0)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'camera.zoom',
      `expected a finite zoom greater than zero, got ${String(camera.zoom)}`,
    );
  }
  assertFiniteNumber(camera.rotationRadians, 'camera.rotationRadians');
}

/** Assert a finite point (shape first). */
export function assertFinitePoint2D(point: unknown, field: string): asserts point is Point2D {
  if (!isRecord(point)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      field,
      `expected a point record, got ${point === null ? 'null' : typeof point}`,
    );
  }
  const typed = point as unknown as Point2D;
  assertFiniteNumber(typed.x, `${field}.x`);
  assertFiniteNumber(typed.y, `${field}.y`);
}

/** Assert a valid logical view rect (shape + finite positive size). */
export function assertValidLogicalView(view: unknown): asserts view is Aabb2D {
  if (!isRecord(view)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'logicalView',
      `expected a rect record, got ${view === null ? 'null' : typeof view}`,
    );
  }
  const typed = view as unknown as Aabb2D;
  assertFiniteNumber(typed.x, 'logicalView.x');
  assertFiniteNumber(typed.y, 'logicalView.y');
  assertNonnegativeSize(typed.width, 'logicalView.width');
  assertNonnegativeSize(typed.height, 'logicalView.height');
  if (!(typed.width > 0) || !(typed.height > 0)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_SIZE',
      'logicalView',
      `expected a positive logical view size, got ${view.width} x ${view.height}`,
    );
  }
}

/** Assert a nonnegative padding. */
export function assertNonnegativePadding(padding: number): void {
  assertNonnegativeSize(padding, 'padding');
}
