import { createAudioInstallationError, GameAudioError } from './errors';
import type {
  AudioCategory,
  AudioSoundRecord,
  CreateGameAudioOptions,
  GameAudio,
  GameAudioPlayOptions,
} from './types';

const CATEGORIES: readonly AudioCategory[] = ['master', 'music', 'sfx', 'ui'] as const;

function isValidVolume(volume: number): boolean {
  return Number.isFinite(volume) && volume >= 0 && volume <= 1;
}

function assertCategory(category: AudioCategory): void {
  if (!CATEGORIES.includes(category)) {
    throw new GameAudioError(`Unknown audio category "${String(category)}"`);
  }
}

function assertVolume(volume: number): void {
  if (!isValidVolume(volume)) {
    throw new GameAudioError(`Volume must be a finite number in [0, 1], got ${String(volume)}`);
  }
}

async function resolveAudioApi(): Promise<unknown | null> {
  try {
    // Use dynamic import so tests can inject a backend via mock.module
    // (require is not interceptable in ESM). In production this resolves
    // to the installed optional peer; when missing it throws and we
    // surface the actionable installation error.
    const mod = await import('react-native-audio-api');
    return (mod as unknown) ?? null;
  } catch {
    return null;
  }
}

/**
 * Create one app-owned audio resource. One `AudioContext` per resource, decoded buffers
 * cached per sound ID, fresh source node per playback (single-use), suspend when idle,
 * close only on dispose. Native imports are isolated to this factory.
 *
 * Throws a clear installation error only when called without the optional peer.
 */
export async function createGameAudio<T extends AudioSoundRecord>(
  options: CreateGameAudioOptions<T>,
): Promise<GameAudio<T>> {
  const api = await resolveAudioApi();
  if (!api) {
    throw createAudioInstallationError();
  }

  if (!options || typeof options.sounds !== 'object' || options.sounds === null) {
    throw new GameAudioError('createGameAudio requires { sounds: Record<string, number> }');
  }

  const soundIds = Object.keys(options.sounds);
  if (soundIds.length === 0) {
    throw new GameAudioError('createGameAudio sounds must not be empty');
  }
  for (const id of soundIds) {
    const v = (options.sounds as Record<string, unknown>)[id];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new GameAudioError(`Sound "${id}" must be a finite asset ID (require result)`);
    }
  }

  // Internal state kept private — never exposed as graph objects.
  const volumes: Record<AudioCategory, number> = {
    master: 1,
    music: 1,
    sfx: 1,
    ui: 1,
  };
  let muted = false;
  let disposed = false;
  let paused = false;
  // For v1, music is a single owned channel.
  let currentMusicId: (keyof T & string) | null = null;

  const ensureNotDisposed = (): void => {
    if (disposed) {
      throw new GameAudioError('GameAudio is disposed');
    }
  };

  // Stub: in T14.1 we will decode and cache buffers once per resource via expo-asset.
  // For T14.0 we keep the resource constructible without decoding, so the API freeze
  // and compile fixtures can be validated in node without native.
  void api;
  void soundIds;

  const audio: GameAudio<T> = {
    play<K extends keyof T & string>(_id: K, _opts?: GameAudioPlayOptions): void {
      ensureNotDisposed();
      if (paused) return;
      if (muted) return;
      if (_opts?.category !== undefined) {
        assertCategory(_opts.category);
      }
      if (_opts?.volume !== undefined) {
        assertVolume(_opts.volume);
      }
      // T14.1 will decode and cache buffers; T14.2/3 will create a fresh
      // AudioBufferSourceNode per call. Until then, fail closed rather than
      // silently reporting success for a no-op resource.
      throw new GameAudioError('Audio playback not yet implemented (T14.1 pending)');
    },

    async playMusic<K extends keyof T & string>(id: K): Promise<void> {
      ensureNotDisposed();
      if (muted) {
        currentMusicId = id;
        return;
      }
      // See play() — until T14.3 the music channel is not yet wired to a
      // native AudioBufferSourceNode. Fail closed instead of silently
      // accepting the request.
      void id;
      throw new GameAudioError('Music playback not yet implemented (T14.3 pending)');
    },

    stopMusic(): void {
      ensureNotDisposed();
      currentMusicId = null;
    },

    pause(): void {
      ensureNotDisposed();
      paused = true;
      // In T14.4 this will AudioContext.suspend() and pause music with offset.
    },

    resume(): void {
      ensureNotDisposed();
      paused = false;
      // In T14.4 this will resume only if session/app/focus/user-intent all agree.
    },

    setVolume(category: AudioCategory, volume: number): void {
      ensureNotDisposed();
      assertCategory(category);
      assertVolume(volume);
      volumes[category] = volume;
      // In T14.2 this will ramp gains via the verified native API to avoid clicks.
    },

    getVolume(category: AudioCategory): number {
      ensureNotDisposed();
      assertCategory(category);
      return volumes[category];
    },

    setMuted(next: boolean): void {
      ensureNotDisposed();
      muted = Boolean(next);
    },

    isMuted(): boolean {
      ensureNotDisposed();
      return muted;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      currentMusicId = null;
      // In T14.2 this will close the AudioContext exactly once, clear voice registry,
      // and remove AppState/interruption listeners.
    },
  };

  // Make diagnostics observable without exposing native handles.
  void currentMusicId;

  return audio;
}
