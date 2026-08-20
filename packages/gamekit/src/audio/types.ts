export type AudioCategory = 'master' | 'music' | 'sfx' | 'ui';

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
  dispose(): void;
}
