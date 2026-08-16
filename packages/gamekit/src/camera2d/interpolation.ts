/**
 * Camera2D presentation interpolation (T12.2, T12.3).
 *
 * The public `interpolateCamera2D` validates its inputs and returns a
 * frozen camera. The internal `interpolateCameraScalar2D` is the trusted
 * display-frequency projector: its COMPLETE call graph is workletized (no
 * validation, no structured error construction, the shortest-arc math is
 * inline), so the UI runtime can call it from the camera presentation
 * worklet without crossing runtimes (T12-F2). Callers validate selector
 * output at the JS commit boundary before publishing shared values.
 */
import { assertFiniteNumber, GeometryError } from '../geometry/validation';
import type { Camera2D, CameraCut2D } from './types';
import { assertCameraShape } from './validation';

function assertCutShape(cut: unknown, field: string): asserts cut is CameraCut2D {
  if (typeof cut !== 'object' || cut === null || Array.isArray(cut)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      field,
      `expected a camera cut record, got ${cut === null ? 'null' : typeof cut}`,
    );
  }
  assertFiniteNumber((cut as CameraCut2D).cutId, `${field}.cutId`);
  const camera = (cut as CameraCut2D).camera;
  assertCameraShape(camera, `${field}.camera`);
  const cameraField = `${field}.camera`;
  assertFiniteNumber(camera.center.x, `${cameraField}.center.x`);
  assertFiniteNumber(camera.center.y, `${cameraField}.center.y`);
  assertFiniteNumber(camera.zoom, `${cameraField}.zoom`);
  if (!(camera.zoom > 0)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      `${cameraField}.zoom`,
      `expected a finite zoom greater than zero, got ${String(camera.zoom)}`,
    );
  }
  assertFiniteNumber(camera.rotationRadians, `${cameraField}.rotationRadians`);
}

/**
 * Trusted scalar projector (worklet-safe): interpolates center and zoom
 * linearly and rotation across the shortest angular arc. A changed `cutId`
 * (or an absent previous cut) snaps to the current camera. No validation,
 * no allocation of structured errors.
 */
export function interpolateCameraScalar2D(
  previous: CameraCut2D | undefined,
  current: CameraCut2D,
  alpha: number,
): Camera2D {
  'worklet';
  if (previous === undefined || previous.cutId !== current.cutId) {
    return current.camera;
  }
  const from = previous.camera;
  const to = current.camera;
  let delta = (to.rotationRadians - from.rotationRadians) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return {
    center: {
      x: from.center.x + (to.center.x - from.center.x) * alpha,
      y: from.center.y + (to.center.y - from.center.y) * alpha,
    },
    zoom: from.zoom + (to.zoom - from.zoom) * alpha,
    rotationRadians: from.rotationRadians + delta * alpha,
  };
}

/** The shortest signed angular difference from `from` to `to`. */
export function shortestRotationDelta2D(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

/**
 * Public interpolated camera: validates every input, clamps the alpha
 * policy (reject outside `[0, 1]`), and returns a frozen value. Delegates
 * to the trusted scalar projector.
 */
export function interpolateCamera2D(
  previous: CameraCut2D | undefined,
  current: CameraCut2D,
  alpha: number,
): Camera2D {
  assertCutShape(current, 'current');
  if (previous !== undefined) {
    assertCutShape(previous, 'previous');
  }
  assertFiniteNumber(alpha, 'alpha');
  if (alpha < 0 || alpha > 1) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'alpha',
      `expected alpha in [0, 1], got ${String(alpha)}`,
    );
  }
  const interpolated = interpolateCameraScalar2D(previous, current, alpha);
  return Object.freeze({
    center: Object.freeze({ x: interpolated.center.x, y: interpolated.center.y }),
    zoom: interpolated.zoom,
    rotationRadians: interpolated.rotationRadians,
  });
}
