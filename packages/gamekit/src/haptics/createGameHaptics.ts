import { createHapticsInstallationError, GameHapticsError } from './errors';
import { loadPulsar } from './resolver';
import type { CreateGameHapticsOptions, GameHaptics, HapticPreset, HapticsResult } from './types';
import type { GameLifecycleSource } from '../core/session/types';

const PRESETS: readonly HapticPreset[] = [
  'impact',
  'selection',
  'success',
  'warning',
  'error',
  'light',
  'medium',
  'heavy',
] as const;

function isValidPreset(preset: HapticPreset): boolean {
  return (PRESETS as readonly string[]).includes(preset);
}

function mapToSystemPreset(preset: HapticPreset): string {
  switch (preset) {
    case 'impact':
      return 'impactMedium';
    case 'light':
      return 'impactLight';
    case 'medium':
      return 'impactMedium';
    case 'heavy':
      return 'impactHeavy';
    case 'selection':
      return 'selection';
    case 'success':
      return 'notificationSuccess';
    case 'warning':
      return 'notificationWarning';
    case 'error':
      return 'notificationError';
    default:
      return preset;
  }
}

export function createGameHaptics(options?: CreateGameHapticsOptions): GameHaptics {
  let pulsar: ReturnType<typeof loadPulsar>;
  try {
    pulsar = loadPulsar();
  } catch {
    throw createHapticsInstallationError();
  }
  if (!pulsar || !pulsar.Presets) {
    throw createHapticsInstallationError();
  }
  const { Presets } = pulsar;

  // Capability through the single public Settings adapter (GS-HAPTICS-02,
  // verified against installed Pulsar 1.7.0): HapticSupport 0 is
  // NO_SUPPORT, 1-3 are supported tiers; anything else fails closed.
  function getSupportLevel(): number | null {
    try {
      const level = pulsar.Settings?.getHapticsSupportLevel?.();
      if (typeof level === 'number' && Number.isFinite(level)) return level;
    } catch {}
    return null;
  }

  function isCapabilitySupported(_preset: HapticPreset): boolean {
    const level = getSupportLevel();
    if (level === null) return false;
    const support = pulsar.HapticSupport;
    if (support !== undefined) {
      return (
        level === support['LIMITED_SUPPORT'] ||
        level === support['STANDARD_SUPPORT'] ||
        level === support['ADVANCED_SUPPORT']
      );
    }
    return level === 1 || level === 2 || level === 3;
  }

  let muted = Boolean(options?.muted);
  let disposed = false;
  // GS-HAPTICS-01: manual and lifecycle pauses are independent gates —
  // either alone suppresses, and neither overwrites the other. Detaching
  // a lifecycle source clears only its own gate.
  let manualPaused = false;
  let lifecyclePaused = false;
  let backgrounded = false;
  // GS-HAPTICS-03: monotonic clock at the adapter seam (injectable for
  // deterministic tests; defaults to wall time). The throttle is one
  // GLOBAL 100ms budget shared by every preset: a selection pulse
  // consumes the interval for a following success effect. Only successful
  // dispatches consume budget — failures and rollbacks never suppress.
  const now = options?.now ?? Date.now;
  let lastPlayAt = Number.NEGATIVE_INFINITY;
  // T20L-R3: exactly one active lifecycle source per haptics instance. The
  // active detach is retained so replacement swaps sources, repeated detach
  // is idempotent, and disposal detaches before everything else.
  let lifecycleDetach: (() => void) | null = null;
  const MIN_INTERVAL_MS = 100;

  // AppState integration (best-effort)
  let appStateSub: { remove(): void } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native') as { AppState?: { currentState?: string; addEventListener: (t:string, cb:(s:string)=>void)=>{ remove:()=>void } } };
    const AppState = RN?.AppState;
    if (AppState?.addEventListener) {
      const isInactive = (s: string | null | undefined) => s === 'inactive' || s === 'background';
      if (isInactive(AppState.currentState)) backgrounded = true;
      appStateSub = AppState.addEventListener('change', (next: string) => {
        if (isInactive(next)) backgrounded = true;
        else if (next === 'active') backgrounded = false;
      });
    }
  } catch {}

  const haptics: GameHaptics & {
    /** Test-only backdoor for the AppState path; never part of the public type. */
    _setBackgrounded?: (b:boolean)=>void;
  } = {
    play(preset: HapticPreset): HapticsResult {
      if (disposed) return { played: false, reason: 'disposed' };
      if (manualPaused || lifecyclePaused) return { played: false, reason: 'paused' };
      if (backgrounded) return { played: false, reason: 'paused' };
      if (!isValidPreset(preset)) throw new GameHapticsError(`Unknown haptic preset "${String(preset)}"`);
      if (muted) return { played: false, reason: 'muted' };
      if (!isCapabilitySupported(preset)) return { played: false, reason: 'unsupported' };
      const systemName = mapToSystemPreset(preset);
      const fn =
        (Presets.System as Record<string, unknown>)[systemName] ??
        (Presets as Record<string, unknown>)[preset];
      if (typeof fn !== 'function') return { played: false, reason: 'unsupported' };
      const at = now();
      const elapsed = at - lastPlayAt;
      if (elapsed >= 0 && elapsed < MIN_INTERVAL_MS) return { played: false, reason: 'throttled' };
      try {
        (fn as () => void)();
        lastPlayAt = at;
        // played means request dispatched, not confirmed physical playback — system may suppress
        return { played: true };
      } catch {
        return { played: false, reason: 'error' };
      }
    },

    isSupported(_preset: HapticPreset): boolean {
      if (disposed) return false;
      if (!isValidPreset(_preset)) throw new GameHapticsError(`Unknown haptic preset "${String(_preset)}"`);
      if (!isCapabilitySupported(_preset)) return false;
      const systemName = mapToSystemPreset(_preset);
      const fn =
        (Presets.System as Record<string, unknown>)[systemName] ??
        (Presets as Record<string, unknown>)[_preset];
      return typeof fn === 'function';
    },

    setMuted(next: boolean): void {
      if (disposed) throw new GameHapticsError('GameHaptics is disposed');
      muted = Boolean(next);
    },

    isMuted(): boolean {
      if (disposed) throw new GameHapticsError('GameHaptics is disposed');
      return muted;
    },

    setPaused(next: boolean): void {
      if (disposed) throw new GameHapticsError('GameHaptics is disposed');
      manualPaused = Boolean(next);
    },

    bindLifecycle(source: GameLifecycleSource): () => void {
      if (disposed) throw new GameHapticsError('GameHaptics is disposed');
      // One active source: a replacement detaches the previous one first.
      lifecycleDetach?.();
      lifecycleDetach = null;
      // Apply the current status immediately, then follow transitions.
      // AppState backgrounding stays independent (separate flag).
      lifecyclePaused = source.getStatus() !== 'running';
      // GameLifecycleSource.subscribe returns a bare detach function (T20.3).
      const sourceDetach = source.subscribe((status) => {
        lifecyclePaused = status !== 'running';
      });
      let detached = false;
      const detach = (): void => {
        if (detached) return;
        detached = true;
        sourceDetach();
        // GS-HAPTICS-01: detach removes this source's ownership — its last
        // status must not linger as a permanent gate. Manual pause is
        // untouched.
        lifecyclePaused = false;
        if (lifecycleDetach === detach) lifecycleDetach = null;
      };
      lifecycleDetach = detach;
      return detach;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // T20L-R3: detach the active lifecycle source BEFORE removing the
      // AppState listener so the session retains no closure.
      lifecycleDetach?.();
      lifecycleDetach = null;
      if (appStateSub) { try { appStateSub.remove(); } catch {} appStateSub=null; }
    },
  };

  (haptics as unknown as { _setBackgrounded: (b:boolean)=>void })._setBackgrounded = (b:boolean)=>{ backgrounded = b; };

  return haptics;
}
