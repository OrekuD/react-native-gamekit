/**
 * Camera Lab instrumentation (T12-F8, T12-RF2).
 *
 * Follows the Performance Lab model: UI-owned counters live in Reanimated
 * shared values mutated only by workletized callbacks; RN-owned state
 * (accepted/rejected dispatch verdicts, presented commits) lives in refs.
 * The HUD transfers a bounded immutable snapshot at its diagnostic cadence
 * by reading the shared values from the JS runtime — an ordinary closure
 * can never observe worklet mutations, so the callback objects are stable
 * across the forced React rerender.
 */
import { useCallback, useMemo, useRef } from 'react';
import { useSharedValue } from 'react-native-reanimated';
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

/** Create the lab's instrumentation pair (hooks: call at the top level). */
export function useCameraLabInstrumentation(): CameraLabInstrumentation {
  const rawTouches = useSharedValue(0);
  const forwarded = useSharedValue(0);
  const uiObserved = useSharedValue(0);
  const acceptedRef = useRef(0);
  const rejectedLayoutEpochRef = useRef(0);
  const rejectedBindingRef = useRef(0);
  const presentedCommitsRef = useRef(0);

  const pointer = useMemo<GamePointerInstrumentation>(
    () => ({
      // UI runtime (worklet): the manual gesture handlers call these.
      onRawTouch: () => {
        'worklet';
        rawTouches.value += 1;
      },
      onForwarded: () => {
        'worklet';
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
      // UI runtime (worklet): the alpha clock observed a new revision.
      onUiRevisionObserved: () => {
        'worklet';
        uiObserved.value += 1;
      },
    }),
    [],
  );

  const readCounters = useCallback(
    (): CameraLabCounters => ({
      rawTouches: rawTouches.value,
      forwarded: forwarded.value,
      accepted: acceptedRef.current,
      rejectedLayoutEpoch: rejectedLayoutEpochRef.current,
      rejectedBinding: rejectedBindingRef.current,
      presentedCommits: presentedCommitsRef.current,
      uiObserved: uiObserved.value,
    }),
    [forwarded, rawTouches, uiObserved],
  );

  return { pointer, view, readCounters };
}
