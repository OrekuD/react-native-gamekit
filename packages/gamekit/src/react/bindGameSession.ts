import type { InputMap, SceneMap } from '../definition/types';
import type { GameRenderFrame, GameSession } from '../core/session/types';

/**
 * Bind a live session to an imperative presentation sink.
 *
 * This platform-neutral lifecycle seam keeps the React adapter testable
 * without loading React Native or Skia in the headless test runner.
 */
export function bindGameSession<TScenes extends SceneMap, TInput extends InputMap>(
  game: GameSession<TScenes, TInput>,
  present: (frame: GameRenderFrame<TScenes>) => void,
): () => void {
  present(game.getRenderFrame());
  const subscription = game.addRenderFrameListener(present);
  game.start();
  let cleanedUp = false;

  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    subscription.remove();
    if (game.status !== 'disposed') {
      game.pause();
    }
  };
}
