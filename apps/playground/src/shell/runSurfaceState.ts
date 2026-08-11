import type { GameSession } from 'react-native-gamekit';
import type {
  GamePointerInstrumentation,
  GameViewInstrumentation,
} from 'react-native-gamekit/react';

/** One lab-owned session and the instrumentation that must follow it. */
export interface RunSurfaceAttachment {
  readonly session: GameSession;
  readonly pointer: GamePointerInstrumentation;
  readonly view: GameViewInstrumentation;
}

/** An explicit ownership transfer between a lab host and the shell. */
export type RunSurfaceEvent =
  | { readonly kind: 'attach'; readonly attachment: RunSurfaceAttachment }
  | { readonly kind: 'detach'; readonly session: GameSession };

/**
 * Shell-owned state for a temporary lab surface.
 *
 * Retired sessions remain alive until a render without them has committed.
 * The React owner calls `settleRunSurfaceState` from its passive effect and
 * performs the returned disposals there, never from a child cleanup.
 */
export interface RunSurfaceState {
  readonly current: RunSurfaceAttachment | undefined;
  readonly retiring: readonly GameSession[];
}

export const EMPTY_RUN_SURFACE_STATE: RunSurfaceState = {
  current: undefined,
  retiring: [],
};

/** Apply a host attach/detach without disposing any session. */
export function reduceRunSurfaceState(
  state: RunSurfaceState,
  event: RunSurfaceEvent,
): RunSurfaceState {
  if (event.kind === 'attach') {
    const previous = state.current;
    const retiring =
      previous === undefined || previous.session === event.attachment.session
        ? state.retiring
        : appendUnique(state.retiring, previous.session);
    return {
      current: event.attachment,
      retiring,
    };
  }

  const current =
    state.current?.session === event.session ? undefined : state.current;
  return {
    current,
    retiring: appendUnique(state.retiring, event.session),
  };
}

/**
 * Finish the post-commit handoff.
 *
 * The returned sessions are now absent from the committed surface and may be
 * disposed. A stale detach can retire its own session but cannot clear a
 * newer current attachment.
 */
export function settleRunSurfaceState(state: RunSurfaceState): {
  readonly state: RunSurfaceState;
  readonly disposable: readonly GameSession[];
} {
  if (state.retiring.length === 0) {
    return { state, disposable: [] };
  }
  return {
    state: { current: state.current, retiring: [] },
    disposable: state.retiring,
  };
}

function appendUnique(
  sessions: readonly GameSession[],
  session: GameSession,
): readonly GameSession[] {
  return sessions.includes(session) ? sessions : [...sessions, session];
}
