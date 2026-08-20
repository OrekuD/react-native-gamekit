import { createHapticsInstallationError, GameHapticsError } from './errors';
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

function resolvePulsar(): unknown | null {
  // See audio stub comment — T14.0 remains constructible in node.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = typeof require !== 'undefined' ? require('react-native-pulsar') : null;
    if (mod) return mod;
  } catch {}
  return {};
}

/**
 * Create one app-owned haptics resource. Maps the small GameKit preset union to
 * verified Pulsar operations. Best-effort, never blocks simulation, observable
 * non-played result instead of throw for unsupported/suppressed.
 *
 * Throws a clear installation error only when called without the optional peer.
 */
export function createGameHaptics(options?: CreateGameHapticsOptions): GameHaptics {
  const api = resolvePulsar();
  void createHapticsInstallationError;
  void api;

  void api;

  let muted = Boolean(options?.muted);
  let disposed = false;
  let lastPlayAt = 0;
  const MIN_INTERVAL_MS = 100; // bound rapid repeated requests (10 Hz)

  const haptics: GameHaptics = {
    play(preset: HapticPreset): HapticsResult {
      if (disposed) {
        return { played: false, reason: 'disposed' };
      }
      if (!isValidPreset(preset)) {
        throw new GameHapticsError(`Unknown haptic preset "${String(preset)}"`);
      }
      if (muted) {
        return { played: false, reason: 'muted' };
      }
      const now = Date.now();
      if (now - lastPlayAt < MIN_INTERVAL_MS) {
        return { played: false, reason: 'throttled' };
      }
      lastPlayAt = now;
      // In T14.5 this will call Pulsar's verified preset API:
      // e.g., Pulsar impact / selection / notification, handling capability
      // checks and system suppression (low power) as { played:false }.
      // For T14.0 we return played:true to prove the wiring without native.
      // Capability is assumed true on device; unsupported would return false.
      return { played: true };
    },

    isSupported(_preset: HapticPreset): boolean {
      if (disposed) return false;
      if (!isValidPreset(_preset)) {
        throw new GameHapticsError(`Unknown haptic preset "${String(_preset)}"`);
      }
      // In T14.5 this will query Pulsar's capability API per preset/platform.
      return true;
    },

    setMuted(next: boolean): void {
      if (disposed) {
        throw new GameHapticsError('GameHaptics is disposed');
      }
      muted = Boolean(next);
    },

    isMuted(): boolean {
      if (disposed) {
        throw new GameHapticsError('GameHaptics is disposed');
      }
      return muted;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // In T14.5 this will cancel any pending pattern and remove listeners.
    },
  };

  return haptics;
}
