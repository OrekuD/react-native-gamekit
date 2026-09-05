import type { InputMap } from '../../definition/types';
import type { Point2D } from '../../geometry/types';
import type { ButtonState, InputController, InputFrame, PointerState } from './types';

type InputActionKind = 'button' | 'pointer';

interface MutableButtonState {
  kind: 'button';
  held: boolean;
  pressed: boolean;
  released: boolean;
  cancelled: boolean;
}

interface MutablePointerState {
  kind: 'pointer';
  /** Whether the pointer owns the action slot (held until the terminal edge is sampled). */
  ownsSlot: boolean;
  /** Whether the owning pointer is currently down (published as `active`). */
  active: boolean;
  pressed: boolean;
  released: boolean;
  cancelled: boolean;
  pointerId: number | undefined;
  position: Point2D | undefined;
  delta: { x: number; y: number };
  /**
   * A pointer that arrived before the terminal edge was sampled (GS-INPUT-01).
   * It carries its own edge/position lifecycle: moves update its position,
   * a terminal edge marks it released/cancelled instead of transferring, so
   * an already-lifted pointer can never go live.
   */
  pending:
    | {
        readonly pointerId: number;
        position: Point2D;
        released: boolean;
        cancelled: boolean;
      }
    | undefined;
}

type MutableInputState = MutableButtonState | MutablePointerState;

interface InputBuffer<TActionName extends string> {
  readonly controller: InputController<TActionName>;
  sample(): InputFrame<TActionName>;
  /** Clear scene-local edges while retaining pointers that remain physically down. */
  resetForTransition(targetActions: readonly string[]): void;
  reset(): void;
}

function freezePoint(x: number, y: number): Point2D {
  return Object.freeze({ x, y });
}

function assertFinitePointerId(pointerId: number): void {
  if (!Number.isFinite(pointerId)) {
    throw new TypeError(`Pointer id must be finite (got ${pointerId})`);
  }
}

function assertFinitePosition(position: Point2D): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new TypeError(`Pointer position must be finite (got ${position.x}, ${position.y})`);
  }
}

export function createInputBuffer<TInput extends InputMap>(
  input: TInput,
  assertLive: () => void,
  isRejectingInput: () => boolean = () => false,
): InputBuffer<Extract<keyof TInput, string>> {
  type ActionName = Extract<keyof TInput, string>;
  const states = new Map<ActionName, MutableInputState>();
  // F1: monotonic count of accepted input events. The lab associates a commit
  // with the inputs its sampled step actually consumed via this counter.
  let acceptedCount = 0;
  let sampledCount = 0;

  for (const [action, actionConfig] of Object.entries(input) as Array<[ActionName, { readonly type: InputActionKind }]>) {
    if (actionConfig.type === 'pointer') {
      states.set(action, {
        kind: 'pointer',
        ownsSlot: false,
        active: false,
        pressed: false,
        released: false,
        cancelled: false,
        pointerId: undefined,
        position: undefined,
        delta: { x: 0, y: 0 },
        pending: undefined,
      });
    } else {
      states.set(action, {
        kind: 'button',
        held: false,
        pressed: false,
        released: false,
        cancelled: false,
      });
    }
  }

  const getState = (action: ActionName): MutableInputState => {
    const state = states.get(action);
    if (!state) {
      throw new Error(`Unknown input action: ${action}`);
    }
    return state;
  };

  const getButton = (action: ActionName): MutableButtonState => {
    const state = getState(action);
    if (state.kind !== 'button') {
      throw new Error(`Input action "${action}" is a pointer action, not a button`);
    }
    return state;
  };

  const getPointer = (action: ActionName): MutablePointerState => {
    const state = getState(action);
    if (state.kind !== 'pointer') {
      throw new Error(`Input action "${action}" is a button action, not a pointer`);
    }
    return state;
  };

  const controller: InputController<ActionName> = Object.freeze({
    get acceptedCount() {
      return acceptedCount;
    },
    get sampledCount() {
      return sampledCount;
    },
    press(action: ActionName) {
      assertLive();
      if (isRejectingInput()) {
        return;
      }
      acceptedCount += 1;
      const state = getButton(action);
      state.pressed ||= !state.held;
      state.held = true;
    },
    release(action: ActionName) {
      assertLive();
      if (isRejectingInput()) {
        return;
      }
      acceptedCount += 1;
      const state = getButton(action);
      state.released ||= state.held;
      state.held = false;
    },
    begin(action: ActionName, pointerId: number, position: Point2D) {
      assertLive();
      if (isRejectingInput()) {
        return;
      }
      assertFinitePointerId(pointerId);
      assertFinitePosition(position);
      const state = getPointer(action);
      if (state.ownsSlot && state.active) {
        return; // Secondary pointer: the first pointer owns the action slot.
      }
      if (state.ownsSlot && !state.active) {
        // The current owner released but the terminal edge has not been
        // sampled yet. Queue the first new pointer and transfer after the
        // release/cancel frame — unless it lifts first (GS-INPUT-01).
        if (state.pending === undefined) {
          state.pending = {
            pointerId,
            position: freezePoint(position.x, position.y),
            released: false,
            cancelled: false,
          };
        }
        acceptedCount += 1;
        return;
      }
      acceptedCount += 1;
      state.ownsSlot = true;
      state.active = true;
      state.pressed = true;
      state.pointerId = pointerId;
      state.position = freezePoint(position.x, position.y);
      state.delta.x = 0;
      state.delta.y = 0;
    },
    move(action: ActionName, pointerId: number, position: Point2D) {
      assertLive();
      if (isRejectingInput()) {
        return;
      }
      assertFinitePointerId(pointerId);
      assertFinitePosition(position);
      const state = getPointer(action);
      if (!state.ownsSlot || !state.active) {
        // A move for the queued pending pointer updates its position so the
        // transfer carries the newest coordinates (GS-INPUT-01). Unrelated
        // ids are still ignored.
        const pending = state.pending;
        if (
          state.ownsSlot &&
          !state.active &&
          pending !== undefined &&
          pending.pointerId === pointerId &&
          !pending.released &&
          !pending.cancelled
        ) {
          acceptedCount += 1;
          pending.position = freezePoint(position.x, position.y);
        }
        return;
      }
      if (state.pointerId !== pointerId) {
        return;
      }
      acceptedCount += 1;
      if (state.position !== undefined) {
        state.delta.x += position.x - state.position.x;
        state.delta.y += position.y - state.position.y;
      }
      state.position = freezePoint(position.x, position.y);
    },
    end(action: ActionName, pointerId: number) {
      assertLive();
      if (isRejectingInput()) {
        return;
      }
      assertFinitePointerId(pointerId);
      const state = getPointer(action);
      if (!state.ownsSlot) {
        return;
      }
      // A terminal edge for the queued pending pointer marks it instead of
      // transferring it: an already-lifted pointer never goes live
      // (GS-INPUT-01). Unrelated ids are still ignored.
      const pending = state.pending;
      if (
        !state.active &&
        pending !== undefined &&
        pending.pointerId === pointerId &&
        !pending.released &&
        !pending.cancelled
      ) {
        acceptedCount += 1;
        pending.released = true;
        return;
      }
      if (state.pointerId !== pointerId) {
        return;
      }
      acceptedCount += 1;
      // The slot stays owned until the release edge is sampled so a fast
      // end -> begin between ticks cannot corrupt the terminal frame.
      state.active = false;
      state.released = true;
    },
    cancel(action: ActionName) {
      assertLive();
      if (isRejectingInput()) {
        return;
      }
      const state = getState(action);
      if (state.kind === 'button') {
        acceptedCount += 1;
        state.cancelled = true;
        state.released ||= state.held;
        state.held = false;
        return;
      }
      if (!state.ownsSlot) {
        return;
      }
      acceptedCount += 1;
      // A whole-action cancellation clears a pending acquisition: nothing
      // queued may go live afterwards (GS-INPUT-01).
      state.pending = undefined;
      // Same slot semantics as `end`.
      state.active = false;
      state.cancelled = true;
    },
  });

  const samplePointer = (state: MutablePointerState): PointerState => {
    const sampled = Object.freeze({
      active: state.active,
      pressed: state.pressed,
      released: state.released,
      cancelled: state.cancelled,
      ...(state.pointerId !== undefined ? { pointerId: state.pointerId } : {}),
      ...(state.position !== undefined ? { position: state.position } : {}),
      delta: freezePoint(state.delta.x, state.delta.y),
    });
    state.pressed = false;
    state.released = false;
    state.cancelled = false;
    state.delta.x = 0;
    state.delta.y = 0;
    if (sampled.released || sampled.cancelled) {
      const pending = state.pending;
      state.pending = undefined;
      if (pending !== undefined && !pending.released && !pending.cancelled) {
        // Transfer to the queued pointer after the terminal frame.
        state.active = true;
        state.pressed = true;
        state.pointerId = pending.pointerId;
        state.position = pending.position;
        state.delta.x = 0;
        state.delta.y = 0;
      } else {
        state.ownsSlot = false;
        state.pointerId = undefined;
        state.position = undefined;
      }
    }
    return sampled;
  };

  return {
    controller,
    sample() {
      sampledCount += 1;
      const sampled = new Map<ActionName, { readonly kind: InputActionKind; readonly state: ButtonState | PointerState }>();
      for (const [action, state] of states) {
        if (state.kind === 'pointer') {
          sampled.set(action, { kind: 'pointer', state: samplePointer(state) });
        } else {
          sampled.set(action, {
            kind: 'button',
            state: Object.freeze({
              held: state.held,
              pressed: state.pressed,
              released: state.released,
              cancelled: state.cancelled,
            }),
          });
          state.pressed = false;
          state.released = false;
          state.cancelled = false;
        }
      }

      return Object.freeze({
        button(action: ActionName) {
          const entry = sampled.get(action);
          if (!entry) {
            throw new Error(`Unknown input action: ${action}`);
          }
          if (entry.kind !== 'button') {
            throw new Error(`Input action "${action}" is a pointer action, not a button`);
          }
          return entry.state as ButtonState;
        },
        pointer(action: ActionName) {
          const entry = sampled.get(action);
          if (!entry) {
            throw new Error(`Unknown input action: ${action}`);
          }
          if (entry.kind !== 'pointer') {
            throw new Error(`Input action "${action}" is a button action, not a pointer`);
          }
          return entry.state as PointerState;
        },
      });
    },
    resetForTransition(targetActions: readonly string[]) {
      const targetActionSet = new Set(targetActions);
      for (const [action, state] of states) {
        const preservePointer =
          state.kind === 'pointer' &&
          state.ownsSlot &&
          state.active &&
          targetActionSet.has(action);

        if (state.kind === 'pointer') {
          if (!preservePointer) {
            state.ownsSlot = false;
            state.active = false;
            state.pointerId = undefined;
            state.position = undefined;
          }
          state.pending = undefined;
          state.delta.x = 0;
          state.delta.y = 0;
        } else {
          // Buttons are semantic scene actions rather than a continuous spatial
          // gesture. Do not leak a held button into a newly created scene.
          state.held = false;
        }
        state.pressed = false;
        state.released = false;
        state.cancelled = false;
      }
    },
    reset() {
      for (const state of states.values()) {
        if (state.kind === 'pointer') {
          state.ownsSlot = false;
          state.active = false;
          state.pointerId = undefined;
          state.position = undefined;
          state.pending = undefined;
          state.delta.x = 0;
          state.delta.y = 0;
        } else {
          state.held = false;
        }
        state.pressed = false;
        state.released = false;
        state.cancelled = false;
      }
    },
  };
}
