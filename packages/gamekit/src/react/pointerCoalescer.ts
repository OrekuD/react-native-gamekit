/**
 * Pointer coalescer (T7).
 *
 * Pure, worklet-safe state machine that throttles move forwarding from the
 * UI runtime: at most one move crosses runtimes per configured interval
 * (default: one fixed step), always carrying the latest dirty position.
 * Edges are never throttled or dropped:
 *
 * - `down` forwards the begin immediately (latency-critical) and establishes
 *   the single active pointer; a secondary pointer is ignored.
 * - `move` updates the latest dirty position and forwards it at most once
 *   per interval.
 * - `up` forwards the final position and the terminal edge **together**, in
 *   order, and releases the active pointer.
 * - `cancel` neutralizes exactly once.
 * - `reset` drops all queued state (layout revision, unmount).
 *
 * The coalescer is not the authoritative owner: ownership, edge sampling,
 * and containment re-validation stay on the JS side (input buffer).
 * Time is injected so ordering and frequency are testable without a device.
 */

export type CoalescedPointerEvent =
  | { readonly kind: 'begin'; readonly pointerId: number; readonly x: number; readonly y: number }
  | { readonly kind: 'move'; readonly pointerId: number; readonly x: number; readonly y: number }
  | { readonly kind: 'end'; readonly pointerId: number; readonly x: number; readonly y: number }
  | { readonly kind: 'cancel' };

export interface PointerCoalescer {
  /** A pointer went down at a surface point. Returns the events to forward. */
  down(pointerId: number, x: number, y: number, nowMs: number): readonly CoalescedPointerEvent[];
  /** A pointer moved. Returns at most one (coalesced) move per interval. */
  move(pointerId: number, x: number, y: number, nowMs: number): readonly CoalescedPointerEvent[];
  /** A pointer lifted. Returns the final point and the terminal edge together. */
  up(pointerId: number, x: number, y: number, nowMs: number): readonly CoalescedPointerEvent[];
  /** Neutralize the active pointer. Returns the cancel event exactly once. */
  cancel(nowMs: number): readonly CoalescedPointerEvent[];
  /** Drop all queued state without emitting anything (layout/unmount). */
  reset(): void;
}

interface ActivePointer {
  readonly pointerId: number;
  lastX: number;
  lastY: number;
  lastForwardMs: number;
}

export function createPointerCoalescer(maxMoveIntervalMs: number): PointerCoalescer {
  // Worklet-safe state: captured objects are shared across calls on the UI
  // runtime, but captured variables cannot be rebound — so the active pointer
  // lives as a property of this captured state object. The JS copy is a
  // separate snapshot; callers recreate the coalescer (fresh state) whenever
  // queued movement must be dropped from the UI side.
  const state: { active: ActivePointer | undefined } = { active: undefined };

  const down = (pointerId: number, x: number, y: number, nowMs: number): readonly CoalescedPointerEvent[] => {
    'worklet';
    if (state.active !== undefined) {
      return []; // Secondary pointers never steal; JS owns ownership anyway.
    }
    state.active = { pointerId, lastX: x, lastY: y, lastForwardMs: nowMs };
    return [{ kind: 'begin', pointerId, x, y }];
  };

  const move = (pointerId: number, x: number, y: number, nowMs: number): readonly CoalescedPointerEvent[] => {
    'worklet';
    const active = state.active;
    if (active === undefined || active.pointerId !== pointerId) {
      return [];
    }
    active.lastX = x;
    active.lastY = y;
    if (nowMs - active.lastForwardMs < maxMoveIntervalMs) {
      return []; // Deferred: the latest dirty position forwards on the next tick.
    }
    active.lastForwardMs = nowMs;
    return [{ kind: 'move', pointerId, x, y }];
  };

  const up = (pointerId: number, x: number, y: number, _nowMs: number): readonly CoalescedPointerEvent[] => {
    'worklet';
    if (state.active === undefined || state.active.pointerId !== pointerId) {
      return [];
    }
    state.active = undefined;
    // Final position and terminal edge travel together; any deferred dirty
    // move is subsumed by this newer position.
    return [{ kind: 'end', pointerId, x, y }];
  };

  const cancel = (_nowMs: number): readonly CoalescedPointerEvent[] => {
    'worklet';
    if (state.active === undefined) {
      return [];
    }
    state.active = undefined;
    return [{ kind: 'cancel' }];
  };

  const reset = (): void => {
    state.active = undefined;
  };

  return Object.freeze({ down, move, up, cancel, reset });
}
