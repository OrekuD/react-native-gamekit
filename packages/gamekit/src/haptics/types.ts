import type { GameLifecycleSource } from '../core/session/types';

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
  /**
   * Public pause gate (T20.7): while paused, `play` drops transient requests
   * with reason `'paused'`. Independent from the AppState background gate —
   * either source alone suppresses feedback.
   */
  setPaused(paused: boolean): void;
  /**
   * Follow a session lifecycle source (T20.3/T20.7): applies the source's
   * current status immediately, then pauses on every non-running transition
   * and resumes on `'running'`. Returns a detach function. AppState
   * backgrounding stays independent from the session source.
   */
  bindLifecycle(source: GameLifecycleSource): () => void;
  dispose(): void;
}

export interface CreateGameHapticsOptions {
  readonly muted?: boolean;
}
