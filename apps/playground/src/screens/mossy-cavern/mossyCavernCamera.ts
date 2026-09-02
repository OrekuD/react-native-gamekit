/** Mossy Cavern's single GameView-owned camera binding. */
import { defineGameCamera2D } from 'rn-gamekit/react';

import type { MossyCavernSnapshot } from './mossyCavernGame';

export const mossyCavernCamera = defineGameCamera2D<{
  readonly current: MossyCavernSnapshot;
}>({
  select: (frame) => frame.current.camera,
  cut: (frame) => frame.current.spawnCut || frame.current.ticks <= 1,
});
