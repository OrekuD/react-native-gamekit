/**
 * Sprite Field camera binding (T12.7).
 *
 * The camera definition is React-side glue: it selects the authored camera
 * from the committed play snapshot. It lives outside the headless game
 * module so the game stays importable in Node tests.
 */
import { defineGameCamera2D } from 'rn-gamekit/react';

import type { PlaySnapshot } from './spriteFieldGame';

export const spriteFieldCamera = defineGameCamera2D<{ current: PlaySnapshot }>({
  select: (frame) => frame.current.camera,
});
