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
 * - `flush` forwards the latest deferred move even if native touch movement
 *   has paused.
 * - `up` forwards the final position in the terminal edge and releases the
 *   active pointer.
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
  /** Forward a deferred move when the frame clock reaches the interval. */
  flush(nowMs: number): readonly CoalescedPointerEvent[];
  /** A pointer lifted. Returns the final point and the terminal edge together. */
  up(pointerId: number, x: number, y: number, nowMs: number): readonly CoalescedPointerEvent[];
  /** Neutralize the active pointer. Returns the cancel event exactly once. */
  cancel(nowMs: number): readonly CoalescedPointerEvent[];
  /** Drop all queued state without emitting anything (layout/unmount). */
  reset(): void;
}

interface ActivePointer {
  readonly pointerId: number;
  readonly lastForwardMs: number;
  readonly pendingMove:
    | { readonly x: number; readonly y: number }
    | undefined;
}

/** Explicit coalescer state stored in one UI-runtime SharedValue. */
export interface PointerCoalescerState {
  readonly maxMoveIntervalMs: number;
  readonly active: ActivePointer | undefined;
}

/** One native touch input consumed by the pure coalescer reducer. */
export type PointerCoalescerInput =
  | {
      readonly kind: 'down' | 'move' | 'up';
      readonly pointerId: number;
      readonly x: number;
      readonly y: number;
      readonly nowMs: number;
    }
  | { readonly kind: 'cancel'; readonly nowMs: number }
  | { readonly kind: 'flush'; readonly nowMs: number }
  | { readonly kind: 'reset' };

/** Immutable state plus the ordered events produced by one coalescer input. */
export interface PointerCoalescerTransition {
  readonly state: PointerCoalescerState;
  readonly events: readonly CoalescedPointerEvent[];
}

/** Create fresh state for a UI-runtime coalescer. */
export function createPointerCoalescerState(
  maxMoveIntervalMs: number,
): PointerCoalescerState {
  'worklet';
  return { maxMoveIntervalMs, active: undefined };
}

/**
 * Advance pointer coalescing without relying on mutable worklet closures.
 *
 * RNGH registers each touch callback as a separate worklet. Closure-captured
 * objects may therefore be serialized into independent copies; callers must
 * keep the returned state in one SharedValue and pass it into every handler.
 */
export function reducePointerCoalescer(
  state: PointerCoalescerState,
  input: PointerCoalescerInput,
): PointerCoalescerTransition {
  'worklet';
  if (input.kind === 'reset') {
    return { state: createPointerCoalescerState(state.maxMoveIntervalMs), events: [] };
  }

  if (input.kind === 'down') {
    if (state.active !== undefined) {
      return { state, events: [] };
    }
    return {
      state: {
        ...state,
        active: {
          pointerId: input.pointerId,
          lastForwardMs: input.nowMs,
          pendingMove: undefined,
        },
      },
      events: [
        {
          kind: 'begin',
          pointerId: input.pointerId,
          x: input.x,
          y: input.y,
        },
      ],
    };
  }

  if (input.kind === 'cancel') {
    if (state.active === undefined) {
      return { state, events: [] };
    }
    return {
      state: { ...state, active: undefined },
      events: [{ kind: 'cancel' }],
    };
  }

  const active = state.active;

  if (input.kind === 'flush') {
    if (active === undefined || active.pendingMove === undefined) {
      return { state, events: [] };
    }
    if (input.nowMs - active.lastForwardMs < state.maxMoveIntervalMs) {
      return { state, events: [] };
    }
    return {
      state: {
        ...state,
        active: {
          ...active,
          lastForwardMs: input.nowMs,
          pendingMove: undefined,
        },
      },
      events: [
        {
          kind: 'move',
          pointerId: active.pointerId,
          x: active.pendingMove.x,
          y: active.pendingMove.y,
        },
      ],
    };
  }

  if (active === undefined || active.pointerId !== input.pointerId) {
    return { state, events: [] };
  }

  if (input.kind === 'up') {
    return {
      state: { ...state, active: undefined },
      // The terminal event carries the newest point, subsuming a deferred move.
      events: [
        {
          kind: 'end',
          pointerId: input.pointerId,
          x: input.x,
          y: input.y,
        },
      ],
    };
  }

  const shouldForward =
    input.nowMs - active.lastForwardMs >= state.maxMoveIntervalMs;
  const nextActive: ActivePointer = {
    pointerId: input.pointerId,
    lastForwardMs: shouldForward ? input.nowMs : active.lastForwardMs,
    pendingMove: shouldForward ? undefined : { x: input.x, y: input.y },
  };
  return {
    state: { ...state, active: nextActive },
    events: shouldForward
      ? [
          {
            kind: 'move',
            pointerId: input.pointerId,
            x: input.x,
            y: input.y,
          },
        ]
      : [],
  };
}

/**
 * Stateful RN-runtime adapter retained for pure tests and non-worklet callers.
 * UI gesture handlers use `reducePointerCoalescer` with a SharedValue instead.
 */
export function createPointerCoalescer(maxMoveIntervalMs: number): PointerCoalescer {
  let state = createPointerCoalescerState(maxMoveIntervalMs);

  const dispatch = (input: PointerCoalescerInput): readonly CoalescedPointerEvent[] => {
    const transition = reducePointerCoalescer(state, input);
    state = transition.state;
    return transition.events;
  };

  const coalescer: PointerCoalescer = {
    down: (pointerId: number, x: number, y: number, nowMs: number) =>
      dispatch({ kind: 'down', pointerId, x, y, nowMs }),
    move: (pointerId: number, x: number, y: number, nowMs: number) =>
      dispatch({ kind: 'move', pointerId, x, y, nowMs }),
    flush: (nowMs: number) => dispatch({ kind: 'flush', nowMs }),
    up: (pointerId: number, x: number, y: number, nowMs: number) =>
      dispatch({ kind: 'up', pointerId, x, y, nowMs }),
    cancel: (nowMs: number) => dispatch({ kind: 'cancel', nowMs }),
    reset: () => {
      dispatch({ kind: 'reset' });
    },
  };
  return Object.freeze(coalescer);
}
