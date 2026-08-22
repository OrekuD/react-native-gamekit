import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type {
  ParticleSystem,
  ParticleUiRegistry,
} from '../../particles/types';

export type SessionStatus = 'idle' | 'running' | 'paused' | 'disposed';

/**
 * What the presentation hook hands to views (T15-SF1): a SCALAR active-time
 * clock written every running frame, plus the bounded emission registry
 * transferred only when membership changes. No per-frame bulk arrays cross
 * the runtime boundary.
 */
export interface ParticlePresentation {
  readonly clock: SharedValue<number>;
  readonly registry: SharedValue<ParticleUiRegistry>;
  /** Imperative manual-pause control, independent of the session source. */
  setManualPaused(paused: boolean): void;
}

const EMPTY_REGISTRY: ParticleUiRegistry = Object.freeze({
  registryRevision: -1,
  activeClock: 0,
  effects: Object.freeze({}),
});

function defaultSchedule(tick: () => void): () => void {
  const id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

/**
 * Own THE exclusive presentation clock for one system (T15-F1/T15-RF3).
 *
 * Per-frame runtime work is ONE scalar write (`clock.value`); the bounded
 * emission registry is transferred only when membership changes (T15-SF1).
 * Pause sources are applied REACTIVELY — synchronously at bind, on session
 * transitions via the optional subscribe seam, and on manual-pause changes —
 * so an emission accepted after a pause transition follows the paused-drop
 * policy even while the driver was asleep (T15-SF3). Scheduling fully stops
 * while paused or idle and restarts only from resume/wake transitions.
 */
export function useParticlePresentation(
  system: ParticleSystem,
  options?: {
    /** Read the owning session's current status each frame / on change. */
    readonly sessionStatus?: () => SessionStatus;
    /** Subscribe to session status changes for reactive pause application. */
    readonly sessionSubscribe?: (
      listener: (status: SessionStatus) => void,
    ) => () => void;
    /** Independent user/lab pause reader; a running session cannot cancel it. */
    readonly manualPaused?: () => boolean;
    /** Injectable scheduler for deterministic headless/mounted tests. */
    readonly schedule?: (tick: () => void) => () => void;
    /** Injectable clock for deterministic deltas in tests. */
    readonly now?: () => number;
  },
): ParticlePresentation {
  const binding = useMemo(() => system.bindPresentation(), [system]);
  const clock = useSharedValue(binding.activeClock);
  const registry = useSharedValue<ParticleUiRegistry>(EMPTY_REGISTRY);

  // Latest-source refs (frame loop + reactive callbacks read these).
  const sessionRef = useRef(options?.sessionStatus);
  sessionRef.current = options?.sessionStatus;
  const scheduleRef = useRef(options?.schedule ?? defaultSchedule);
  const nowRef = useRef(options?.now ?? (() => Date.now()));

  // Manual pause lives OUTSIDE render so the imperative setter is stable and
  // reactive without depending on animation frames (T15-SF3).
  const manualPausedRef = useRef(false);

  const manualReaderRef = useRef(options?.manualPaused);
  manualReaderRef.current = options?.manualPaused;

  const applyCombinedPause = useCallback((): void => {
    if (system.status === 'disposed') return;
    const session = sessionRef.current?.() ?? 'running';
    const effectivePaused =
      manualPausedRef.current ||
      (manualReaderRef.current?.() ?? false) ||
      session === 'paused' ||
      session === 'disposed';
    if (effectivePaused) system.pauseIfRunning();
    else system.resumeIfPaused();
  }, [system]);

  useEffect(() => {
    const driver = binding.acquireDriver();
    let cancelled = false;
    let cancelSchedule: (() => void) | null = null;
    let last = nowRef.current();

    const stopScheduling = (): void => {
      if (cancelSchedule) {
        cancelSchedule();
        cancelSchedule = null;
      }
    };

    const startScheduling = (): void => {
      if (cancelled || cancelSchedule !== null) return;
      last = nowRef.current();
      let canceller: (() => void) | null = null;
      // The executed tick clears its own handle so the next frame may be
      // scheduled from inside stepFrame (self-perpetuating loop).
      canceller = scheduleRef.current(() => {
        if (cancelSchedule === canceller) cancelSchedule = null;
        stepFrame();
      });
      cancelSchedule = canceller ?? null;
    };

    const syncRegistry = (): void => {
      if (binding.registryRevision !== registry.value.registryRevision) {
        // Bounded transfer: only on membership changes (T15-SF1).
        registry.value = binding.buildUiRegistry();
      }
    };

    const stepFrame = (): void => {
      if (cancelled) return;
      const now = nowRef.current();
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
      last = now;

      applyCombinedPause();
      driver.step(dt);
      syncRegistry();

      // Scalar clock write: the only per-frame boundary traffic (T15-SF1).
      if (!driver.isIdle()) {
        clock.value = binding.activeClock;
        startScheduling();
        return;
      }
      // Idle: fully stop; emissions wake us again.
      stopScheduling();
    };

    // Reactive pause application + registry sync (T15-SF3): runs even while
    // the scheduler is asleep, then stops/restarts scheduling to match.
    const onSourcesChanged = (): void => {
      applyCombinedPause();
      syncRegistry();
      if (cancelled || system.status === 'disposed') return;
      if (!driver.isIdle()) startScheduling();
      else stopScheduling();
    };

    driver.setWakeListener(onSourcesChanged);

    // Initial synchronous application at bind time.
    applyCombinedPause();

    const unsubscribeSession =
      options?.sessionSubscribe !== undefined
        ? options.sessionSubscribe((status) => {
            sessionRef.current = () => status;
            onSourcesChanged();
          })
        : undefined;

    stepFrame();

    return () => {
      cancelled = true;
      driver.setWakeListener(null);
      unsubscribeSession?.();
      stopScheduling();
      driver.release();
    };
  }, [system, binding, clock, applyCombinedPause]);

  // Initial registry transfer at bind time.
  useEffect(() => {
    registry.value = binding.buildUiRegistry();
  }, [binding, registry]);

  const setManualPaused = useCallback(
    (paused: boolean): void => {
      manualPausedRef.current = paused;
      // Reactive: apply immediately, not on the next animation frame.
      applyCombinedPause();
      if (system.status !== 'disposed' && system.status === 'running') {
        // Resume may need scheduling restarted; emit/wake also covers this,
        // but an explicit nudge keeps resume latency at one frame.
        if (binding.activeCount > 0) {
          clock.value = binding.activeClock;
        }
      }
    },
    [applyCombinedPause, binding, clock, system],
  );

  return { clock, registry, setManualPaused };
}
