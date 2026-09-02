import { defineGameCamera2D } from 'rn-gamekit/react';

import type { MossyCavern3RenderFrame } from './mossyCavern3Game.ts';

export const mossyCavern3Camera = defineGameCamera2D<MossyCavern3RenderFrame>({
  cut: (frame) =>
    frame.previous !== undefined && frame.previous.cameraCutId !== frame.current.cameraCutId,
  select: (frame) => frame.current.camera,
});
