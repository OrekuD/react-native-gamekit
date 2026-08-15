import type { GameSessionStatus, GameSubscription } from '../core/session/types';

/** Minimal AppState-like source used to keep this seam platform-neutral. */
export interface AppLifecycleSource {
  /** The current app state, read synchronously at bind time. */
  readonly currentState: string | null | undefined;
  addEventListener(
    state: 'change',
    listener: (next: string) => void,
  ): { remove(): void };
}

/** Session operations the lifecycle binding may drive. */
export interface AppLifecycleSession {
  /** Read the current session status. */
  getStatus(): GameSessionStatus;
  /** Pause simulation and discard suspended wall time. */
  pause(): void;
  /** Resume a paused session. */
  resume(): void;
  /**
   * Optional status observation (T10.6): when present, the binder also
   * guards against an external `start()` while the host is inactive, so a
   * frame loop can never escape into the background.
   */
  addStatusListener?(listener: (status: GameSessionStatus) => void): GameSubscription;
}

/**
 * Pause a running session when the app becomes inactive or backgrounded and
 * resume it on foreground only when this binding performed that pause.
 *
 * Platform-neutral: the React adapter supplies React Native's `AppState`.
 * The initial `currentState` is synchronized at bind time, so an app that
 * mounts while already backgrounded never leaves a session running
 * invisibly. Manual pauses that precede backgrounding are never claimed, and
 * a session that another actor resumed (or disposed) meanwhile is not
 * resumed again. Cleanup clears the binding flag so a late foreground event
 * cannot restart an unmounted game.
 */
export function bindAppLifecycle(
  source: AppLifecycleSource,
  session: AppLifecycleSession,
): () => void {
  let pausedByLifecycle = false;
  let currentState = source.currentState ?? 'active';

  const isInactive = (state: string | null | undefined): boolean =>
    state === 'inactive' || state === 'background';

  const pauseForBackground = () => {
    if (session.getStatus() === 'running') {
      session.pause();
      pausedByLifecycle = true;
    }
  };

  // T10.6: an external start() while the host is inactive is deterministically
  // returned to paused. The binder observes status transitions and re-pauses
  // any running transition that happens while the app is not active, so a
  // frame loop cannot escape into the background.
  let statusSubscription: GameSubscription | undefined;
  if (session.addStatusListener !== undefined) {
    statusSubscription = session.addStatusListener((status) => {
      if (status === 'running' && isInactive(currentState)) {
        session.pause();
        pausedByLifecycle = true;
      }
    });
  }

  // Synchronize the initial app state before any change event arrives.
  if (isInactive(source.currentState)) {
    pauseForBackground();
  }

  const subscription = source.addEventListener('change', (next) => {
    currentState = next;
    if (next === 'active') {
      if (pausedByLifecycle) {
        pausedByLifecycle = false;
        // Resume only if the session is still paused; a different actor may
        // have resumed or disposed it while the app was backgrounded.
        if (session.getStatus() === 'paused') {
          session.resume();
        }
      }
      return;
    }
    if (isInactive(next)) {
      pauseForBackground();
    }
  });

  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    statusSubscription?.remove();
    subscription.remove();
    pausedByLifecycle = false;
  };
}
