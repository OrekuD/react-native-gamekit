/**
 * Camera2D world-bounds clamping (T12.2).
 *
 * Keeps the visible camera region inside an authored world bound at the
 * current zoom, using conservative enclosing-AABB containment for rotated
 * views (frozen in T12.0): stable near boundaries, never jittering, and
 * centering axes where the world is smaller than the view.
 */
import type { Aabb2D } from '../geometry/types';
import { assertFiniteNumber, assertNonnegativeSize, GeometryError } from '../geometry/validation';
import type { Camera2D } from './types';
import { assertValidCamera2D, assertValidLogicalView } from './validation';

/** Half-extents of the rotated visible rect, in world units. */
export function cameraHalfExtents2D(camera: Camera2D, logicalView: Aabb2D): { x: number; y: number } {
  const halfWidth = logicalView.width / 2 / camera.zoom;
  const halfHeight = logicalView.height / 2 / camera.zoom;
  const cos = Math.abs(Math.cos(camera.rotationRadians));
  const sin = Math.abs(Math.sin(camera.rotationRadians));
  return {
    x: halfWidth * cos + halfHeight * sin,
    y: halfWidth * sin + halfHeight * cos,
  };
}

function clampCenter(center: number, halfExtent: number, axisMin: number, axisMax: number): number {
  if (axisMax - axisMin < halfExtent * 2) {
    return (axisMin + axisMax) / 2;
  }
  const min = axisMin + halfExtent;
  const max = axisMax - halfExtent;
  return center < min ? min : center > max ? max : center;
}

/**
 * Clamp a camera so its visible region stays inside `worldBounds`.
 *
 * Conservative for rotated views: the enclosing AABB of the rotated
 * visible rect is contained, so no part of the view leaves the world. An
 * axis whose world is smaller than the view is centered rather than
 * oscillating between impossible edges.
 */
export function clampCameraBounds2D(
  camera: Camera2D,
  worldBounds: Aabb2D,
  logicalView: Aabb2D,
): Camera2D {
  assertValidCamera2D(camera);
  assertValidLogicalView(logicalView);
  if (
    typeof worldBounds !== 'object' ||
    worldBounds === null ||
    Array.isArray(worldBounds)
  ) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'worldBounds',
      `expected a rect record, got ${worldBounds === null ? 'null' : typeof worldBounds}`,
    );
  }
  assertFiniteNumber(worldBounds.x, 'worldBounds.x');
  assertFiniteNumber(worldBounds.y, 'worldBounds.y');
  assertNonnegativeSize(worldBounds.width, 'worldBounds.width');
  assertNonnegativeSize(worldBounds.height, 'worldBounds.height');

  const extents = cameraHalfExtents2D(camera, logicalView);
  return Object.freeze({
    center: Object.freeze({
      x: clampCenter(camera.center.x, extents.x, worldBounds.x, worldBounds.x + worldBounds.width),
      y: clampCenter(camera.center.y, extents.y, worldBounds.y, worldBounds.y + worldBounds.height),
    }),
    zoom: camera.zoom,
    rotationRadians: camera.rotationRadians,
  });
}
