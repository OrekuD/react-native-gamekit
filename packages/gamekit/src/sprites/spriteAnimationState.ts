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
 * Simulation-only execution (GS-ANIMATION-02): these state transitions run
 * on fixed-step game time in the simulation, never on the UI runtime, so
 * they carry no worklet directive — a directive here would promise UI
 * execution the error branches (structured error classes) cannot keep.
 * The UI-reachable frame-selection helpers live in `sampleSpriteClip` and
 * `react/sprites/spriteSelection` with a UI-safe call graph.
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

function assertPlaybackElapsed(elapsedMs: number): void {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error('sprite animation elapsed time must be finite and non-negative');
  }
}

/** The clip names of a sprite-sheet descriptor (works through the manifest brand). */
export type SpriteClipNames<TDescriptor extends SpriteSheetDescriptor> = `${Extract<
  keyof TDescriptor['animations'],
  string | number
>}`;

/** Runtime clip lookup; throws a structured error for unknown clips. */
function clipOf(
  descriptor: SpriteSheetDescriptor,
  clip: string,
): SpriteSheetDescriptor['animations'][string] {
  const animation = Object.prototype.hasOwnProperty.call(descriptor.animations, clip)
    ? descriptor.animations[clip]
    : undefined;
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
 * Start playback of `clip` from its beginning. The clip name is constrained
 * to the descriptor's animation keys, so a misspelled clip fails compilation;
 * untyped callers still hit the runtime check below.
 */
export function startSpriteAnimation<TDescriptor extends SpriteSheetDescriptor>(
  descriptor: TDescriptor,
  clip: SpriteClipNames<TDescriptor>,
): SpriteAnimationState<SpriteClipNames<TDescriptor>> {
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
 * Finite negative deltas rewind, clamping at zero; NaN/infinity fail
 * clearly. Loop clips keep their elapsed time bounded within one timeline
 * (modulo), so large deltas cost constant arithmetic. The scaled delta and
 * accumulated elapsed time must remain representable as finite milliseconds.
 * Unchanged playback returns the original state object.
 */
export function advanceSpriteAnimation<
  TDescriptor extends SpriteSheetDescriptor,
  TClip extends SpriteClipNames<TDescriptor>,
>(
  descriptor: TDescriptor,
  state: SpriteAnimationState<TClip>,
  deltaSeconds: number,
): SpriteAnimationState<TClip> {
  assertFiniteDelta(deltaSeconds);
  assertPlaybackElapsed(state.elapsedMs);
  assertFinitePositiveSpeed(state.speed);
  const clip = clipOf(descriptor, state.clip);
  if (state.paused || state.completed) {
    return state;
  }
  const totalMs = spriteClipDurationMs(clip);
  const scaledDelta = deltaSeconds * 1000 * state.speed;
  // A huge delta with a tiny speed may have a finite product even when
  // conversion to milliseconds overflows first. Retry that rare case.
  const deltaMs = Number.isFinite(scaledDelta)
    ? scaledDelta
    : (deltaSeconds * state.speed) * 1000;
  const next = state.elapsedMs + deltaMs;
  if (!Number.isFinite(next)) {
    throw new RangeError('sprite animation advance must produce finite milliseconds');
  }
  if (clip.mode === 'once') {
    if (next >= totalMs) {
      return { ...state, elapsedMs: totalMs, completed: true };
    }
    const elapsedMs = next < 0 ? 0 : next;
    return elapsedMs === state.elapsedMs ? state : { ...state, elapsedMs };
  }
  // Loop: bounded elapsed within one timeline; negative clamps to zero.
  const wrapped = next < 0 ? 0 : next % totalMs;
  return wrapped === state.elapsedMs ? state : { ...state, elapsedMs: wrapped };
}

/**
 * Switch playback to a different `clip`, restarting it from the beginning.
 * Selecting the current clip is a no-op; use `resetSpriteAnimation` to
 * restart it. The name is typed against the descriptor's animation table.
 */
export function playSpriteAnimation<
  TDescriptor extends SpriteSheetDescriptor,
  TClip extends SpriteClipNames<TDescriptor>,
>(
  descriptor: TDescriptor,
  state: SpriteAnimationState<TClip>,
  clip: SpriteClipNames<TDescriptor>,
): SpriteAnimationState<SpriteClipNames<TDescriptor>> {
  clipOf(descriptor, clip);
  if (clip === state.clip) {
    return state;
  }
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
  return state.paused ? state : { ...state, paused: true };
}

/** Resume playback from the paused position. */
export function resumeSpriteAnimation<TClipName extends string>(
  state: SpriteAnimationState<TClipName>,
): SpriteAnimationState<TClipName> {
  return state.paused ? { ...state, paused: false } : state;
}

/** Restart the current clip from its beginning. */
export function resetSpriteAnimation<TClipName extends string>(
  state: SpriteAnimationState<TClipName>,
): SpriteAnimationState<TClipName> {
  return state.elapsedMs === 0 && !state.completed
    ? state
    : { ...state, elapsedMs: 0, completed: false };
}

/** Set a finite positive speed multiplier. */
export function setSpriteAnimationSpeed<TClipName extends string>(
  state: SpriteAnimationState<TClipName>,
  speed: number,
): SpriteAnimationState<TClipName> {
  assertFinitePositiveSpeed(speed);
  return state.speed === speed ? state : { ...state, speed };
}
