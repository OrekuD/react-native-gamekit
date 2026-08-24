/**
 * Platformer Lab camera binding: the presented camera tracks the player's
 * committed snapshot position, clamped to the level bounds. The explicit
 * spawn cut snaps on the first frame.
 */
import { defineGameCamera2D } from 'rn-gamekit/react';
import { createCamera2D } from 'rn-gamekit';

import {
  PLATFORMER_LAB_VIEW,
  PLATFORMER_LAB_WORLD,
  followCenterFor,
  type PlatformerLabSnapshot,
} from './platformerLabGame';

export const platformerLabCamera = defineGameCamera2D<{ current: PlatformerLabSnapshot }>({
  select: (frame) =>
    createCamera2D({
      center: followCenterFor({
        x: frame.current.body.x + frame.current.body.width / 2,
        y: frame.current.body.y + frame.current.body.height / 2,
      }),
    }),
  // Deterministic spawn snap; never cuts again afterwards.
  cut: (frame) => frame.current.ticks <= 1,
});

export { PLATFORMER_LAB_WORLD, PLATFORMER_LAB_VIEW };
