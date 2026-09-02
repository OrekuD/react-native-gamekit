import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type {
  GameLifecycleSource,
  GameSessionStatus,
} from '../../core/session/types';
import type {
  ParticleSystem,
  ParticleUiRegistry,
} from '../../particles/types';

export type SessionStatus = GameSessionStatus;

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
 *
 * Pause sources are applied through ONE effect-owned control so transitions
 * stop/start the scheduler immediately — including while the driver is idle
 * or asleep (T15-SF3). Scheduling runs only when the system is running AND
 * at least one particle is active; it fully stops otherwise and restarts
 * from resume/wake transitions.
 */
export function useParticlePresentation(
  system: ParticleSystem,
  options?: {
    /**
     * The owning session's lifecycle source (T20.3) — the preferred way to
     * follow a session. Supplied by `GameView` through
     * `useGameLifecycleSource()`. When set, it takes precedence over the
     * legacy `sessionStatus`/`sessionSubscribe` options.
     */
    readonly lifecycle?: GameLifecycleSource;
    /** Legacy reader: read the owning session's status each frame / on change. */
    readonly sessionStatus?: () => SessionStatus;
    /** Legacy reactive subscription for session status changes. */
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
  // T20F-R2: the driver effect must key ONLY on ownership inputs. Shared
  // values are stable in Reanimated; the refs keep the effect closures
  // pointing at the latest instance even where mocks hand back fresh objects.
  const clockRef = useRef(clock);
  const registryRef = useRef(registry);
  useEffect(() => {
    clockRef.current = clock;
    registryRef.current = registry;
  }, [clock, registry]);

  // Latest-source refs (frame loop + reactive callbacks read these).
  const lifecycleRef = useRef(options?.lifecycle);
  lifecycleRef.current = options?.lifecycle;
  const sessionRef = useRef(options?.sessionStatus);
  sessionRef.current = options?.sessionStatus;
  const manualReaderRef = useRef(options?.manualPaused);
  manualReaderRef.current = options?.manualPaused;
  const scheduleRef = useRef(options?.schedule ?? defaultSchedule);
  const nowRef = useRef(options?.now ?? (() => Date.now()));
  // Manual pause lives OUTSIDE render so the imperative setter is stable and
  // reactive without depending on animation frames.
  const manualPausedRef = useRef(false);

  // Stable control ref owned by the effect (T15-TF2): the public setter and
  // every pause transition route through this without capturing stale state.
  const controlRef = useRef<{
    applyPause(): void;
    syncRegistry(): void;
    updateScheduling(): void;
  }>({ applyPause: () => {}, syncRegistry: () => {}, updateScheduling: () => {} });

  // T20F-R2: STABLE across re-renders — it reads only refs plus `system`, so
  // the driver effect below keeps a single acquire/subscription for the
  // lifetime of one system instead of rebinding on every parent render.
  const applyCombinedPause = useCallback((): void => {
    if (system.status === 'disposed') return;
    const session = lifecycleRef.current
      ? lifecycleRef.current.getStatus()
      : (sessionRef.current?.() ?? 'running');
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
      if (binding.registryRevision !== registryRef.current.value.registryRevision) {
        // Bounded transfer: only on membership changes (T15-SF1). Expiration
        // bumps the revision too, so the terminal prune ships (T15-TF1).
        registryRef.current.value = binding.buildUiRegistry();
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

      // ALWAYS publish the terminal scalar — including the step that
      // transitions to zero actives, so renderers hide the expired record
      // before we sleep (T15-TF1).
      clockRef.current.value = binding.activeClock;

      // T20L-R2: the frame path enforces the same running guard as the
      // reactive path — a paused step cannot expire particles, so scheduling
      // another frame while paused would spin the driver forever.
      if (system.status === 'running' && !driver.isIdle()) {
        startScheduling();
        return;
      }
      // Paused or idle: fully stop; resume transitions and emissions restart us.
      stopScheduling();
    };

    // Effect-owned scheduling control (T15-TF2): pause transitions call this
    // synchronously via the stable ref.
    controlRef.current = {
      applyPause: applyCombinedPause,
      syncRegistry,
      updateScheduling(): void {
        applyCombinedPause();
        syncRegistry();
        if (cancelled || system.status === 'disposed') {
          stopScheduling();
          return;
        }
        // Schedule only when running AND something is active.
        if (system.status === 'running' && !driver.isIdle()) {
          startScheduling();
        } else {
          stopScheduling();
        }
      },
    };

    // Reactive pause application + registry sync + reschedule.
    driver.setWakeListener(() => controlRef.current.updateScheduling());

    // Initial synchronous application at bind time.
    applyCombinedPause();

    stepFrame();

    return () => {
      cancelled = true;
      driver.setWakeListener(null);
      stopScheduling();
      driver.release();
    };
  }, [system, binding, applyCombinedPause]);

  // T20F-R2: the lifecycle subscription is keyed by the SOURCE identity, not
  // by render — one subscribe/detach per system generation. Status changes
  // route through the effect-owned control so pause transitions stay
  // synchronous without rebinding the driver.
  const lifecycleSource = options?.lifecycle ?? null;
  const legacySubscribe = options?.sessionSubscribe ?? null;
  useEffect(() => {
    const onSessionStatus = (status: SessionStatus): void => {
      sessionRef.current = () => status;
      controlRef.current.updateScheduling();
    };
    const detach =
      lifecycleSource !== null
        ? lifecycleSource.subscribe(onSessionStatus)
        : legacySubscribe?.(onSessionStatus);
    // T20F-R2 re-review: a REPLACED source may already be paused (or running)
    // — apply its current status immediately instead of waiting for its next
    // transition, so paused emissions are never accepted in between.
    controlRef.current.updateScheduling();
    return detach;
  }, [lifecycleSource, legacySubscribe]);

  // Initial registry transfer at bind time.
  useEffect(() => {
    registryRef.current.value = binding.buildUiRegistry();
  }, [binding]);

  const setManualPaused = useCallback(
    (paused: boolean): void => {
      manualPausedRef.current = paused;
      // Route through the effect-owned control: applies combined sources AND
      // stops/starts the scheduler immediately (T15-TF2).
      controlRef.current.updateScheduling();
    },
    [],
  );

  return { clock, registry, setManualPaused };
}
