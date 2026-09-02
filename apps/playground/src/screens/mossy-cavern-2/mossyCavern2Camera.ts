/** Mossy Cavern 2's one GameView-owned presentation camera binding. */
import { defineGameCamera2D } from 'rn-gamekit/react';

import type { MossyCavern2Definition } from './mossyCavern2Game.ts';

/**
 * The headless scene authors the follow/shake camera. GameView owns its
 * interpolation and makes the identical presented value available to input.
 */
export const mossyCavern2Camera = defineGameCamera2D<
  import('rn-gamekit').CommitFrame<MossyCavern2Definition['scenes']>
>({
  select: (frame) => frame.current.camera,
  cut: (frame) => frame.current.cameraCut,
});
