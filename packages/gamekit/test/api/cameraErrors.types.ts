import type { Camera2D } from 'rn-gamekit';
import {
  defineGameCamera2D,
  type GameCameraErrorInfo,
} from 'rn-gamekit/react';

// A shared error reporter can use a public import without reaching into src/.
function reportCameraError(info: GameCameraErrorInfo): void {
  info.phase satisfies 'select' | 'cut' | 'validate';
  info.scene satisfies string;
  info.error satisfies unknown;
  if (info.error instanceof Error) {
    info.error.message satisfies string;
  }
  // @ts-expect-error reporter context is read-only
  info.scene = 'other';
}

defineGameCamera2D<{ readonly current: { readonly camera: Camera2D } }>({
  select: (frame) => frame.current.camera,
  onError: reportCameraError,
});
