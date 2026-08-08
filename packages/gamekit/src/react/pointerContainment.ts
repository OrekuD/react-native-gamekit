/**
 * UI-side containment mirror (T7).
 *
 * The exact same viewport formula the JS binding uses to reject begins in
 * `fit` letterbox space, workletized so the Manual gesture can fail before
 * activation. JS re-validates on receipt; this mirror only prevents an
 * obviously invalid begin from activating the gesture at all.
 */
import type { ResolvedViewport2D } from '../viewport2d';

/** Whether a surface point may begin a gesture in the interactive content. */
export function isBeginAllowed(
  viewport: ResolvedViewport2D | undefined,
  x: number,
  y: number,
): boolean {
  'worklet';
  if (viewport === undefined) {
    return false;
  }
  const { x: boundsX, y: boundsY, width, height } = viewport.contentBounds;
  return x >= boundsX && y >= boundsY && x <= boundsX + width && y <= boundsY + height;
}
