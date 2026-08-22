import { useEffect, useMemo, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { ParticleFrameSnapshotLike, ParticleSystem } from '../../particles/types';

/**
 * One UI-runtime frame of sampled particle data (T15-RF1).
 *
 * Every publish creates FRESH plain arrays — reused typed-array identities
 * are never republished, so the Worklets serialization cache cannot serve a
 * stale first-frame clone. The revision rides inside the same object so a
 * worklet reading bulk data also observes the revision.
 */
export interface ParticleFrameSnapshot {
  readonly revision: number;
  readonly effects: Readonly<
    Record<
      string,
      {
        readonly x: number[];
        readonly y: number[];
        readonly rotation: number[];
        readonly scale: number[];
        readonly opacity: number[];
        readonly visible: number[];
        readonly capacity: number;
      }
    >
  >;
}

export type SessionStatus = 'idle' | 'running' | 'paused' | 'disposed';

const EMPTY: ParticleFrameSnapshot = Object.freeze({ revision: -1, effects: Object.freeze({}) });

function defaultSchedule(tick: () => void): () => void {
  const id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

/**
 * Own THE exclusive presentation clock for one system (T15-F1/T15-RF3).
 *
 * - Acquires the binding's driver lease; mounting the hook twice for one
 *   system fails deterministically instead of double-advancing.
 * - Two independent pause sources: the session status reader and an optional
 *   manual pause (labs/UI). A running session can never cancel a manual
 *   pause.
 * - The scheduler fully stops while no slots are active and is woken by the
 *   next accepted emission through the driver's wake listener.
 * - Each changed revision is published as FRESH plain arrays through one
 *   shared value (T15-RF1).
 */
export function useParticlePresentation(
  system: ParticleSystem,
  options?: {
    /** Read the owning session's current status each frame. */
    readonly sessionStatus?: () => SessionStatus;
    /** Independent user/lab pause; true freezes age even while session runs. */
    readonly manualPaused?: () => boolean;
    /** Injectable scheduler for deterministic headless/mounted tests. */
    readonly schedule?: (tick: () => void) => () => void;
    /** Injectable clock for deterministic deltas in tests. */
    readonly now?: () => number;
  },
): {
  readonly snapshot: SharedValue<ParticleFrameSnapshot>;
} {
  const binding = useMemo(() => system.bindPresentation(), [system]);
  const snapshot = useSharedValue<ParticleFrameSnapshot>(EMPTY);

  // Refs so the loop reads latest sources without resubscribing.
  const sessionRef = useRef(options?.sessionStatus);
  sessionRef.current = options?.sessionStatus;
  const manualRef = useRef(options?.manualPaused);
  manualRef.current = options?.manualPaused;
  const scheduleRef = useRef(options?.schedule ?? defaultSchedule);
  const nowRef = useRef(options?.now ?? (() => Date.now()));

  useEffect(() => {
    // Exclusive ownership: a second hook on this system throws here.
    const driver = binding.acquireDriver();
    let cancelled = false;
    let cancelSchedule: (() => void) | null = null;
    let last = nowRef.current();
    let lastRevision = binding.revision;

    const publish = (): void => {
      if (binding.revision === lastRevision) return;
      lastRevision = binding.revision;
      const effects: { [name: string]: ParticleFrameSnapshotLike['effects'][string] } = {};
      for (const name of binding.effects) {
        const b = binding.slots(name);
        // Fresh arrays per publish (T15-RF1): never reuse identities that a
        // Worklets serializer may have cached after the first transfer.
        effects[name] = {
          x: Array.from(b.x),
          y: Array.from(b.y),
          rotation: Array.from(b.rotation),
          scale: Array.from(b.scale),
          opacity: Array.from(b.opacity),
          visible: Array.from(b.visible),
          capacity: b.capacity,
        };
      }
      snapshot.value = { revision: binding.revision, effects };
    };

    const stepFrame = (): void => {
      if (cancelled) return;
      const now = nowRef.current();
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
      last = now;

      // Independent pause sources: session AND manual.
      const session = sessionRef.current?.() ?? 'running';
      const manual = manualRef.current?.() ?? false;
      if (system.status !== 'disposed') {
        if (session === 'paused' || session === 'disposed' || manual) {
          system.pauseIfRunning();
        } else {
          system.resumeIfPaused();
        }
      }

      driver.step(dt);
      publish();

      if (driver.isIdle()) {
        // Fully stop scheduling; the wake listener restarts us on emission.
        if (cancelSchedule) {
          cancelSchedule();
          cancelSchedule = null;
        }
        return;
      }
      cancelSchedule = scheduleRef.current(stepFrame);
    };

    driver.setWakeListener(() => {
      if (cancelled || cancelSchedule !== null) return;
      last = nowRef.current();
      cancelSchedule = scheduleRef.current(stepFrame);
    });

    // Initial sync + first frame.
    if (sessionRef.current) applyStatus(system, sessionRef.current());
    stepFrame();

    return () => {
      cancelled = true;
      driver.setWakeListener(null);
      if (cancelSchedule) cancelSchedule();
      driver.release();
    };
  }, [system, binding, snapshot]);

  return { snapshot };
}

function applyStatus(system: ParticleSystem, session: SessionStatus): void {
  if (system.status === 'disposed') return;
  if (session === 'running' || session === 'idle') {
    system.resumeIfPaused();
  } else {
    system.pauseIfRunning();
  }
}
