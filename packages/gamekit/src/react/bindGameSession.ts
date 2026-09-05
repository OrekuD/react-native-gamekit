import type { InputMap, SceneMap } from '../definition/types';
import type { CommitFrame, GameSession } from '../core/session/types';
import { createCleanupList } from './cleanupList';

/**
 * Bind a live session to an imperative presentation sink.
 *
 * This platform-neutral lifecycle seam keeps the React adapter testable
 * without loading React Native or Skia in the headless test runner. The sink
 * receives commit frames only (simulation frequency), never per-display
 * frames, and a stale write can never replace a newer commit: revisions are
 * strictly increasing per session, and the initial envelope is presented
 * through the same guard.
 */
export function bindGameSession<TScenes extends SceneMap, TInput extends InputMap>(
  game: GameSession<TScenes, TInput>,
  present: (frame: CommitFrame<TScenes>) => void,
): () => void {
  // GS-REACT-02: setup is transactional — the commit listener registered
  // below is released when the subsequent start() throws.
  const cleanups = createCleanupList();
  let lastRevision = -1;
  const presentIfNewer = (frame: CommitFrame<TScenes>) => {
    if (frame.revision <= lastRevision) {
      return;
    }
    lastRevision = frame.revision;
    present(frame);
  };
  presentIfNewer(game.getRenderFrame());
  const subscription = game.addCommitListener(presentIfNewer);
  cleanups.add(() => subscription.remove());
  try {
    game.start();
  } catch (error) {
    cleanups.releaseAll();
    throw error;
  }
  let cleanedUp = false;

  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    cleanups.releaseAll();
    if (game.status !== 'disposed') {
      game.pause();
    }
  };
}
