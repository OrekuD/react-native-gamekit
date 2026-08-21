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
  let context: InstanceType<typeof AudioContext> | null = null;
  type GainLike = { gain: { value: number; setValueAtTime?: (v:number,t:number)=>unknown; linearRampToValueAtTime?: (v:number,t:number)=>unknown; cancelScheduledValues?: (t:number)=>unknown }; connect: (dest: unknown)=>unknown };
  let masterGain: GainLike | null = null;
  const categoryGains: Record<AudioCategory, GainLike | null> = { master: null, music: null, sfx: null, ui: null };
  let interruptionSub: { remove(): void } | null = null;
  let interruptionEnabled = false;
  let appStateSub: { remove(): void } | null = null;
  let idleSuspendTimer: ReturnType<typeof setTimeout> | null = null;

  // Create context in a transaction so failure cleans up
  try {
    context = new AudioContext();
  } catch (e) {
    throw e;
  }

  const volumes: Record<AudioCategory, number> = { master: 1, music: 1, sfx: 1, ui: 1 };

  // Gain setup — master -> destination, categories -> master (F1)
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

  function applyGain(category: AudioCategory): void {
    const gain = categoryGains[category];
    if (!gain) return;
    // F1: write only own volume; composition happens in graph (master * category)
    const value = volumes[category];
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
  let interruptionRequiresExplicitResume = false;

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
        buffer = await (context as InstanceType<typeof AudioContext>).decodeAudioData(input as unknown as ArrayBuffer);
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

  // Transaction: eager decode with cleanup on failure (F3)
  try {
    await Promise.all(soundIds.map((id) => getBuffer(id)));
  } catch (e) {
    // Close context exactly once before rethrowing
    try { await (context as InstanceType<typeof AudioContext>).close(); } catch {}
    pendingDecodes.clear();
    bufferCache.clear();
    throw e;
  }

  let currentMusicId: (keyof T & string) | null = null;
  let currentMusicNode: { stop(when?: number): void } | null = null;
  let musicGeneration = 0;
  let activeMusicGeneration = 0;
  let pendingMusic: { id: keyof T & string; generation: number } | null = null;
  const activeVoices = new Set<unknown>();
  const concurrencyMap = new Map<string, Set<unknown>>();
  const cancelledReservations = new Set<unknown>();

  function isEffectivelyPaused(): boolean {
    return userPaused || sessionPaused || appPaused || interruptionPaused || muted;
  }

  function updateSuspendState(): void {
    if (disposed || !context) return;
    if (isEffectivelyPaused()) {
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer = null; }
      void (context as InstanceType<typeof AudioContext>).suspend().catch(() => {});
    } else {
      try {
        const state = (context as unknown as { state: string }).state;
        if (state === 'suspended') void (context as InstanceType<typeof AudioContext>).resume().catch(()=>{});
        applyAllGains();
      } catch {}
      // If we have deferred music intent and now unpaused, start it (F4)
      if (pendingMusic && !isEffectivelyPaused()) {
        const { id, generation } = pendingMusic;
        pendingMusic = null;
        void startMusicInternal(id, generation);
      }
      scheduleIdleSuspend();
    }
  }

  function scheduleIdleSuspend(): void {
    if (idleSuspendTimer) clearTimeout(idleSuspendTimer);
    if (disposed || !context || isEffectivelyPaused()) return;
    if (activeVoices.size === 0 && currentMusicNode === null && !pendingMusic) {
      idleSuspendTimer = setTimeout(() => {
        if (!disposed && context && activeVoices.size===0 && currentMusicNode===null && !pendingMusic && !isEffectivelyPaused()) {
          void (context as InstanceType<typeof AudioContext>).suspend().catch(()=>{});
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

  function handleInterruption(event: unknown): void {
    const e = event as { type?: string; shouldResume?: boolean };
    if (e.type === 'began') {
      interruptionPaused = true;
      interruptionRequiresExplicitResume = false;
      void (context as InstanceType<typeof AudioContext>).suspend().catch(()=>{});
    } else if (e.type === 'ended') {
      if (e.shouldResume) {
        if (interruptionRequiresExplicitResume) {
          // Denied auto-resume persists until explicit user action (F2)
          void (context as InstanceType<typeof AudioContext>).suspend().catch(()=>{});
          return;
        }
        interruptionPaused = false;
        interruptionRequiresExplicitResume = false;
        updateSuspendState();
      } else {
        // Platform says don't auto-resume: keep paused until explicit user action (F2)
        interruptionPaused = true;
        interruptionRequiresExplicitResume = true;
        void (context as InstanceType<typeof AudioContext>).suspend().catch(()=>{});
      }
    }
  }
  try {
    AudioManager.observeAudioInterruptions(true);
    interruptionEnabled = true;
    interruptionSub = AudioManager.addSystemEventListener('interruption', handleInterruption as never);
  } catch { interruptionSub = null; }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native') as { AppState?: { currentState?: string; addEventListener: (t:string, cb:(s:string)=>void)=>{ remove:()=>void } } };
    const AppState = RN?.AppState;
    if (AppState?.addEventListener) {
      const isInactive = (s: string | null | undefined) => s === 'inactive' || s === 'background';
      if (isInactive(AppState.currentState)) {
        appPaused = true;
        void (context as InstanceType<typeof AudioContext>).suspend().catch(()=>{});
      }
      appStateSub = AppState.addEventListener('change', (next: string) => {
        if (isInactive(next)) {
          appPaused = true;
          void (context as InstanceType<typeof AudioContext>).suspend().catch(()=>{});
        } else if (next === 'active') {
          appPaused = false;
          updateSuspendState();
        }
      });
    }
  } catch {}

  applyAllGains();
  // Initial idle suspend (F2): resource with no playback should suspend
  scheduleIdleSuspend();

  async function startMusicInternal(id: keyof T & string, generation: number): Promise<void> {
    if (disposed || !context) return;
    if (isEffectivelyPaused()) {
      // Defer until resume
      pendingMusic = { id, generation };
      return;
    }
    if (generation !== musicGeneration) return;
    try {
      const buffer = await getBuffer(id);
      if (disposed || !context) return;
      if (generation !== musicGeneration) return;
      if (isEffectivelyPaused()) {
        pendingMusic = { id, generation };
        return;
      }
      if (currentMusicId !== id || activeMusicGeneration !== generation) {
        // If another generation has taken over, don't start
        if (generation !== musicGeneration) return;
      }
      const source = (context as unknown as { createBufferSource(): { buffer: unknown | null; loop: boolean; connect(dest: unknown): void; start(when?: number): void; stop(when?: number): void } }).createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const dest = categoryGains['music'] ?? masterGain ?? (context as unknown as { destination: unknown }).destination;
      source.connect(dest as unknown);
      // Stop previous
      if (currentMusicNode) { try { currentMusicNode.stop(); } catch {} }
      currentMusicNode = source;
      currentMusicId = id;
      activeMusicGeneration = generation;
      source.start();
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer=null; }
      const state = (context as unknown as { state: string }).state;
      if (state === 'suspended' && !isEffectivelyPaused()) await (context as InstanceType<typeof AudioContext>).resume().catch(()=>{});
    } catch (e) {
      if (generation === musicGeneration) {
        console.warn(`[GameAudio] playMusic("${String(id)}") failed:`, e);
        if (currentMusicId === id && activeMusicGeneration === generation) {
          currentMusicId = null;
        }
      }
    }
  }

  const audio: GameAudio<T> & {
    _setSessionPaused?: (p:boolean)=>void;
    _isIdleSuspended?: ()=>boolean;
    _getConcurrencyCount?: (key:string)=>number;
    _handleInterruption?: (e:unknown)=>void;
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
              cancelledReservations.add(oldest);
            }
          }
        }
        reservation = {};
        set.add(reservation);
      }
      try {
        const state = (context as unknown as { state: string }).state;
        if (state === 'suspended' && !isEffectivelyPaused()) void (context as InstanceType<typeof AudioContext>).resume().catch(()=>{});
      } catch {}
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer = null; }
      void (async () => {
        if (disposed || !context || isEffectivelyPaused()) {
          if (reservation) {
            const set = concurrencyMap.get(concurrencyKey);
            if (set) { set.delete(reservation); if (set.size===0) concurrencyMap.delete(concurrencyKey); }
            cancelledReservations.delete(reservation);
          }
          return;
        }
        try {
          const buffer = await getBuffer(id as keyof T & string);
          if (disposed || !context || isEffectivelyPaused()) {
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
              voiceGain = (context as unknown as { createGain: ()=> GainLike }).createGain();
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
      musicGeneration++;
      const gen = musicGeneration;
      // Stop previous immediately and mark generation
      if (currentMusicNode) {
        try { currentMusicNode.stop(); } catch {}
        currentMusicNode = null;
      }
      currentMusicId = id;
      // If effectively paused, defer (F4)
      if (isEffectivelyPaused()) {
        pendingMusic = { id: id as keyof T & string, generation: gen };
        return;
      }
      await startMusicInternal(id as keyof T & string, gen);
    },

    stopMusic(): void {
      ensureNotDisposed();
      musicGeneration++;
      if (currentMusicNode) { try { currentMusicNode.stop(); } catch {} currentMusicNode=null; }
      currentMusicId = null;
      pendingMusic = null;
      scheduleIdleSuspend();
    },

    pause(): void {
      ensureNotDisposed();
      if (userPaused) return;
      userPaused = true;
      void (context as InstanceType<typeof AudioContext>).suspend().catch(()=>{});
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer=null; }
      // FF1: keep denied-interruption flag intact; only explicit resume() clears it
    },

    resume(): void {
      ensureNotDisposed();
      if (!userPaused && !interruptionRequiresExplicitResume) return;
      const wasExplicit = interruptionRequiresExplicitResume;
      userPaused = false;
      if (wasExplicit) {
        // Explicit user action clears denied auto-resume (F2)
        interruptionPaused = false;
        interruptionRequiresExplicitResume = false;
      }
      updateSuspendState();
    },

    setVolume(category: AudioCategory, volume: number): void {
      ensureNotDisposed();
      assertCategory(category);
      assertVolume(volume);
      volumes[category] = volume;
      applyGain(category);
      // F1: don't re-apply master when changing category, and vice versa — only own gain
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
      pendingMusic = null;
      if (currentMusicNode) { try { currentMusicNode.stop(); } catch {} currentMusicNode=null; }
      for (const v of activeVoices) { try { (v as { stop:(w?:number)=>void }).stop(); } catch {} }
      activeVoices.clear();
      concurrencyMap.clear();
      cancelledReservations.clear();
      pendingDecodes.clear();
      bufferCache.clear();
      if (idleSuspendTimer) { clearTimeout(idleSuspendTimer); idleSuspendTimer=null; }
      if (interruptionSub) { try { interruptionSub.remove(); } catch {} interruptionSub=null; }
      if (interruptionEnabled) { try { AudioManager.observeAudioInterruptions(false); } catch {} interruptionEnabled=false; }
      if (appStateSub) { try { appStateSub.remove(); } catch {} appStateSub=null; }
      if (context) void (context as InstanceType<typeof AudioContext>).close().catch(()=>{});
    },
  };

  (audio as unknown as { _setSessionPaused: (p:boolean)=>void })._setSessionPaused = (p: boolean) => {
    sessionPaused = p;
    if (p) void (context as InstanceType<typeof AudioContext>).suspend().catch(()=>{});
    else updateSuspendState();
  };
  (audio as unknown as { _isIdleSuspended: ()=>boolean })._isIdleSuspended = () => {
    try { return (context as unknown as { state: string }).state === 'suspended'; } catch { return false; }
  };
  (audio as unknown as { _getConcurrencyCount: (k:string)=>number })._getConcurrencyCount = (k: string) => concurrencyMap.get(k)?.size ?? 0;
  (audio as unknown as { _handleInterruption: (e:unknown)=>void })._handleInterruption = handleInterruption;
  (audio as unknown as { _getVolumes: ()=>typeof volumes })._getVolumes = () => ({ ...volumes });
  (audio as unknown as { _getGainTargets: ()=>Record<string, number> })._getGainTargets = () => {
    const out: Record<string, number> = {};
    for (const c of CATEGORIES) {
      const g = categoryGains[c];
      if (g) {
        try { out[c] = (g.gain as unknown as { value:number }).value; } catch { out[c] = volumes[c]; }
      }
    }
    return out;
  };

  return audio as GameAudio<T>;
}
