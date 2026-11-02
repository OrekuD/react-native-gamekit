import { defineAssets, spriteSheet } from '../../src/assets/defineAssets';

const spec = {
  frames: { idle: { x: 0, y: 0, width: 8, height: 8, metadata: { label: 'author' } } },
  animations: { idle: { frames: ['idle' as const], frameDurationMs: 100, mode: 'loop' as const, metadata: { label: 'author' } } },
};
const sheet = spriteSheet(1, spec);
// @ts-expect-error returned frame rectangles are readonly even for mutable specs
sheet.frames.idle.x = 2;
// @ts-expect-error returned frame maps are readonly
sheet.frames.idle = spec.frames.idle;
// @ts-expect-error returned animation frame lists are readonly
sheet.animations.idle.frames.push('idle');
// @ts-expect-error returned clips are readonly
sheet.animations.idle.frameDurationMs = 2;
// @ts-expect-error extensions are author data, not part of a declared frame
void sheet.frames.idle.metadata;
// @ts-expect-error extensions are author data, not part of a declared clip
void sheet.animations.idle.metadata;

const manifest = defineAssets({ boot: { sheet, raw: { kind: 'image' as const, source: 1, metadata: 'author' } } });
// @ts-expect-error manifests expose canonical descriptors without extension metadata
void manifest.boot.raw.metadata;
// @ts-expect-error manifest frames are deeply readonly
manifest.boot.sheet.frames.idle.width = 3;

const frameName: keyof typeof sheet.frames = 'idle';
const mode: 'loop' = sheet.animations.idle.mode;
const frame: 'idle' | undefined = sheet.animations.idle.frames[0];
void frameName;
void mode;
void frame;
// Author records remain mutable and reusable.
spec.frames.idle.width = 2;
spec.animations.idle.frames.push('idle');
