/**
 * Camera2D follow behavior (T12.2).
 *
 * Deterministic, headless follow helpers for game update code. They never
 * read a React ref, device clock, frame callback, or global singleton;
 * games call them inside the scene update and store the returned camera in
 * scene state.
 */
import type { Aabb2D, Point2D } from '../geometry/types';
import { assertFiniteNumber, assertNonnegativeSize, GeometryError } from '../geometry/validation';
import type { Camera2D, FollowCamera2DOptions2D } from './types';
import { assertValidCamera2D } from './validation';

function assertNonnegativeDeadZone(deadZone: Aabb2D): void {
  assertFiniteNumber(deadZone.x, 'deadZone.x');
  assertFiniteNumber(deadZone.y, 'deadZone.y');
  assertNonnegativeSize(deadZone.width, 'deadZone.width');
  assertNonnegativeSize(deadZone.height, 'deadZone.height');
}

function followFactor(halfLifeSeconds: number, deltaSeconds: number): number {
  if (!(deltaSeconds > 0)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'deltaSeconds',
      `expected a finite positive step, got ${String(deltaSeconds)}`,
    );
  }
  return 1 - Math.pow(0.5, deltaSeconds / halfLifeSeconds);
}

/**
 * Compute the next camera for a follow target.
 *
 * - Without options: direct follow — the camera center becomes the target.
 * - With a dead zone: the camera moves only when the target crosses the
 *   zone edge, by exactly the amount needed to bring the target back to
 *   the edge.
 * - `perAxis` disables following on either axis.
 * - `dampingHalfLifeSeconds` blends toward the desired center with a
 *   half-life model; equivalent fixed-step schedules produce equivalent
 *   results.
 */
export function followCamera2D(
  camera: Camera2D,
  target: Point2D,
  options?: FollowCamera2DOptions2D,
  deltaSeconds?: number,
): Camera2D {
  assertValidCamera2D(camera);
  assertFiniteNumber(target.x, 'target.x');
  assertFiniteNumber(target.y, 'target.y');

  const perAxisX = options?.perAxis?.x ?? true;
  const perAxisY = options?.perAxis?.y ?? true;
  const deadZone = options?.deadZone;
  if (deadZone !== undefined) {
    assertNonnegativeDeadZone(deadZone);
  }
  const halfLife = options?.dampingHalfLifeSeconds;
  if (halfLife !== undefined) {
    assertFiniteNumber(halfLife, 'dampingHalfLifeSeconds');
    if (!(halfLife > 0)) {
      throw new GeometryError(
        'GEOMETRY_INVALID_NUMBER',
        'dampingHalfLifeSeconds',
        `expected a finite positive half-life, got ${String(halfLife)}`,
      );
    }
    if (deltaSeconds === undefined) {
      throw new GeometryError(
        'GEOMETRY_INVALID_NUMBER',
        'deltaSeconds',
        'damping requires an explicit fixed-step deltaSeconds',
      );
    }
  }

  const center = camera.center;
  const desired = { x: center.x, y: center.y };
  if (deadZone === undefined) {
    desired.x = target.x;
    desired.y = target.y;
  } else {
    const minX = center.x + deadZone.x;
    const maxX = minX + deadZone.width;
    const minY = center.y + deadZone.y;
    const maxY = minY + deadZone.height;
    if (target.x > maxX) {
      desired.x = target.x - deadZone.width - deadZone.x;
    } else if (target.x < minX) {
      desired.x = target.x - deadZone.x;
    }
    if (target.y > maxY) {
      desired.y = target.y - deadZone.height - deadZone.y;
    } else if (target.y < minY) {
      desired.y = target.y - deadZone.y;
    }
  }
  if (!perAxisX) {
    desired.x = center.x;
  }
  if (!perAxisY) {
    desired.y = center.y;
  }

  let nextCenter: Point2D;
  if (halfLife !== undefined && deltaSeconds !== undefined) {
    const factor = followFactor(halfLife, deltaSeconds);
    nextCenter = {
      x: center.x + (desired.x - center.x) * factor,
      y: center.y + (desired.y - center.y) * factor,
    };
  } else {
    nextCenter = desired;
  }

  return {
    center: nextCenter,
    zoom: camera.zoom,
    rotationRadians: camera.rotationRadians,
  };
}
