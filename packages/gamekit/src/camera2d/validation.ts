/**
 * Camera2D validation (T12.1).
 *
 * Reuses the Task 11 structured `GeometryError` codes so failures identify
 * the operation and the invalid field. Validation happens at public
 * operation boundaries; values are never coerced.
 */
import type { Aabb2D, Point2D } from '../geometry/types';
import { assertFiniteNumber, assertNonnegativeSize, GeometryError } from '../geometry/validation';
import type { Camera2D } from './types';

/** Assert a valid camera value. */
export function assertValidCamera2D(camera: Camera2D): void {
  assertFiniteNumber(camera.center.x, 'center.x');
  assertFiniteNumber(camera.center.y, 'center.y');
  assertFiniteNumber(camera.zoom, 'zoom');
  if (!(camera.zoom > 0)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'zoom',
      `expected a finite zoom greater than zero, got ${String(camera.zoom)}`,
    );
  }
  assertFiniteNumber(camera.rotationRadians, 'rotationRadians');
}

/** Assert a finite point. */
export function assertFinitePoint2D(point: Point2D, field: string): void {
  assertFiniteNumber(point.x, `${field}.x`);
  assertFiniteNumber(point.y, `${field}.y`);
}

/** Assert a valid logical view rect (finite, positive size). */
export function assertValidLogicalView(view: Aabb2D): void {
  assertFiniteNumber(view.x, 'logicalView.x');
  assertFiniteNumber(view.y, 'logicalView.y');
  assertNonnegativeSize(view.width, 'logicalView.width');
  assertNonnegativeSize(view.height, 'logicalView.height');
  if (!(view.width > 0) || !(view.height > 0)) {
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
