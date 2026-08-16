/**
 * Camera Lab instrumentation (T12-F8).
 *
 * Reuses the package's `GameViewInstrumentation` / `GamePointerInstrumentation`
 * interfaces — no second metrics model. The lab counts raw touches,
 * forwarded events, accepted/rejected dispatches, and presented commits,
 * and exposes the counters to the HUD.
 */
import type { GamePointerInstrumentation, GameViewInstrumentation } from 'rn-gamekit/react';

export interface CameraLabCounters {
  readonly rawTouches: number;
  readonly forwarded: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly presentedCommits: number;
}

/** One instrumentation pair plus a read-only counter snapshot. */
export interface CameraLabInstrumentation {
  readonly pointer: GamePointerInstrumentation;
  readonly view: GameViewInstrumentation;
  readCounters(): CameraLabCounters;
}

export function createCameraLabInstrumentation(): CameraLabInstrumentation {
  let rawTouches = 0;
  let forwarded = 0;
  let accepted = 0;
  let rejected = 0;
  let presentedCommits = 0;

  const pointer: GamePointerInstrumentation = {
    onRawTouch: () => {
      rawTouches += 1;
    },
    onForwarded: () => {
      forwarded += 1;
    },
    onDispatchResult: (_seq, _atMs, isAccepted) => {
      if (isAccepted) {
        accepted += 1;
      } else {
        rejected += 1;
      }
    },
  };
  const view: GameViewInstrumentation = {
    onPresentCommit: () => {
      presentedCommits += 1;
    },
  };

  return {
    pointer,
    view,
    readCounters: () => ({
      rawTouches,
      forwarded,
      accepted,
      rejected,
      presentedCommits,
    }),
  };
}
