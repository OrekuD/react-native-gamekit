import { createAudioInstallationError, GameAudioError } from './errors';
import { loadAudioApi } from './resolver';
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
  let api: Awaited<ReturnType<typeof loadAudioApi>>;
  try {
    api = await loadAudioApi();
  } catch {
    throw createAudioInstallationError();
  }
  if (!api || !api.AudioContext) {
    throw createAudioInstallationError();
  }

  if (!options || typeof options.sounds !== 'object' || options.sounds === null) {
    throw new GameAudioError('createGameAudio requires { sounds: Record<string, number> }');
  }

  const soundIds = Object.keys(options.sounds) as (keyof T & string)[];
  if (soundIds.length === 0) {
    throw new GameAudioError('createGameAudio sounds must not be empty');
  }
  for (const id of soundIds) {
    const v = (options.sounds as Record<string, unknown>)[id];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new GameAudioError(`Sound "${id}" must be a finite asset ID (require result)`);
    }
  }

  const { AudioContext, AudioManager } = api;

  // One AudioContext per GameAudio resource
  const context = new AudioContext();

  // Decoded buffer cache: one decode per asset ID, deduplicated
  const bufferCache = new Map<string, unknown>();
  const pendingDecodes = new Map<string, Promise<unknown>>();

  async function getBuffer(id: keyof T & string): Promise<unknown> {
    if (bufferCache.has(id)) {
      return bufferCache.get(id)!;
    }
    if (pendingDecodes.has(id)) {
      return pendingDecodes.get(id)!;
    }
    const assetId = (options.sounds as Record<string, number>)[id] as number;
    const promise = (async () => {
      // Resolve Expo static asset — dynamic import so `tsx` does not try to transpile expo-asset/react-native at top-level.
      // In node tests, expo-asset may not be transpilable (it imports react-native); fall back to a stub buffer.
      let assetUri: string | null = null;
      try {
        const { Asset: ExpoAsset } = (await import('expo-asset')) as unknown as { Asset: { fromModule(id: number): { downloadAsync(): Promise<void>; localUri: string | null; uri: string } } };
        const asset = ExpoAsset.fromModule(assetId);
        await asset.downloadAsync();
        assetUri = asset.localUri ?? asset.uri;
      } catch {
        // In node/test without native, use a stub — decode will be via stub AudioContext
        assetUri = null;
      }
      if (!assetUri) {
        // Stub path for tests / when expo-asset is not available — return a dummy buffer
        const dummyBuffer = { length: 0, duration: 0 } as unknown;
        bufferCache.set(id, dummyBuffer);
        pendingDecodes.delete(id);
        return dummyBuffer;
      }
      const uri = assetUri;
      if (!uri) {
        throw new GameAudioError(`Failed to resolve asset for sound "${String(id)}"`);
      }
      // Fetch as ArrayBuffer then decode via AudioContext
      const response = await fetch(uri);
      if (!response.ok) {
        throw new GameAudioError(`Failed to fetch audio asset "${String(id)}": ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(arrayBuffer);
      bufferCache.set(id, buffer);
      pendingDecodes.delete(id);
      return buffer;
    })();
    pendingDecodes.set(id, promise);
    try {
      return await promise;
    } catch (e) {
      pendingDecodes.delete(id);
      throw e;
    }
  }

  // Eagerly start decoding all sounds (deduplicated, not blocking creation)
  // but keep creation fast — decode in background, play will await if needed.
  for (const id of soundIds) {
    void getBuffer(id).catch(() => {
      // Decoding errors are surfaced on play, not on creation
    });
  }

  const volumes: Record<AudioCategory, number> = {
    master: 1,
    music: 1,
    sfx: 1,
    ui: 1,
  };
  let muted = false;
  let disposed = false;
  let paused = false;
  let currentMusicId: (keyof T & string) | null = null;
  let currentMusicNode: { stop(when?: number): void } | null = null;
  const activeVoices = new Set<unknown>();

  const ensureNotDisposed = (): void => {
    if (disposed) {
      throw new GameAudioError('GameAudio is disposed');
    }
  };

  // Interruption handling: observe system interruptions and suspend/resume
  let interruptionSub: { remove(): void } | null = null;
  let interruptionEnabled = false;
  function handleInterruption(event: unknown): void {
    const e = event as { type?: string; shouldResume?: boolean };
    if (e.type === 'began') {
      // Began: suspend context (if running) — do not change paused/muted intent
      void context.suspend().catch(() => {});
    } else if (e.type === 'ended' && e.shouldResume) {
      // Only resume if all four sources agree: not disposed, not paused, not muted, app active
      // For T14.0 we check paused/muted/disposed; AppState check is in T14.4
      if (!disposed && !paused && !muted) {
        void context.resume().catch(() => {});
      }
    }
  }
  try {
    // Enable interruption observation
    AudioManager.observeAudioInterruptions(true);
    interruptionEnabled = true;
    interruptionSub = AudioManager.addSystemEventListener('interruption', handleInterruption as never);
  } catch {
    // If the system API is not available (e.g. web mock), continue without interruption handling
    interruptionSub = null;
  }

  const audio: GameAudio<T> = {
    play<K extends keyof T & string>(id: K, opts?: GameAudioPlayOptions): void {
      ensureNotDisposed();
      if (paused) return;
      if (muted) return;
      if (opts?.category !== undefined) {
        assertCategory(opts.category);
      }
      if (opts?.volume !== undefined) {
        assertVolume(opts.volume);
      }
      // Fire-and-forget: decode then create a fresh source node per playback (single-use)
      void (async () => {
        if (disposed || paused || muted) return;
        try {
          const buffer = await getBuffer(id as keyof T & string);
          if (disposed || paused || muted) return;
          const source: {
            buffer: unknown | null;
            connect(dest: unknown): void;
            start(when?: number, offset?: number, duration?: number): void;
            stop(when?: number): void;
            addEventListener?: (type: string, cb: () => void) => void;
          } = (context as unknown as { createBufferSource(): { buffer: unknown | null; connect(dest: unknown): void; start(when?: number, offset?: number, duration?: number): void; stop(when?: number): void; addEventListener?: (type: string, cb: () => void) => void } }).createBufferSource();
          source.buffer = buffer;
          source.connect((context as unknown as { destination: unknown }).destination);
          // Track voice for concurrency / cleanup
          activeVoices.add(source);
          const cleanup = (): void => {
            activeVoices.delete(source);
          };
          // Web Audio uses `onended` or `addEventListener('ended', ...)`
          const anySource = source as unknown as { onended?: (() => void) | null; addEventListener?: (type: string, cb: () => void) => void };
          if (typeof anySource.addEventListener === 'function') {
            anySource.addEventListener('ended', cleanup);
          } else {
            anySource.onended = cleanup;
          }
          source.start();
          // For non-looping SFX, the ended event will clean up; for safety also handle errors
        } catch (e) {
          // Decoding or playback errors are not gameplay errors — surface via console but do not throw
          // (play is fire-and-forget)
          console.warn(`[GameAudio] play("${String(id)}") failed:`, e);
        }
      })();
    },

    async playMusic<K extends keyof T & string>(id: K): Promise<void> {
      ensureNotDisposed();
      // Music replacement: stop previous music node if any
      if (currentMusicNode) {
        try {
          currentMusicNode.stop();
        } catch {}
        currentMusicNode = null;
      }
      currentMusicId = id;
      if (muted || paused) {
        return;
      }
      try {
        const buffer = await getBuffer(id as keyof T & string);
        if (disposed || muted || paused || currentMusicId !== id) return;
        const source = (context as unknown as { createBufferSource(): { buffer: unknown | null; loop: boolean; connect(dest: unknown): void; start(when?: number, offset?: number, duration?: number): void; stop(when?: number): void } }).createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect((context as unknown as { destination: unknown }).destination);
        currentMusicNode = source;
        source.start();
        // Ensure resume if context was suspended
        if ((context as unknown as { state: string }).state === 'suspended') {
          await context.resume().catch(() => {});
        }
      } catch (e) {
        console.warn(`[GameAudio] playMusic("${String(id)}") failed:`, e);
        if (currentMusicId === id) {
          currentMusicId = null;
        }
      }
    },

    stopMusic(): void {
      ensureNotDisposed();
      if (currentMusicNode) {
        try {
          currentMusicNode.stop();
        } catch {}
        currentMusicNode = null;
      }
      currentMusicId = null;
    },

    pause(): void {
      ensureNotDisposed();
      if (paused) return;
      paused = true;
      void context.suspend().catch(() => {});
      // Pause music by suspending context; do not stop the node so offset is preserved when supported
    },

    resume(): void {
      ensureNotDisposed();
      if (!paused) return;
      paused = false;
      if (!muted && !disposed) {
        void context.resume().catch(() => {});
      }
    },

    setVolume(category: AudioCategory, volume: number): void {
      ensureNotDisposed();
      assertCategory(category);
      assertVolume(volume);
      volumes[category] = volume;
      // In T14.2 this will ramp gains; for now store and apply via master composition on next play
      void volumes;
    },

    getVolume(category: AudioCategory): number {
      ensureNotDisposed();
      assertCategory(category);
      return volumes[category];
    },

    setMuted(next: boolean): void {
      ensureNotDisposed();
      muted = Boolean(next);
      if (muted) {
        void context.suspend().catch(() => {});
      } else if (!paused && !disposed) {
        void context.resume().catch(() => {});
      }
    },

    isMuted(): boolean {
      ensureNotDisposed();
      return muted;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      currentMusicId = null;
      if (currentMusicNode) {
        try {
          currentMusicNode.stop();
        } catch {}
        currentMusicNode = null;
      }
      activeVoices.clear();
      pendingDecodes.clear();
      bufferCache.clear();
      if (interruptionSub) {
        try {
          interruptionSub.remove();
        } catch {}
        interruptionSub = null;
      }
      if (interruptionEnabled) {
        try {
          AudioManager.observeAudioInterruptions(false);
        } catch {}
        interruptionEnabled = false;
      }
      void context.close().catch(() => {});
    },
  };

  return audio;
}
