/**
 * Camera Lab instrumentation (T12-F8, T12-RF2, T12-SF2).
 *
 * Runtime classification (T12-SF2):
 *
 * - UI-runtime callbacks (`onRawTouch`, `onForwarded`) are workletized and
 *   mutate shared values only.
 * - RN-runtime callbacks (`onDispatchResult`, `onDispatchRejected`,
 *   `onPresentCommit`, `onUiRevisionObserved`) run on the JS runtime —
 *   `GameView` deliberately `scheduleOnRN`s the observed-revision callback —
 *   so they update RN refs only and never carry a worklet directive.
 *
 * UI counters are transferred to RN at frame cadence: a UI frame callback
 * copies the shared values into a small immutable snapshot and schedules a
 * stable RN receiver. `readCounters()` reads ONLY the latest RN snapshot
 * and refs — it never synchronously reads a UI-owned `.value`.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { GamePointerInstrumentation, GameViewInstrumentation } from 'rn-gamekit/react';

export interface CameraLabCounters {
  readonly rawTouches: number;
  readonly forwarded: number;
  readonly accepted: number;
  readonly rejectedLayoutEpoch: number;
  readonly rejectedBinding: number;
  readonly presentedCommits: number;
  readonly uiObserved: number;
}

/** One instrumentation pair plus a read-only counter snapshot. */
export interface CameraLabInstrumentation {
  readonly pointer: GamePointerInstrumentation;
  readonly view: GameViewInstrumentation;
  readCounters(): CameraLabCounters;
}

/** The immutable UI -> RN snapshot (T12-SF2). */
interface UiSnapshot {
  readonly rawTouches: number;
  readonly forwarded: number;
}

/** Create the lab's instrumentation pair (hooks: call at the top level). */
export function useCameraLabInstrumentation(): CameraLabInstrumentation {
  const rawTouches = useSharedValue(0);
  const forwarded = useSharedValue(0);
  // RN-owned state: refs only (T12-SF2).
  const uiSnapshotRef = useRef<UiSnapshot>({ rawTouches: 0, forwarded: 0 });
  const acceptedRef = useRef(0);
  const rejectedLayoutEpochRef = useRef(0);
  const rejectedBindingRef = useRef(0);
  const presentedCommitsRef = useRef(0);
  const uiObservedRef = useRef(0);

  // Stable RN receiver: updates the snapshot ref. Referenced through a ref
  // so the scheduled closure never goes stale across rerenders.
  const receiveUiSnapshot = useCallback((snapshot: UiSnapshot) => {
    uiSnapshotRef.current = snapshot;
  }, []);
  const receiveUiSnapshotRef = useRef(receiveUiSnapshot);
  useEffect(() => {
    receiveUiSnapshotRef.current = receiveUiSnapshot;
  });

  // UI -> RN transfer at frame cadence (T12-SF2): the UI frame callback
  // copies the shared-value counters into an immutable snapshot and hands
  // it to the stable receiver on RN. readCounters() never touches UI-owned
  // values.
  useFrameCallback(() => {
    'worklet';
    scheduleOnRN(receiveUiSnapshotRef.current, {
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
      };
    },
    [],
  );

  return { pointer, view, readCounters };
}
