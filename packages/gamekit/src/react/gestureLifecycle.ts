import type { CoalescedPointerEvent } from './pointerCoalescer';

/** RN-side mirror of whether the trailing-flush sampler should be mounted. */
export interface SamplerMirrorState {
  readonly generation: number;
  readonly active: boolean;
}

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

/**
 * Sampler mirror for the F2 trailing flush (F2 lifecycle).
 *
 * The trailing-flush frame callback must stay active exactly while the
 * coalescer owns a pointer. Returns `true` when a begin crossed (pointer
 * owned), `false` when a terminal edge crossed (pointer released), and
 * `undefined` for empty batches (secondary touches — never toggle the
 * sampler) and flushed moves (the pointer stays owned).
 */
export function samplerMirrorFromBatch(
  batch: readonly CoalescedPointerEvent[],
): boolean | undefined {
  'worklet';
  if (batch.length === 0) {
    return undefined;
  }
  const kind = batch[batch.length - 1]?.kind;
  if (kind === 'begin') {
    return true;
  }
  if (kind === 'end' || kind === 'cancel') {
    return false;
  }
  return undefined;
}

/**
 * Apply a UI-originated sampler update only when it belongs to the current
 * binding generation.
 */
export function reduceSamplerMirrorState(
  currentGeneration: number,
  previous: SamplerMirrorState,
  next: SamplerMirrorState,
): SamplerMirrorState {
  return next.generation === currentGeneration ? next : previous;
}
