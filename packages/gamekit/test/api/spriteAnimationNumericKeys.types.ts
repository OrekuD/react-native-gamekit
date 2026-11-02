import { defineAssets, spriteSheet } from 'rn-gamekit/assets';
import { startSpriteAnimation, playSpriteAnimation, advanceSpriteAnimation, type SpriteClipNames } from 'rn-gamekit/sprites';

const sheet = spriteSheet(1, {
  frames: { a: { x: 0, y: 0, width: 1, height: 1 } },
  animations: {
    0: { frames: ['a'], frameDurationMs: 100, mode: 'loop' },
    idle: { frames: ['a'], frameDurationMs: 100, mode: 'loop' },
  },
});

const numeric = startSpriteAnimation(sheet, '0');
const advanced = advanceSpriteAnimation(sheet, numeric, 0.05);
playSpriteAnimation(sheet, advanced, 'idle');
const name: SpriteClipNames<typeof sheet> = '0';
void name;
const manifest = defineAssets({ game: { sheet } });
const branded = startSpriteAnimation(manifest.game.sheet, '0');
advanceSpriteAnimation(manifest.game.sheet, branded, 0.05);

// @ts-expect-error runtime clip names are string keys
startSpriteAnimation(sheet, 0);
// @ts-expect-error unknown numeric clip name
startSpriteAnimation(sheet, '1');
// @ts-expect-error unknown string clip name
playSpriteAnimation(sheet, advanced, 'missing');
