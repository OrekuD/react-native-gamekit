/**
 * Deterministic clip frame sampling (T7.3).
 *
 * Pure, allocation-free, worklet-compatible frame selection. The same clip
 * metadata and elapsed time always select the same frame, so equivalent
 * game time produces identical presentation at 30/60/90/120 Hz.
 */
import type { SpriteClip } from '../assets/types';

/**
 * Select the frame index for `elapsedMs` of playback.
 *
 * Loop clips wrap with modulo — the boundary frame is never duplicated and
 * no zero-length boundary frame exists. One-shot clips clamp to their final
 * frame; completion is reported separately.
 */
export function sampleSpriteClipFrame(
  clip: SpriteClip,
  elapsedMs: number,
): number {
  'worklet';
  const frameCount = clip.frames.length;
  const duration = clip.frameDurationMs;
  if (clip.mode === 'loop') {
    const index = Math.floor(elapsedMs / duration) % frameCount;
    return index >= 0 ? index : index + frameCount;
  }
  const index = Math.floor(elapsedMs / duration);
  return index >= frameCount ? frameCount - 1 : index;
}

/**
 * The frame NAME selected for `elapsedMs` of playback (the ordered frame
 * references of the clip).
 */
export function sampleSpriteClipFrameName(
  clip: SpriteClip,
  elapsedMs: number,
): string {
  'worklet';
  const frames = clip.frames;
  const index = sampleSpriteClipFrame(clip, elapsedMs);
  const frame = frames[index];
  return frame === undefined ? frames[0] ?? '' : frame;
}

/** Total clip duration in milliseconds (one-shot: its full timeline). */
export function spriteClipDurationMs(clip: SpriteClip): number {
  'worklet';
  return clip.frames.length * clip.frameDurationMs;
}
