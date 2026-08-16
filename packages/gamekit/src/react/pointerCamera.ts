/**
 * Event-time camera selection for pointer packets (T12-SF1, T12-TF1).
 *
 * Internal module (not part of the public barrel): the ONE rule that pairs
 * a forwarded pointer event with the presented camera at the event's own
 * native sample. `GamePointerInput` and the focused tests import the same
 * function, so the test can never drift from production.
 */
import type { CameraCut2D } from '../camera2d';
import type { CoalescedPointerEvent } from './pointerCoalescer';

/** A move's explicit capture: `captured: true` even when the value is
 * undefined, so a captured-undefined camera is distinguishable from "no
 * stamp" and never falls back to a later presentation (T12-SF1). */
export interface PointerCameraCapture2D {
  readonly captured: true;
  readonly value: CameraCut2D | undefined;
}

/** The event-time camera for one forwarded event (worklet-safe). */
export function packetCameraFor(
  forwarded: CoalescedPointerEvent,
  presented: CameraCut2D | undefined,
): CameraCut2D | undefined {
  'worklet';
  if (forwarded.kind === 'move') {
    const stamp = forwarded.stamp as PointerCameraCapture2D | undefined;
    // A move ALWAYS carries its capture (possibly undefined): a captured
    // undefined stays undefined — never fall back to a later camera.
    return stamp !== undefined ? stamp.value : presented;
  }
  return presented;
}
