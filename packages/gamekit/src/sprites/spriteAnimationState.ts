/**
 * Deterministic sprite animation playback state (T7.3).
 *
 * Animation state is plain serializable data advanced from fixed-step game
 * time: `clip`, elapsed time, pause flag, speed, and completion. Changing,
 * pausing, restarting, or completing a clip returns a NEW state object; it
 * never mutates scene state or emits a side effect. The same input and
 * elapsed game time always select the same presented frame (see
 * `sampleSpriteClip`).
 *
 * Separation of concerns: gameplay-significant animation state lives in the
 * scene snapshot and advances from fixed-step game time; a renderer-only
 * loop may interpolate presentation from the latest committed state plus
 * the interpolation alpha, but must never emit gameplay events from a
 * presentation-only frame.
 */
import { GameAssetError } from '../assets/errors';
import type { SpriteSheetDescriptor } from '../assets/types';
import { spriteClipDurationMs } from './sampleSpriteClip';

/** Immutable, serializable animation playback state. */
export interface SpriteAnimationState<TClipName extends string = string> {
  /** The clip currently selected on the descriptor. */
  readonly clip: TClipName;
  /** Elapsed milliseconds within the current playback of the clip. */
  readonly elapsedMs: number;
  /** Playback paused: advance is a no-op while paused. */
  readonly paused: boolean;
  /** Finite, positive playback speed multiplier. */
  readonly speed: number;
  /** One-shot clips report completion after their final frame. */
  readonly completed: boolean;
}

function assertFinitePositiveSpeed(speed: number): void {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
    throw new Error('sprite animation speed must be a finite number greater than zero');
  }
}

function assertFiniteDelta(deltaSeconds: number): void {
  if (typeof deltaSeconds !== 'number' || !Number.isFinite(deltaSeconds)) {
    throw new Error('sprite animation delta must be a finite number of seconds');
  }
}
/** The clip names of a sprite-sheet descriptor (works through the manifest brand). */
export type SpriteClipNames<TDescriptor extends SpriteSheetDescriptor> = Extract<
  keyof TDescriptor['animations'],
  string
>;

/** Runtime clip lookup; throws a structured error for unknown clips. */
function clipOf(
  descriptor: SpriteSheetDescriptor,
  clip: string,
): SpriteSheetDescriptor['animations'][string] {
  'worklet';
  const animation = descriptor.animations[clip];
  if (animation === undefined) {
    throw new GameAssetError(
      'ASSET_UNKNOWN_CLIP',
      ['animations', clip],
      `unknown animation clip ${JSON.stringify(clip)}`,
    );
  }
  return animation;
}

/**
 * Start playback of `clip` from its beginning. The clip name is preserved
 * as a string literal in the returned state; unknown clips are rejected at
 * runtime (the manifest descriptor keeps the sheet-level frame and clip
 * names literal via the spriteSheet contract).
 */
export function startSpriteAnimation<TClipName extends string>(
  descriptor: SpriteSheetDescriptor,
  clip: TClipName,
): SpriteAnimationState<TClipName> {
  'worklet';
  clipOf(descriptor, clip);
  return {
    clip,
    elapsedMs: 0,
    paused: false,
    speed: 1,
    completed: false,
  };
}

/**
 * Advance playback by `deltaSeconds` of fixed-step game time.
 *
 * Finite negative deltas clamp elapsed time to zero; NaN/infinity fail
 * clearly. Loop clips keep their elapsed time bounded within one timeline
 * (modulo), so arbitrarily large deltas cost constant arithmetic.
 */
export function advanceSpriteAnimation<TClipName extends string>(
  descriptor: SpriteSheetDescriptor,
  state: SpriteAnimationState<TClipName>,
  deltaSeconds: number,
): SpriteAnimationState<TClipName> {
  'worklet';
  assertFiniteDelta(deltaSeconds);
  if (state.paused || state.completed) {
    return state;
  }
  const clip = clipOf(descriptor, state.clip);
  const totalMs = spriteClipDurationMs(clip);
  const next = state.elapsedMs + deltaSeconds * 1000 * state.speed;
  if (clip.mode === 'once') {
    if (next >= totalMs) {
      return { ...state, elapsedMs: totalMs, completed: true };
    }
    return { ...state, elapsedMs: next < 0 ? 0 : next };
  }
  // Loop: bounded elapsed within one timeline; negative clamps to zero.
  const wrapped = next < 0 ? 0 : next % totalMs;
  return { ...state, elapsedMs: wrapped };
}

/**
 * Switch playback to `clip`, restarting it from the beginning. The clip
 * name is typed against the descriptor's animation table.
 */
export function playSpriteAnimation<TClipName extends string>(
  descriptor: SpriteSheetDescriptor,
  state: SpriteAnimationState<TClipName>,
  clip: TClipName,
): SpriteAnimationState<TClipName> {
  'worklet';
  if (clip === state.clip) {
    return state;
  }
  clipOf(descriptor, clip);
  return {
    clip,
    elapsedMs: 0,
    paused: state.paused,
    speed: state.speed,
    completed: false,
  };
}

/** Pause playback; `advance` becomes a no-op while paused. */
export function pauseSpriteAnimation<TClipName extends string>(
  state: SpriteAnimationState<TClipName>,
): SpriteAnimationState<TClipName> {
  'worklet';
  return state.paused ? state : { ...state, paused: true };
}

/** Resume playback from the paused position. */
export function resumeSpriteAnimation<TClipName extends string>(
  state: SpriteAnimationState<TClipName>,
): SpriteAnimationState<TClipName> {
  'worklet';
  return state.paused ? { ...state, paused: false } : state;
}

/** Restart the current clip from its beginning. */
export function resetSpriteAnimation<TClipName extends string>(
  state: SpriteAnimationState<TClipName>,
): SpriteAnimationState<TClipName> {
  'worklet';
  return { ...state, elapsedMs: 0, completed: false };
}

/** Set a finite positive speed multiplier. */
export function setSpriteAnimationSpeed<TClipName extends string>(
  state: SpriteAnimationState<TClipName>,
  speed: number,
): SpriteAnimationState<TClipName> {
  'worklet';
  assertFinitePositiveSpeed(speed);
  return state.speed === speed ? state : { ...state, speed };
}
