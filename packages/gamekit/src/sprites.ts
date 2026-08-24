/**
 * Subpath entry for `rn-gamekit/sprites`.
 *
 * Deterministic sprite-clip sampling and immutable playback-state helpers.
 * React components (Sprite, GameSprite, SpriteBatch) remain in `rn-gamekit/react`.
 */
export {
  sampleSpriteClipFrame,
  sampleSpriteClipFrameName,
  spriteClipDurationMs,
} from './sprites/sampleSpriteClip';
export {
  advanceSpriteAnimation,
  pauseSpriteAnimation,
  playSpriteAnimation,
  resetSpriteAnimation,
  resumeSpriteAnimation,
  setSpriteAnimationSpeed,
  startSpriteAnimation,
} from './sprites/spriteAnimationState';
export type { SpriteAnimationState, SpriteClipNames } from './sprites/spriteAnimationState';
