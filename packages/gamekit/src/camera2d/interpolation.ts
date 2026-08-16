/**
 * Camera2D presentation interpolation (T12.2, T12.3).
 *
 * Interpolates center and zoom linearly by the presentation alpha and
 * rotation across the shortest angular arc. A changed `cutId` (or an
 * absent previous camera) snaps to the current camera — scene
 * transitions, session replacement, binding-generation changes, and
 * explicit teleports all route through the cut signal, never through
 * distance heuristics.
 */
import type { Camera2D, CameraCut2D } from './types';
import { assertValidCamera2D } from './validation';

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
 * Interpolate the presented camera between two cuts.
 *
 * `alpha` is the presentation fraction in `[0, 1]`. Returns the current
 * camera unchanged when there is no previous cut or the cut id changed.
 */
export function interpolateCamera2D(
  previous: CameraCut2D | undefined,
  current: CameraCut2D,
  alpha: number,
): Camera2D {
  'worklet';
  assertValidCamera2D(current.camera);
  if (previous === undefined || previous.cutId !== current.cutId) {
    return current.camera;
  }
  const from = previous.camera;
  const to = current.camera;
  return {
    center: {
      x: from.center.x + (to.center.x - from.center.x) * alpha,
      y: from.center.y + (to.center.y - from.center.y) * alpha,
    },
    zoom: from.zoom + (to.zoom - from.zoom) * alpha,
    rotationRadians: from.rotationRadians + shortestRotationDelta2D(from.rotationRadians, to.rotationRadians) * alpha,
  };
}
