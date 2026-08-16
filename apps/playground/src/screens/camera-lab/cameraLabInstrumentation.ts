/**
 * Camera Lab instrumentation (T12-F8, T12-RF2, T12-SF2, T12-TF2).
 *
 * Runtime classification:
 *
 * - UI-runtime callbacks (`onRawTouch`, `onForwarded`) are workletized and
 *   mutate shared values only.
 * - RN-runtime callbacks (`onDispatchResult`, `onDispatchRejected`,
 *   `onPresentCommit`, `onUiRevisionObserved`) run on the JS runtime —
 *   `GameView` deliberately `scheduleOnRN`s the observed-revision callback —
 *   so they update RN refs only and never carry a worklet directive.
 *
 * UI counters transfer to RN at the DIAGNOSTIC cadence (T12-TF2): a UI
 * frame callback skips the transfer entirely unless counters changed AND
 * the 125 ms interval elapsed AND the instrumentation is active (attached).
 * `readCounters()` reads ONLY the latest RN snapshot and refs — it never
 * synchronously reads a UI-owned `.value`.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { surfaceToWorld2D, worldToSurface2D } from 'rn-gamekit';
import type { GamePointerInstrumentation, GameViewInstrumentation } from 'rn-gamekit/react';

/** The diagnostic publication cadence (T12-F7, T12-TF2): ~8 Hz. */
export const DIAGNOSTIC_TRANSFER_INTERVAL_MS = 125;

export interface CameraLabCounters {
  readonly rawTouches: number;
  readonly forwarded: number;
  readonly accepted: number;
  readonly rejectedLayoutEpoch: number;
  readonly rejectedBinding: number;
  readonly presentedCommits: number;
  readonly uiObserved: number;
  readonly roundTripError: number;
}

/** One instrumentation pair plus a read-only counter snapshot. */
export interface CameraLabInstrumentation {
  readonly pointer: GamePointerInstrumentation;
  readonly view: GameViewInstrumentation;
  readCounters(): CameraLabCounters;
  /** Enable/disable the UI -> RN transfer (attached/detached). */
  setActive(active: boolean): void;
}

/** The immutable UI -> RN snapshot. */
interface UiSnapshot {
  readonly rawTouches: number;
  readonly forwarded: number;
}

/** Create the lab's instrumentation pair (hooks: call at the top level). */
export function useCameraLabInstrumentation(): CameraLabInstrumentation {
  const rawTouches = useSharedValue(0);
  const forwarded = useSharedValue(0);
  const active = useSharedValue(false);
  const lastTransferAt = useSharedValue(0);
  const lastSentRaw = useSharedValue(-1);
  const lastSentForwarded = useSharedValue(-1);
  // RN-owned state: refs only.
  const uiSnapshotRef = useRef<UiSnapshot>({ rawTouches: 0, forwarded: 0 });
  const acceptedRef = useRef(0);
  const rejectedLayoutEpochRef = useRef(0);
  const rejectedBindingRef = useRef(0);
  const presentedCommitsRef = useRef(0);
  const uiObservedRef = useRef(0);
  // T12-TF3: the round-trip error of the LAST accepted pointer sample,
  // measured from the REAL pipeline inputs (surface, mounted viewport,
  // event-time camera cut, delivered world).
  const roundTripErrorRef = useRef(0);

  // Stable RN receiver, captured DIRECTLY by the frame worklet (T12-TF2):
  // a stable useCallback identity needs no ref indirection across the
  // runtime boundary.
  const onUiTransfer = useCallback((snapshot: UiSnapshot) => {
    uiSnapshotRef.current = snapshot;
  }, []);

  // UI -> RN transfer at the diagnostic cadence (T12-TF2): skipped unless
  // counters changed, the 125 ms interval elapsed, and the instrumentation
  // is attached.
  useFrameCallback((frameInfo) => {
    'worklet';
    if (!active.value) {
      return;
    }
    if (rawTouches.value === lastSentRaw.value && forwarded.value === lastSentForwarded.value) {
      return;
    }
    const now = frameInfo.timestamp ?? 0;
    if (now - lastTransferAt.value < DIAGNOSTIC_TRANSFER_INTERVAL_MS) {
      return;
    }
    lastSentRaw.value = rawTouches.value;
    lastSentForwarded.value = forwarded.value;
    lastTransferAt.value = now;
    scheduleOnRN(onUiTransfer, {
      rawTouches: rawTouches.value,
      forwarded: forwarded.value,
    });
  });

  const pointer = useMemo<GamePointerInstrumentation>(
    () => ({
      // UI runtime (worklet): the manual gesture handlers call these.
      onRawTouch: () => {
        'worklet';
        // Worklet-owned shared-value writes are the sanctioned UI store.
        // eslint-disable-next-line react-hooks/immutability
        rawTouches.value += 1;
      },
      onForwarded: () => {
        'worklet';
        // eslint-disable-next-line react-hooks/immutability
        forwarded.value += 1;
      },
      // RN runtime (JS): the binding's verdict for a dispatched packet.
      onDispatchResult: (_seq: number, _atMs: number, accepted: boolean) => {
        if (accepted) {
          acceptedRef.current += 1;
        }
      },
      // RN runtime (JS): the CAUSE of a rejected packet (T12-RF7).
      onDispatchRejected: (cause: 'layout-epoch' | 'binding') => {
        if (cause === 'layout-epoch') {
          rejectedLayoutEpochRef.current += 1;
        } else {
          rejectedBindingRef.current += 1;
        }
      },
      // RN runtime (JS): one ACCEPTED conversion from the real binding
      // (T12-TF3). The world coordinate is projected back to surface
      // through the SAME event-time camera and mounted viewport; the
      // residual is the round-trip error.
      onPointerSample: (sample: {
        surface: { x: number; y: number };
        viewport: { visibleLogicalBounds: { x: number; y: number; width: number; height: number }; scale: number; offsetX: number; offsetY: number };
        camera: { camera: { center: { x: number; y: number }; zoom: number; rotationRadians: number } } | undefined;
        world: { x: number; y: number };
      }) => {
        const camera = sample.camera?.camera;
        if (camera === undefined) {
          roundTripErrorRef.current = 0;
          return;
        }
        const back = worldToSurface2D(sample.world, sample.viewport as never, camera);
        roundTripErrorRef.current = Math.hypot(back.x - sample.surface.x, back.y - sample.surface.y);
      },
    }),
    [],
  );
  const view = useMemo<GameViewInstrumentation>(
    () => ({
      // RN runtime (JS): the commit listener feeds the frame.
      onPresentCommit: () => {
        presentedCommitsRef.current += 1;
      },
      // RN runtime (JS): GameView schedules the UI observation onto RN
      // (T12-SF2) — never a worklet, never a shared value.
      onUiRevisionObserved: () => {
        uiObservedRef.current += 1;
      },
    }),
    [],
  );

  const setActive = useCallback(
    (isActive: boolean) => {
      // Shared-value writes are the sanctioned UI store.
      // eslint-disable-next-line react-hooks/immutability
      active.value = isActive;
      if (!isActive) {
        // eslint-disable-next-line react-hooks/immutability
        lastSentRaw.value = -1;
        // eslint-disable-next-line react-hooks/immutability
        lastSentForwarded.value = -1;
        // eslint-disable-next-line react-hooks/immutability
        lastTransferAt.value = 0;
      }
    },
    [active, lastSentForwarded, lastSentRaw, lastTransferAt],
  );

  const readCounters = useCallback(
    (): CameraLabCounters => {
      const snapshot = uiSnapshotRef.current;
      return {
        rawTouches: snapshot.rawTouches,
        forwarded: snapshot.forwarded,
        accepted: acceptedRef.current,
        rejectedLayoutEpoch: rejectedLayoutEpochRef.current,
        rejectedBinding: rejectedBindingRef.current,
        presentedCommits: presentedCommitsRef.current,
        uiObserved: uiObservedRef.current,
        roundTripError: roundTripErrorRef.current,
      };
    },
    [],
  );

  return { pointer, view, readCounters, setActive };
}
