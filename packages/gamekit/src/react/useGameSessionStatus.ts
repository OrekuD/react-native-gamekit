import { useSyncExternalStore } from 'react';
import type { GameSession, GameSessionStatus } from '../core/session/types';
import type { InputMap, SceneMap } from '../definition/types';

/**
 * Observe a session's lifecycle status from React.
 *
 * Returns the current `session.status` on the render that observes a
 * session, and re-renders once per actual lifecycle transition. `undefined`
 * means no session is currently available — the same meaning Task 9's
 * `useGameSession()` gives its pre-commit value, so both hooks compose
 * unconditionally:
 *
 * ```ts
 * const session = useGameSession(game);
 * const status = useGameSessionStatus(session);
 * ```
 *
 * The hook subscribes through `addStatusListener` and never polls; it owns
 * no session and never disposes one. Replacing the session argument detaches
 * the old subscription before the replacement's status is reported, and
 * idempotent lifecycle commands do not cause redundant re-renders.
 */
export function useGameSessionStatus<
  TScenes extends SceneMap,
  TInput extends InputMap,
>(session: GameSession<TScenes, TInput> | undefined): GameSessionStatus | undefined {
  // The subscribe/get-snapshot closures capture the session of the render
  // that created them; React re-subscribes whenever the subscribe identity
  // changes, so a session prop change detaches the old session first.
  return useSyncExternalStore(
    (onStoreChange) => {
      // Never subscribe to a disposed session: its terminal notification is
      // already delivered, and addStatusListener follows the disposed-error
      // policy for new subscribers.
      if (session === undefined || session.status === 'disposed') {
        return () => {};
      }
      const subscription = session.addStatusListener(onStoreChange);
      return () => {
        subscription.remove();
      };
    },
    () => session?.status,
  );
}
