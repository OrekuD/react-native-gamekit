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

// Test seam: explicit injection for asset input. Production never infers test
// from URI scheme or numeric ID. When set, this loader supplies the
// DecodeDataInput (number|string|ArrayBuffer) that will be passed directly to
// context.decodeAudioData(). When null, production resolves via expo-asset or
// falls back to numeric module ID.
let assetInputLoader: ((assetId: number) => Promise<number | string | ArrayBuffer>) | null = null;

export function __setAssetInputLoader(
  fn: ((assetId: number) => Promise<number | string | ArrayBuffer>) | null,
): void {
  assetInputLoader = fn;
}

export function __getAssetInputLoader(): ((assetId: number) => Promise<number | string | ArrayBuffer>) | null {
  return assetInputLoader;
}

/**
 * Create one app-owned audio resource. One `AudioContext` per resource, decoded buffers
 * cached per sound ID, fresh source node per playback (single-use), suspend when idle,
 * close only on disposal. Native imports are isolated to this factory.
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
      let input: number | string | ArrayBuffer;
      if (assetInputLoader) {
        // Explicit test seam — never infer from production data
        input = await assetInputLoader(assetId);
      } else {
        // Production path: resolve via expo-asset, then pass result directly to
        // decodeAudioData using its supported DecodeDataInput (number|string|ArrayBuffer).
        // Never return a dummy buffer for file:// or small numeric IDs.
        let assetUri: string | null = null;
        let expoAssetFailed = false;
        try {
          const { Asset: ExpoAsset } = (await import('expo-asset')) as unknown as { Asset: { fromModule(id: number): { downloadAsync(): Promise<void>; localUri: string | null; uri: string } } };
          const asset = ExpoAsset.fromModule(assetId);
          await asset.downloadAsync();
          assetUri = asset.localUri ?? asset.uri;
        } catch {
          expoAssetFailed = true;
        }
        if (assetUri) {
          // Use the resolved URI directly — file:// URIs are valid DecodeDataInput
          // and are handled natively via decodeWithFilePath, not via JS fetch.
          input = assetUri;
        } else if (expoAssetFailed) {
          // expo-asset unavailable or failed (e.g. test without native). Fall back
          // to numeric module ID — AudioDecoder will resolve via Image.resolveAssetSource.
          // This still goes through real decodeAudioData, not a dummy.
          input = assetId;
        } else {
          throw new GameAudioError(`Failed to resolve asset for sound "${String(id)}" — expo-asset returned no URI`);
        }
      }

      let buffer: unknown;
      try {
        buffer = await context.decodeAudioData(input as unknown as ArrayBuffer);
      } catch (e) {
        throw new GameAudioError(`Failed to decode audio asset "${String(id)}": ${(e as Error).message}`);
      }
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

  // For the spike, await decoding of all sounds so the caller can claim
  // decoding only after it has actually completed. Failures surface as
  // real audio errors (no dummy-buffer fallback in production).
  await Promise.all(soundIds.map((id) => getBuffer(id)));

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
      void context.suspend().catch(() => {});
    } else if (e.type === 'ended' && e.shouldResume) {
      if (!disposed && !paused && !muted) {
        void context.resume().catch(() => {});
      }
    }
  }
  try {
    AudioManager.observeAudioInterruptions(true);
    interruptionEnabled = true;
    interruptionSub = AudioManager.addSystemEventListener('interruption', handleInterruption as never);
  } catch {
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
          activeVoices.add(source);
          const cleanup = (): void => {
            activeVoices.delete(source);
          };
          const anySource = source as unknown as { onended?: (() => void) | null; addEventListener?: (type: string, cb: () => void) => void };
          if (typeof anySource.addEventListener === 'function') {
            anySource.addEventListener('ended', cleanup);
          } else {
            anySource.onended = cleanup;
          }
          source.start();
        } catch (e) {
          console.warn(`[GameAudio] play("${String(id)}") failed:`, e);
        }
      })();
    },

    async playMusic<K extends keyof T & string>(id: K): Promise<void> {
      ensureNotDisposed();
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
