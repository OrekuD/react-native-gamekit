import type { GameSession, RenderFrame } from '../core/session/types';

/**
 * Bind a live session to an imperative presentation sink.
 *
 * This platform-neutral lifecycle seam keeps the React adapter testable
 * without loading React Native or Skia in the headless test runner.
 */
export function bindGameSession<TActionName extends string, TSnapshot>(
  game: GameSession<TActionName, TSnapshot>,
  present: (frame: RenderFrame<TSnapshot>) => void,
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
