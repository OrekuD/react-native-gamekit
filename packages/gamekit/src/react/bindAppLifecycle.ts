import type { GameSessionStatus } from '../core/session/types';

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

  const pauseForBackground = () => {
    if (session.getStatus() === 'running') {
      session.pause();
      pausedByLifecycle = true;
    }
  };

  // Synchronize the initial app state before any change event arrives.
  if (source.currentState === 'inactive' || source.currentState === 'background') {
    pauseForBackground();
  }

  const subscription = source.addEventListener('change', (next) => {
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
    if (next === 'inactive' || next === 'background') {
      pauseForBackground();
    }
  });

  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    subscription.remove();
    pausedByLifecycle = false;
  };
}
