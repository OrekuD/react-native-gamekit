/**
 * Compile fixture: preferred imports from `rn-gamekit/sprites`.
 */
import {
  advanceSpriteAnimation,
  pauseSpriteAnimation,
  playSpriteAnimation,
  resetSpriteAnimation,
  resumeSpriteAnimation,
  sampleSpriteClipFrame,
  sampleSpriteClipFrameName,
  setSpriteAnimationSpeed,
  spriteClipDurationMs,
  startSpriteAnimation,
  type SpriteAnimationState,
  type SpriteClipNames,
} from 'rn-gamekit/sprites';
import { defineAssets, spriteSheet } from 'rn-gamekit/assets';
import type { SpriteClip } from 'rn-gamekit/assets';

const handle = 42;
const sheet = spriteSheet(handle, {
  frames: { a: { x: 0, y: 0, width: 16, height: 16 }, b: { x: 16, y: 0, width: 16, height: 16 } },
  animations: { idle: { frames: ['a', 'b'], frameDurationMs: 100, mode: 'loop' } },
});
const manifest = defineAssets({ g: { hero: sheet } });
type ClipNames = SpriteClipNames<typeof sheet>;
const _name: ClipNames = 'idle';
void _name;

const clip: SpriteClip = { frames: ['a'], frameDurationMs: 100, mode: 'loop' };
void sampleSpriteClipFrame(clip, 150);
void sampleSpriteClipFrameName(clip, 150);
void spriteClipDurationMs(clip);

const state: SpriteAnimationState<string> = startSpriteAnimation(sheet, 'idle' as const);
void advanceSpriteAnimation(sheet, state, 1 / 60);
void playSpriteAnimation(sheet, state, 'idle' as const);
void pauseSpriteAnimation(state);
void resumeSpriteAnimation(state);
void resetSpriteAnimation(state);
void setSpriteAnimationSpeed(state, 2);
void manifest;
