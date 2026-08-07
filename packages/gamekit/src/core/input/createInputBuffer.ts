import type { InputMap } from '../../definition/types';
import type { ButtonState, InputController, InputFrame } from './types';

interface MutableButtonState {
  held: boolean;
  pressed: boolean;
  released: boolean;
  cancelled: boolean;
}

interface InputBuffer<TActionName extends string> {
  readonly controller: InputController<TActionName>;
  sample(): InputFrame<TActionName>;
  reset(): void;
}

export function createInputBuffer<TInput extends InputMap>(
  input: TInput,
  assertLive: () => void,
): InputBuffer<Extract<keyof TInput, string>> {
  type ActionName = Extract<keyof TInput, string>;
  const states = new Map<ActionName, MutableButtonState>();

  for (const action of Object.keys(input) as ActionName[]) {
    states.set(action, { held: false, pressed: false, released: false, cancelled: false });
  }

  const getState = (action: ActionName): MutableButtonState => {
    const state = states.get(action);
    if (!state) {
      throw new Error(`Unknown input action: ${action}`);
    }
    return state;
  };

  const controller: InputController<ActionName> = Object.freeze({
    press(action: ActionName) {
      assertLive();
      const state = getState(action);
      state.pressed ||= !state.held;
      state.held = true;
    },
    release(action: ActionName) {
      assertLive();
      const state = getState(action);
      state.released ||= state.held;
      state.held = false;
    },
    cancel(action: ActionName) {
      assertLive();
      const state = getState(action);
      state.cancelled = true;
      state.released ||= state.held;
      state.held = false;
    },
  });

  return {
    controller,
    sample() {
      const sampled = new Map<ActionName, ButtonState>();
      for (const [action, state] of states) {
        sampled.set(
          action,
          Object.freeze({
            held: state.held,
            pressed: state.pressed,
            released: state.released,
            cancelled: state.cancelled,
          }),
        );
        state.pressed = false;
        state.released = false;
        state.cancelled = false;
      }

      return Object.freeze({
        button(action: ActionName) {
          const state = sampled.get(action);
          if (!state) {
            throw new Error(`Unknown input action: ${action}`);
          }
          return state;
        },
      });
    },
    reset() {
      for (const state of states.values()) {
        state.held = false;
        state.pressed = false;
        state.released = false;
        state.cancelled = false;
      }
    },
  };
}
