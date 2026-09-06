export type AudioCategory = 'master' | 'music' | 'sfx' | 'ui';

// Imported for documentation only; the runtime never requires the session.
import type { GameLifecycleSource } from '../core/session/types';

export type AudioSoundRecord = Record<string, number>;

export interface CreateGameAudioOptions<T extends AudioSoundRecord> {
  readonly sounds: T;
}

export interface GameAudioPlayOptions {
  readonly category?: AudioCategory;
  readonly volume?: number;
  readonly loop?: boolean;
  readonly concurrency?: {
    readonly key?: string;
    readonly limit?: number;
    readonly overflow?: 'drop-new' | 'stop-oldest';
  };
}

export interface GameAudio<T extends AudioSoundRecord = AudioSoundRecord> {
  play<K extends keyof T & string>(id: K, options?: GameAudioPlayOptions): void;
  playMusic<K extends keyof T & string>(id: K): Promise<void>;
  stopMusic(): void;
  pause(): void;
  resume(): void;
  setVolume(category: AudioCategory, volume: number): void;
  getVolume(category: AudioCategory): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /**
   * Session-driven pause (GS-AUDIO-04): follows the bound session status,
   * independent of the manual pause()/resume() hold, app backgrounding,
   * interruption, and mute — any reason suspends.
   */
  setPaused(paused: boolean): void;
  /**
   * Bind one session lifecycle source (GS-AUDIO-04, mirrors haptics):
   * applies the current status immediately, follows transitions, and
   * detaches any previously bound source. Returns an idempotent detach.
   * All subscriptions disappear on disposal.
   */
  bindLifecycle(source: GameLifecycleSource): () => void;
  dispose(): void;
}
