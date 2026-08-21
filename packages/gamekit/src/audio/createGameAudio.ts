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

let assetInputLoader: ((assetId: number) => Promise<number | string | ArrayBuffer>) | null = null;

export function __setAssetInputLoader(
  fn: ((assetId: number) => Promise<number | string | ArrayBuffer>) | null,
): void {
  assetInputLoader = fn;
}

export function __getAssetInputLoader(): ((assetId: number) => Promise<number | string | ArrayBuffer>) | null {
  return assetInputLoader;
}

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
  const context = new AudioContext();

  type GainLike = { gain: { value: number; setValueAtTime?: (v:number,t:number)=>unknown; linearRampToValueAtTime?: (v:number,t:number)=>unknown; cancelScheduledValues?: (t:number)=>unknown }; connect: (dest: unknown)=>unknown };
  let masterGain: GainLike | null = null;
  const categoryGains: Record<AudioCategory, GainLike | null> = { master: null, music: null, sfx: null, ui: null };
  try {
    const mg = (context as unknown as { createGain: ()=> GainLike }).createGain?.();
    if (mg) {
      masterGain = mg;
      try { (mg as unknown as { connect: (d: unknown)=>void }).connect((context as unknown as { destination: unknown }).destination); } catch {}
      for (const cat of CATEGORIES) {
        if (cat === 'master') { categoryGains[cat] = mg; continue; }
        try {
          const cg = (context as unknown as { createGain: ()=> GainLike }).createGain();
          if (cg) {
            categoryGains[cat] = cg;
            try { (cg as unknown as { connect: (d: unknown)=>void }).connect(mg); } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  const volumes: Record<AudioCategory, number> = { master: 1, music: 1, sfx: 1, ui: 1 };

  function applyGain(category: AudioCategory): void {
    const gain = categoryGains[category];
    if (!gain) return;
    const value = category === 'master' ? volumes.master : volumes.master * volumes[category];
    try {
      const param = gain.gain as unknown as { value: number; cancelScheduledValues?: (t:number)=>void; setValueAtTime?: (v:number,t:number)=>void; linearRampToValueAtTime?: (v:number,t:number)=>void };
      const now = (context as unknown as { currentTime: number }).currentTime ?? 0;
      if (param.cancelScheduledValues) param.cancelScheduledValues(now);
      if (param.setValueAtTime) param.setValueAtTime(param.value, now);
      if (param.linearRampToValueAtTime) param.linearRampToValueAtTime(value, now + 0.02);
      else param.value = value;
    } catch {
      try { (gain.gain as unknown as { value: number }).value = value; } catch {}
    }
  }

  function applyAllGains(): void {
    for (const c of CATEGORIES) applyGain(c);
  }

  let muted = false;
  let disposed = false;
  let userPaused = false;
  let sessionPaused = false;
  let appPaused = false;
  let interruptionPaused = false;

  const bufferCache = new Map<string, unknown>();
  const pendingDecodes = new Map<string, Promise<unknown>>();

  async function getBuffer(id: keyof T & string): Promise<unknown> {
    if (disposed) throw new GameAudioError('GameAudio is disposed');
    if (bufferCache.has(id)) return bufferCache.get(id)!;
    if (pendingDecodes.has(id)) return pendingDecodes.get(id)!;
    const assetId = (options.sounds as Record<string, number>)[id] as number;
    const promise = (async () => {
      let input: number | string | ArrayBuffer;
      if (assetInputLoader) {
        input = await assetInputLoader(assetId);
      } else {
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
        if (assetUri) input = assetUri;
        else if (expoAssetFailed) input = assetId;
        else throw new GameAudioError(`Failed to resolve asset for sound "${String(id)}" — expo-asset returned no URI`);
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
    try { return await promise; } catch (e) { pendingDecodes.delete(id); throw e; }
  }

  await Promise.all(soundIds.map((id) => getBuffer(id)));
  let currentMusicId: (keyof T & string) | null = null;
  let currentMusicNode: { stop(when?: number): void } | null = null;
  const activeVoices = new Set<unknown>();
  const concurrencyMap = new Map<string, Set<unknown>>();
  const cancelledReservations = new Set<unknown>();
  let idleSuspendTimer: ReturnType<typeof setTimeout> | null = null;

  function isEffectivelyPaused(): boolean {
    return userPaused || sessionPaused || appPaused || interruptionPaused || muted;
  }

  function updateSuspendState(): void {
    if (disposed) return;
    if (isEffectivelyPaused()) {
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer = null; }
      void context.suspend().catch(() => {});
    } else {
      try {
        const state = (context as unknown as { state: string }).state;
        if (state === 'suspended') void context.resume().catch(()=>{});
        applyAllGains();
      } catch {}
      scheduleIdleSuspend();
    }
  }

  function scheduleIdleSuspend(): void {
    if (idleSuspendTimer) clearTimeout(idleSuspendTimer);
    if (disposed || isEffectivelyPaused()) return;
    if (activeVoices.size === 0 && currentMusicNode === null) {
      idleSuspendTimer = setTimeout(() => {
        if (!disposed && activeVoices.size===0 && currentMusicNode===null && !isEffectivelyPaused()) {
          void context.suspend().catch(()=>{});
        }
      }, 1500);
    }
  }

  function cleanupVoice(voice: unknown, concurrencyKey?: string): void {
    activeVoices.delete(voice);
    if (concurrencyKey) {
      const set = concurrencyMap.get(concurrencyKey);
      if (set) { set.delete(voice); if (set.size===0) concurrencyMap.delete(concurrencyKey); }
    }
    scheduleIdleSuspend();
  }

  const ensureNotDisposed = (): void => {
    if (disposed) throw new GameAudioError('GameAudio is disposed');
  };

  let interruptionSub: { remove(): void } | null = null;
  let interruptionEnabled = false;
  function handleInterruption(event: unknown): void {
    const e = event as { type?: string; shouldResume?: boolean };
    if (e.type === 'began') {
      interruptionPaused = true;
      void context.suspend().catch(()=>{});
    } else if (e.type === 'ended') {
      interruptionPaused = false;
      updateSuspendState();
    }
  }
  try {
    AudioManager.observeAudioInterruptions(true);
    interruptionEnabled = true;
    interruptionSub = AudioManager.addSystemEventListener('interruption', handleInterruption as never);
  } catch { interruptionSub = null; }

  let appStateSub: { remove(): void } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native') as { AppState?: { currentState?: string; addEventListener: (t:string, cb:(s:string)=>void)=>{ remove:()=>void } } };
    const AppState = RN?.AppState;
    if (AppState?.addEventListener) {
      const isInactive = (s: string | null | undefined) => s === 'inactive' || s === 'background';
      if (isInactive(AppState.currentState)) {
        appPaused = true;
        void context.suspend().catch(()=>{});
      }
      appStateSub = AppState.addEventListener('change', (next: string) => {
        if (isInactive(next)) {
          appPaused = true;
          void context.suspend().catch(()=>{});
        } else if (next === 'active') {
          appPaused = false;
          updateSuspendState();
        }
      });
    }
  } catch {}

  applyAllGains();

  const audio: GameAudio<T> & {
    _setSessionPaused?: (p:boolean)=>void;
    _isIdleSuspended?: ()=>boolean;
    _getConcurrencyCount?: (key:string)=>number;
  } = {
    play<K extends keyof T & string>(id: K, opts?: GameAudioPlayOptions): void {
      ensureNotDisposed();
      if (isEffectivelyPaused()) return;
      if (opts?.category !== undefined) assertCategory(opts.category);
      if (opts?.volume !== undefined) assertVolume(opts.volume);
      const category: AudioCategory = (opts?.category as AudioCategory) ?? 'sfx';
      const concurrencyKey = opts?.concurrency?.key ?? String(id);
      const limit = opts?.concurrency?.limit;
      const overflow = opts?.concurrency?.overflow ?? 'drop-new';
      let reservation: unknown = null;
      if (limit !== undefined) {
        if (!Number.isFinite(limit) || limit < 1 || Math.floor(limit) !== limit) {
          throw new GameAudioError(`Concurrency limit must be a positive integer, got ${String(limit)}`);
        }
        let set = concurrencyMap.get(concurrencyKey);
        if (!set) { set = new Set(); concurrencyMap.set(concurrencyKey, set); }
        if (set.size >= limit) {
          if (overflow === 'drop-new') return;
          if (overflow === 'stop-oldest') {
            const oldest = set.values().next().value as unknown;
            if (oldest) {
              try { (oldest as { stop: (w?:number)=>void }).stop(); } catch {}
              set.delete(oldest);
              activeVoices.delete(oldest);
              // Mark reservation as cancelled so its future async does not re-add a voice
              cancelledReservations.add(oldest);
            }
          }
        }
        reservation = {};
        set.add(reservation);
        // Also add to activeVoices as placeholder to keep idle logic correct? No, placeholder not in activeVoices, only concurrency
      }
      try {
        const state = (context as unknown as { state: string }).state;
        if (state === 'suspended' && !isEffectivelyPaused()) void context.resume().catch(()=>{});
      } catch {}
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer = null; }
      void (async () => {
        if (disposed || isEffectivelyPaused()) {
          if (reservation) {
            const set = concurrencyMap.get(concurrencyKey);
            if (set) { set.delete(reservation); if (set.size===0) concurrencyMap.delete(concurrencyKey); }
            cancelledReservations.delete(reservation);
          }
          return;
        }
        try {
          const buffer = await getBuffer(id as keyof T & string);
          if (disposed || isEffectivelyPaused()) {
            if (reservation) {
              const set = concurrencyMap.get(concurrencyKey);
              if (set) { set.delete(reservation); if (set.size===0) concurrencyMap.delete(concurrencyKey); }
              cancelledReservations.delete(reservation);
            }
            return;
          }
          if (reservation && cancelledReservations.has(reservation)) {
            cancelledReservations.delete(reservation);
            const set = concurrencyMap.get(concurrencyKey);
            if (set) { set.delete(reservation); if (set.size===0) concurrencyMap.delete(concurrencyKey); }
            return;
          }
          const source: {
            buffer: unknown | null;
            loop?: boolean;
            connect(dest: unknown): void;
            start(when?: number, offset?: number, duration?: number): void;
            stop(when?: number): void;
            addEventListener?: (type: string, cb: () => void) => void;
            onended?: (()=>void)|null;
          } = (context as unknown as { createBufferSource(): { buffer: unknown | null; connect(dest: unknown): void; start(when?: number): void; stop(when?: number): void; addEventListener?: (type: string, cb: () => void) => void } }).createBufferSource();
          source.buffer = buffer;
          if (opts?.loop) source.loop = true;
          let dest: unknown = (context as unknown as { destination: unknown }).destination;
          const catGain = categoryGains[category];
          if (catGain) dest = catGain;
          else if (masterGain) dest = masterGain;
          let voiceGain: GainLike | null = null;
          if (opts?.volume !== undefined) {
            try {
              voiceGain = (context as unknown as { createGain: ()=>GainLike }).createGain();
              if (voiceGain) {
                const v = opts.volume as number;
                try { (voiceGain.gain as unknown as { value:number }).value = v; } catch {}
                voiceGain.connect(dest);
                dest = voiceGain;
              }
            } catch {}
          }
          source.connect(dest);
          activeVoices.add(source);
          const cleanup = (): void => {
            cleanupVoice(source, limit!==undefined?concurrencyKey:undefined);
          };
          // Swap reservation for real voice in concurrency map
          if (reservation) {
            const set = concurrencyMap.get(concurrencyKey);
            if (set) {
              set.delete(reservation);
              set.add(source);
            }
          }
          const anySource = source as unknown as { onended?: (()=>void)|null; addEventListener?: (type:string, cb:()=>void)=>void };
          if (typeof anySource.addEventListener === 'function') anySource.addEventListener('ended', cleanup);
          else anySource.onended = cleanup;
          source.start();
          if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer=null; }
        } catch (e) {
          if (reservation) {
            const set = concurrencyMap.get(concurrencyKey);
            if (set) { set.delete(reservation); if (set.size===0) concurrencyMap.delete(concurrencyKey); }
            cancelledReservations.delete(reservation);
          }
          console.warn(`[GameAudio] play("${String(id)}") failed:`, e);
        }
      })();
    },

    async playMusic<K extends keyof T & string>(id: K): Promise<void> {
      ensureNotDisposed();
      if (currentMusicNode) {
        try { currentMusicNode.stop(); } catch {}
        currentMusicNode = null;
      }
      currentMusicId = id;
      if (isEffectivelyPaused()) return;
      try {
        const buffer = await getBuffer(id as keyof T & string);
        if (disposed || isEffectivelyPaused() || currentMusicId !== id) return;
        const source = (context as unknown as { createBufferSource(): { buffer: unknown | null; loop: boolean; connect(dest: unknown): void; start(when?: number): void; stop(when?: number): void } }).createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const dest = categoryGains['music'] ?? masterGain ?? (context as unknown as { destination: unknown }).destination;
        source.connect(dest as unknown);
        currentMusicNode = source;
        source.start();
        if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer=null; }
        const state = (context as unknown as { state: string }).state;
        if (state === 'suspended' && !isEffectivelyPaused()) await context.resume().catch(()=>{});
      } catch (e) {
        console.warn(`[GameAudio] playMusic("${String(id)}") failed:`, e);
        if (currentMusicId === id) currentMusicId = null;
      }
    },

    stopMusic(): void {
      ensureNotDisposed();
      if (currentMusicNode) { try { currentMusicNode.stop(); } catch {} currentMusicNode=null; }
      currentMusicId = null;
      scheduleIdleSuspend();
    },

    pause(): void {
      ensureNotDisposed();
      if (userPaused) return;
      userPaused = true;
      void context.suspend().catch(()=>{});
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer=null; }
    },

    resume(): void {
      ensureNotDisposed();
      if (!userPaused) return;
      userPaused = false;
      updateSuspendState();
    },

    setVolume(category: AudioCategory, volume: number): void {
      ensureNotDisposed();
      assertCategory(category);
      assertVolume(volume);
      volumes[category] = volume;
      applyGain(category);
      if (category === 'master') applyAllGains();
    },

    getVolume(category: AudioCategory): number {
      ensureNotDisposed();
      assertCategory(category);
      return volumes[category];
    },

    setMuted(next: boolean): void {
      ensureNotDisposed();
      muted = Boolean(next);
      updateSuspendState();
    },

    isMuted(): boolean {
      ensureNotDisposed();
      return muted;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      currentMusicId = null;
      if (currentMusicNode) { try { currentMusicNode.stop(); } catch {} currentMusicNode=null; }
      for (const v of activeVoices) { try { (v as { stop:(w?:number)=>void }).stop(); } catch {} }
      activeVoices.clear();
      concurrencyMap.clear();
      pendingDecodes.clear();
      bufferCache.clear();
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer=null; }
      if (interruptionSub) { try { interruptionSub.remove(); } catch {} interruptionSub=null; }
      if (interruptionEnabled) { try { AudioManager.observeAudioInterruptions(false); } catch {} interruptionEnabled=false; }
      if (appStateSub) { try { appStateSub.remove(); } catch {} appStateSub=null; }
      void context.close().catch(()=>{});
    },
  };

  (audio as unknown as { _setSessionPaused: (p:boolean)=>void })._setSessionPaused = (p: boolean) => {
    sessionPaused = p;
    if (p) void context.suspend().catch(()=>{});
    else updateSuspendState();
  };
  (audio as unknown as { _isIdleSuspended: ()=>boolean })._isIdleSuspended = () => {
    try { return (context as unknown as { state: string }).state === 'suspended'; } catch { return false; }
  };
  (audio as unknown as { _getConcurrencyCount: (k:string)=>number })._getConcurrencyCount = (k: string) => concurrencyMap.get(k)?.size ?? 0;

  return audio as GameAudio<T>;
}
