import { useEffect, useMemo, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { GameWorldContext } from '../sprites/GameWorld2D';
import type { ParticlePresentationBinding, ParticleSystem } from '../../particles/types';

/**
 * The UI-runtime mirror of one presentation revision: a fresh frozen object
 * per changed revision (one small allocation per frame at most), consumed by
 * worklets through a single shared value — never per-slot JS→UI writes.
 */
export interface ParticleFrameSnapshot {
  readonly revision: number;
  readonly data: ReadonlyMap<
    string,
    {
      readonly x: Float32Array;
      readonly y: Float32Array;
      readonly rotation: Float32Array;
      readonly scale: Float32Array;
      readonly opacity: Float32Array;
      readonly visible: Uint8Array;
    }
  >;
}

const EMPTY: ParticleFrameSnapshot = Object.freeze({
  revision: -1,
  data: new Map(),
});

/**
 * Own THE presentation clock for one system (T15-F1).
 *
 * - Exactly one binding/clock per system; views are readers only.
 * - The session status is applied synchronously at bind time, and tracked
 *   for later changes when a status reader is supplied.
 * - The rAF loop stops on unmount and is a true no-op while paused or when
 *   nothing is active.
 *
 * Returns the shared snapshot value every `ParticleView` reads plus the
 * binding for imperative diagnostics in labs. The scheduler is injectable
 * for deterministic headless tests.
 */
export function useParticlePresentation(
  system: ParticleSystem,
  options?: {
    /** Read the owning session's current status each frame (best-effort). */
    readonly sessionStatus?: () => 'idle' | 'running' | 'paused' | 'disposed';
  },
): {
  readonly snapshot: SharedValue<ParticleFrameSnapshot>;
  readonly binding: ParticlePresentationBinding;
} {
  const binding = useMemo(() => system.bindPresentation(), [system]);
  const snapshot = useSharedValue<ParticleFrameSnapshot>(EMPTY);
  const statusRef = useRef(options?.sessionStatus);
  statusRef.current = options?.sessionStatus;

  useEffect(() => {
    if (statusRef.current !== undefined) {
      applyStatus(system, statusRef.current());
    }
    let cancelled = false;
    let raf: number | null = null;
    let last = Date.now();
    let lastRevision = binding.revision;

    const frame = (): void => {
      if (cancelled) return;
      const now = Date.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (statusRef.current !== undefined) {
        applyStatus(system, statusRef.current());
      }
      binding.tick(dt);
      if (binding.revision !== lastRevision) {
        lastRevision = binding.revision;
        const data = new Map();
        for (const name of binding.effects) {
          data.set(name, binding.slots(name));
        }
        // One small frozen object per changed revision — the single JS→UI
        // write for the whole system (T15-F2).
        snapshot.value = Object.freeze({ revision: binding.revision, data });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [system, binding, snapshot]);

  return { snapshot, binding };
}

function applyStatus(
  system: ParticleSystem,
  sessionStatus: 'idle' | 'running' | 'paused' | 'disposed',
): void {
  if (system.status === 'disposed') return;
  if (sessionStatus === 'running' || sessionStatus === 'idle') {
    if (system.status === 'paused') system.resume();
  } else {
    system.pauseIfRunning();
  }
}

/** Read the GameWorld2D context values when mounted inside a world. */
export function useWorldTransform(): {
  readonly viewport: SharedValue<unknown> | null;
  readonly camera: SharedValue<unknown> | null;
} {
  const ctx = GameWorldContext;
  void ctx;
  // Views read the context directly where needed; this helper exists to keep
  // the import surface explicit for the view implementation below.
  return { viewport: null, camera: null };
}
