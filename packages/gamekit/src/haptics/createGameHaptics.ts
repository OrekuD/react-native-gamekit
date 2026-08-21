import { createHapticsInstallationError, GameHapticsError } from './errors';
import { loadPulsar } from './resolver';
import type { CreateGameHapticsOptions, GameHaptics, HapticPreset, HapticsResult } from './types';

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

  // Capability: query Pulsar's HapticSupport when available
  function getSupportLevel(): number {
    try {
      const pAny = pulsar as unknown as { getHapticSupport?: ()=>number; Pulsar_hapticSupport?: ()=>number; HapticSupport?: Record<string, number> };
      if (typeof pAny.getHapticSupport === 'function') return pAny.getHapticSupport();
      if (typeof pAny.Pulsar_hapticSupport === 'function') return pAny.Pulsar_hapticSupport();
      // Try TurboModule directly
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const RN = require('react-native') as { TurboModuleRegistry?: { getEnforcing: (n:string)=>{ Pulsar_hapticSupport?: ()=>number } } };
        const spec = RN.TurboModuleRegistry?.getEnforcing?.('RNPulsar') as { Pulsar_hapticSupport?: ()=>number } | undefined;
        if (spec?.Pulsar_hapticSupport) return spec.Pulsar_hapticSupport();
      } catch {}
    } catch {}
    // Fallback: if Presets exists, assume STANDARD (2) — tests with mock will hit this
    return 2;
  }

  function isCapabilitySupported(_preset: HapticPreset): boolean {
    const level = getSupportLevel();
    if (level === 0) return false; // NO_SUPPORT
    // For v1, all presets require at least LIMITED (1); advanced presets would need 3 but we treat LIMITED as sufficient for System presets
    // If limited, still allow System presets (they are the base set)
    return true;
  }

  let muted = Boolean(options?.muted);
  let disposed = false;
  let paused = false;
  let backgrounded = false;
  let lastPlayAt = 0;
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
    _setPaused?: (p:boolean)=>void;
    _setBackgrounded?: (b:boolean)=>void;
  } = {
    play(preset: HapticPreset): HapticsResult {
      if (disposed) return { played: false, reason: 'disposed' };
      if (paused) return { played: false, reason: 'paused' };
      if (backgrounded) return { played: false, reason: 'paused' };
      if (!isValidPreset(preset)) throw new GameHapticsError(`Unknown haptic preset "${String(preset)}"`);
      if (muted) return { played: false, reason: 'muted' };
      if (!isCapabilitySupported(preset)) return { played: false, reason: 'unsupported' };
      const systemName = mapToSystemPreset(preset);
      const fn =
        (Presets.System as Record<string, unknown>)[systemName] ??
        (Presets as Record<string, unknown>)[preset];
      if (typeof fn !== 'function') return { played: false, reason: 'unsupported' };
      const now = Date.now();
      if (now - lastPlayAt < MIN_INTERVAL_MS) return { played: false, reason: 'throttled' };
      lastPlayAt = now;
      try {
        (fn as () => void)();
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

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (appStateSub) { try { appStateSub.remove(); } catch {} appStateSub=null; }
    },
  };

  (haptics as unknown as { _setPaused: (p:boolean)=>void })._setPaused = (p:boolean)=>{ paused = p; };
  (haptics as unknown as { _setBackgrounded: (b:boolean)=>void })._setBackgrounded = (b:boolean)=>{ backgrounded = b; };

  return haptics;
}
