/**
 * T20.3: GameView owns one lifecycle source per session and supplies it to
 * its renderer subtree through context. Presentation consumers (particle
 * presentation, haptics binders) read the source instead of casting to
 * private session methods or reaching for module-global coordinators.
 *
 * The source itself is a frozen plain value created by
 * `createGameLifecycleSource`; replacing the session replaces the source, so
 * a consumer bound to the old generation can never observe the new one.
 */
import { createContext, useContext } from 'react';
import type {
  GameLifecycleSource,
  GameSession,
  GameSessionStatus,
} from '../core/session/types';
import type { InputMap, SceneMap } from '../definition/types';

export type { GameLifecycleSource, GameSessionStatus };

const NOOP_DETACH = (): void => {};

/**
 * Create the read-only lifecycle source for one session. The returned value
 * is a frozen plain value with exactly `getStatus` and `subscribe`.
 */
export function createGameLifecycleSource<TScenes extends SceneMap, TInput extends InputMap>(
  session: GameSession<TScenes, TInput>,
): GameLifecycleSource {
  return Object.freeze({
    getStatus: () => session.status,
    subscribe(listener: (status: GameSessionStatus) => void): () => void {
      // Disposed-error policy (mirrors useGameSessionStatus): the terminal
      // notification was already delivered; never throw from a subscription.
      if (session.status === 'disposed') return NOOP_DETACH;
      const subscription = session.addStatusListener(listener);
      return () => subscription.remove();
    },
  });
}

const GameLifecycleContext = createContext<GameLifecycleSource | undefined>(undefined);

/** Supply the owning session's lifecycle source to a renderer subtree. */
export const GameLifecycleProvider = GameLifecycleContext.Provider;

/**
 * Read the lifecycle source provided by the surrounding `GameView`.
 *
 * `undefined` means the consumer is mounted outside a `GameView` — a
 * legitimate state for screens that drive presentation without a session
 * (they pass no lifecycle to `useParticlePresentation` and keep manual pause
 * independent). Inside a `GameView` the value is always present and is
 * replaced together with the session.
 */
export function useGameLifecycleSource(): GameLifecycleSource | undefined {
  return useContext(GameLifecycleContext);
}
