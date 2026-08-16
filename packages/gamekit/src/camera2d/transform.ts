/**
 * Camera2D transforms (T12.1).
 *
 * The frozen transform model (T12.0):
 *
 *     world point -> camera transform -> logical view point -> viewport -> surface
 *     logical = L + rotate(P - C, -R) * Z
 *     world   = C + rotate((logical - L) / Z, R)
 *
 * where C is the camera center, Z the zoom, R the rotation, and L the
 * center of the authored logical view rect. Rotation follows the Skia
 * convention (positive radians in the y-down screen plane); zoom is
 * uniform and greater than zero. The convenience surface functions derive
 * the logical view from the resolved viewport's visible bounds, so
 * rendering and pointer input share one composition.
 */
import type { Aabb2D, Point2D } from '../geometry/types';
import type { ResolvedViewport2D } from '../viewport2d/types';
import { surfaceToWorld, worldToSurface } from '../viewport2d/math';
import type { Camera2D } from './types';
import { assertFinitePoint2D, assertValidCamera2D, assertValidLogicalView } from './validation';

/** Rotate a point by an angle (Skia y-down convention). */
export function rotatePoint2D(point: Point2D, radians: number): Point2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return Object.freeze({
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  });
}

/** The center of the camera's authored logical view. */
export function logicalViewCenter2D(logicalView: Aabb2D): Point2D {
  return Object.freeze({
    x: logicalView.x + logicalView.width / 2,
    y: logicalView.y + logicalView.height / 2,
  });
}

/**
 * Create a camera from optional partial values; missing fields default to
 * the identity camera (`center` origin, `zoom` 1, no rotation).
 */
export function createCamera2D(value?: Partial<Camera2D>): Camera2D {
  const camera: Camera2D = {
    center: value?.center ?? { x: 0, y: 0 },
    zoom: value?.zoom ?? 1,
    rotationRadians: value?.rotationRadians ?? 0,
  };
  assertValidCamera2D(camera);
  return Object.freeze({
    center: Object.freeze({ x: camera.center.x, y: camera.center.y }),
    zoom: camera.zoom,
    rotationRadians: camera.rotationRadians,
  });
}

/** World -> logical view: `L + rotate(P - C, -R) * Z`. */
export function worldToLogical2D(point: Point2D, camera: Camera2D, logicalView: Aabb2D): Point2D {
  assertValidCamera2D(camera);
  assertFinitePoint2D(point, 'point');
  assertValidLogicalView(logicalView);
  const { center, zoom, rotationRadians } = camera;
  const logical = logicalViewCenter2D(logicalView);
  const delta = {
    x: point.x - center.x,
    y: point.y - center.y,
  };
  const rotated = rotatePoint2D(delta, -rotationRadians);
  return Object.freeze({
    x: logical.x + rotated.x * zoom,
    y: logical.y + rotated.y * zoom,
  });
}

/** Logical view -> world: `C + rotate((logical - L) / Z, R)`. */
export function logicalToWorld2D(point: Point2D, camera: Camera2D, logicalView: Aabb2D): Point2D {
  assertValidCamera2D(camera);
  assertFinitePoint2D(point, 'point');
  assertValidLogicalView(logicalView);
  const { center, zoom, rotationRadians } = camera;
  const logical = logicalViewCenter2D(logicalView);
  const scaled = {
    x: (point.x - logical.x) / zoom,
    y: (point.y - logical.y) / zoom,
  };
  const rotated = rotatePoint2D(scaled, rotationRadians);
  return Object.freeze({
    x: center.x + rotated.x,
    y: center.y + rotated.y,
  });
}

/** The conservative world-space AABB visible through the camera. */
export function getCameraVisibleBounds2D(camera: Camera2D, logicalView: Aabb2D): Aabb2D {
  assertValidCamera2D(camera);
  assertValidLogicalView(logicalView);
  const halfWidth = logicalView.width / 2 / camera.zoom;
  const halfHeight = logicalView.height / 2 / camera.zoom;
  const cos = Math.abs(Math.cos(camera.rotationRadians));
  const sin = Math.abs(Math.sin(camera.rotationRadians));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;
  return Object.freeze({
    x: camera.center.x - extentX,
    y: camera.center.y - extentY,
    width: extentX * 2,
    height: extentY * 2,
  });
}

/**
 * World -> surface through the camera and the resolved viewport.
 *
 * The camera's logical view is the viewport's visible logical bounds, so
 * this composes exactly the transform the renderer draws with.
 */
export function worldToSurface2D(
  point: Point2D,
  viewport: ResolvedViewport2D,
  camera: Camera2D,
): Point2D {
  assertValidCamera2D(camera);
  assertFinitePoint2D(point, 'point');
  const logical = worldToLogical2D(point, camera, viewport.visibleLogicalBounds);
  return worldToSurface(viewport, logical);
}

/** Surface -> world through the viewport and the presented camera. */
export function surfaceToWorld2D(
  point: Point2D,
  viewport: ResolvedViewport2D,
  camera: Camera2D,
): Point2D {
  assertValidCamera2D(camera);
  assertFinitePoint2D(point, 'point');
  const logical = surfaceToWorld(viewport, point);
  return logicalToWorld2D(logical, camera, viewport.visibleLogicalBounds);
}
