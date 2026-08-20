export type HapticPreset =
  | 'impact'
  | 'selection'
  | 'success'
  | 'warning'
  | 'error'
  | 'light'
  | 'medium'
  | 'heavy';

export interface HapticsResult {
  readonly played: boolean;
  readonly reason?: 'unsupported' | 'muted' | 'throttled' | 'disposed' | 'paused' | 'error';
}

export interface GameHaptics {
  play(preset: HapticPreset): HapticsResult;
  isSupported(preset: HapticPreset): boolean;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  dispose(): void;
}

export interface CreateGameHapticsOptions {
  readonly muted?: boolean;
}
