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
   * Public pause gate (T20.7, GS-HAPTICS-01): while paused, `play` drops
   * transient requests with reason `'paused'`. Independent from the
   * lifecycle gate, AppState backgrounding, and mute — any one alone
   * suppresses feedback, and clearing one never clears another.
   */
  setPaused(paused: boolean): void;
  /**
   * Follow a session lifecycle source (T20.3/T20.7, GS-HAPTICS-01): applies
   * the source's current status immediately, then pauses on every
   * non-running transition and resumes on `'running'`. Returns a detach
   * function. Detaching removes only this source's gate (manual pause is
   * untouched). AppState backgrounding stays independent.
   */
  bindLifecycle(source: GameLifecycleSource): () => void;
  dispose(): void;
}

export interface CreateGameHapticsOptions {
  readonly muted?: boolean;
  /**
   * Monotonic clock for the throttle budget (GS-HAPTICS-03). Defaults to
   * `Date.now`; inject a controlled clock for deterministic tests.
   */
  readonly now?: () => number;
}
