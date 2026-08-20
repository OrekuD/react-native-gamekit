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
  try {
    // Use require so the optional peer can be resolved synchronously and so
    // tests can inject a backend via mock.module (which intercepts ESM import
    // but not this require). In production the peer is installed and this
    // succeeds; when missing it returns null and the factory throws the
    // actionable installation error. Tests that need a missing-peer path
    // should mock the resolver (see test/audioHaptics.test.tsx) rather than
    // relying on a fallback object.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-pulsar');
    return (mod as unknown) ?? null;
  } catch {
    return null;
  }
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
  if (!api) {
    throw createHapticsInstallationError();
  }

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
      // T14.5 will call the verified Pulsar preset (e.g. Presets.System.impactMedium)
      // and handle capability/suppression. Until then, fail closed with an
      // explicit unavailable result rather than reporting a successful no-op.
      return { played: false, reason: 'error' };
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
