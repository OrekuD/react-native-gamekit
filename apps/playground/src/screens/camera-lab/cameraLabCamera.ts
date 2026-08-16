/**
 * Camera Lab camera binding (T12.8).
 *
 * Selects the authored camera from the lab snapshot and snaps on the
 * explicit teleport-cut signal.
 */
import { defineGameCamera2D } from 'rn-gamekit/react';

import type { CameraLabSnapshot } from './cameraLabGame';

export const cameraLabCamera = defineGameCamera2D<{ current: CameraLabSnapshot }>({
  select: (frame) => frame.current.camera,
  cut: (frame) => frame.current.cutSignal,
});
