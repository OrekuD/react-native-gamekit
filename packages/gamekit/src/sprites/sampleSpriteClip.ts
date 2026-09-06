/**
 * Deterministic clip frame sampling (T7.3).
 *
 * Pure, allocation-free, worklet-compatible frame selection. The same clip
 * metadata and elapsed time always select the same frame, so equivalent
 * game time produces identical presentation at 30/60/90/120 Hz.
 *
 * Single-contract rule (GS-ANIMATION-01): every renderer path resolves
 * frames through these helpers — never duplicated arithmetic. Negative
 * elapsed clamps uniformly (loops wrap, one-shots pin to frame zero);
 * non-finite elapsed, empty clips, and non-positive durations fail clearly
 * instead of masking invalid data as frame zero. Unknown clip names throw
 * a plain `[ASSET_UNKNOWN_CLIP]` error: the UI-reachable call graph must
 * stay free of error-class construction so failure branches execute on the
 * UI runtime exactly as they do headlessly (GS-ANIMATION-02).
 */
import type { SpriteClip } from '../assets/types';

/** Reject elapsed values the sampler cannot define a frame for. */
function assertFiniteElapsed(elapsedMs: number): void {
  'worklet';
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) {
    throw new Error(
      `sprite clip elapsed time must be a finite number of milliseconds, got ${String(elapsedMs)}`,
    );
  }
}

/** Reject clips with no selectable frame or no positive pace. */
function assertSelectableClip(clip: SpriteClip): number {
  'worklet';
  const frameCount = clip.frames.length;
  const duration = clip.frameDurationMs;
  if (frameCount === 0) {
    throw new Error('sprite clip must reference at least one frame');
  }
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(
      `sprite clip frame duration must be a finite number greater than zero, got ${String(duration)}`,
    );
  }
  return frameCount;
}

/**
 * Select the frame index for `elapsedMs` of playback.
 *
 * Loop clips wrap with modulo — the boundary frame is never duplicated and
 * no zero-length boundary frame exists; negative elapsed wraps into range.
 * One-shot clips clamp to `[0, frameCount - 1]`; completion is reported
 * separately by the playback state.
 */
export function sampleSpriteClipFrame(clip: SpriteClip, elapsedMs: number): number {
  'worklet';
  assertFiniteElapsed(elapsedMs);
  const frameCount = assertSelectableClip(clip);
  const duration = clip.frameDurationMs;
  if (clip.mode === 'loop') {
    const index = Math.floor(elapsedMs / duration) % frameCount;
    return (index + frameCount) % frameCount;
  }
  const index = Math.floor(elapsedMs / duration);
  if (index < 0) {
    return 0;
  }
  return index >= frameCount ? frameCount - 1 : index;
}

/**
 * The frame NAME selected for `elapsedMs` of playback (the ordered frame
 * references of the clip).
 */
export function sampleSpriteClipFrameName(clip: SpriteClip, elapsedMs: number): string {
  'worklet';
  const frames = clip.frames;
  const index = sampleSpriteClipFrame(clip, elapsedMs);
  return frames[index] ?? '';
}

/** Total clip duration in milliseconds (one-shot: its full timeline). */
export function spriteClipDurationMs(clip: SpriteClip): number {
  'worklet';
  return clip.frames.length * clip.frameDurationMs;
}

/**
 * Select the frame name for a clip + elapsed time (loop/once semantics).
 *
 * Reads the descriptor's animation table with the single sampler contract
 * above. An absent clip table entry is an invalid clip — it throws instead
 * of returning the clip string as if it were a frame name. Absent
 * *selection* (no clip chosen yet) is distinct: callers keep that path and
 * present nothing without calling this helper.
 */
export function spriteFrameNameForClip(
  animations: Readonly<
    Record<
      string,
      {
        readonly frames: readonly string[];
        readonly frameDurationMs: number;
        readonly mode: 'loop' | 'once';
      }
    >
  >,
  clip: string,
  elapsedMs: number,
): string {
  'worklet';
  const animation = animations[clip];
  if (animation === undefined) {
    throw new Error(`[ASSET_UNKNOWN_CLIP] unknown animation clip ${JSON.stringify(clip)}`);
  }
  const name = sampleSpriteClipFrameName(animation, elapsedMs);
  if (name === '') {
    throw new Error(`[ASSET_EMPTY_CLIP] clip ${JSON.stringify(clip)} selects no frame`);
  }
  return name;
}
