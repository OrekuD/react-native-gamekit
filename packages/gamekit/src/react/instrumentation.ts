/**
 * Optional measurement seams for the mounted game pipeline (F1).
 *
 * These callbacks let the Performance Lab attribute results to the real
 * mounted components — GameView presentation, RNGH raw touches, and
 * UI→RN forwarding — instead of headless substitutes. They are optional,
 * cost nothing when absent (a single optional chain at event sites, never
 * per-frame), and are not part of the gameplay API contract: the playground
 * lab is their only consumer until the device matrix approves them.
 *
 * Runtime ownership:
 * - Pointer callbacks run on the **UI runtime** (inside gesture worklets);
 *   pass stable workletized closures and only touch worklet-safe state
 *   (shared values, counters).
 * - `onPresentCommit` runs on the **RN runtime** (inside the commit
 *   binding); pass a plain JS callback.
 */

import type { CoalescedPointerEvent } from './pointerCoalescer';

/** Raw touch kinds as observed by the manual gesture callbacks. */
export type PointerStageKind = 'down' | 'move' | 'up' | 'cancel';

/** Pointer pipeline instrumentation (UI runtime callbacks). */
export interface GamePointerInstrumentation {
  /** A raw touch reached the manual gesture handlers. */
  readonly onRawTouch?: (kind: PointerStageKind, pointerId: number, atMs: number) => void;
  /** A coalesced event crossed from the UI runtime into the RN runtime. */
  readonly onForwarded?: (
    kind: CoalescedPointerEvent['kind'],
    pointerId: number,
    atMs: number,
  ) => void;
}

/** GameView presentation instrumentation (RN runtime callback). */
export interface GameViewInstrumentation {
  /** A commit was presented to the canvas frame shared value. */
  readonly onPresentCommit?: (revision: number, atMs: number) => void;
}
