/**
 * Manual-gesture terminal lifecycle (F3).
 *
 * The RNGH 3 manual recognizer is activated explicitly on touch-down and
 * must be returned to its terminal state explicitly: it stays active across
 * separate touches and screen lifecycles otherwise. This pure decision
 * drives the deactivation call in `GamePointerInput`; the recognizer-state
 * operations themselves stay on the UI runtime.
 */

/** A single-pointer binding begins only with the first native touch. */
export function canBeginPrimaryPointer(nativeTouchCount: number): boolean {
  'worklet';
  return nativeTouchCount === 1;
}

/** After an up edge, deactivate once RNGH reports that no touches remain. */
export function deactivateAfterUp(remainingTouches: number): boolean {
  'worklet';
  return remainingTouches === 0;
}

/** Unexpected finalization while a pointer is still active must neutralize ownership. */
export function cancelOnActiveFinalize(activePointerId: number | undefined): boolean {
  'worklet';
  return activePointerId !== undefined;
}
