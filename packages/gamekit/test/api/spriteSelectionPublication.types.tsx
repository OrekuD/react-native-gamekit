import { Sprite, spriteGroupCorrection, type SpriteAnimatableString } from 'rn-gamekit/react';
import type { LoadedSpriteSheet } from 'rn-gamekit/assets';
import type { SharedValue } from 'react-native-reanimated';

function UnpublishedClip({ source, clip }: {
  readonly source: LoadedSpriteSheet;
  readonly clip: SharedValue<string | undefined>;
}) {
  return <Sprite source={source} clip={clip} elapsedMs={0} />;
}

const staticName: SpriteAnimatableString = 'idle';
void staticName;
void UnpublishedClip;

function InvalidClip({ source }: { readonly source: LoadedSpriteSheet }) {
  // @ts-expect-error clip selection accepts strings, not numeric frame indices
  return <Sprite source={source} clip={1} />;
}
void InvalidClip;

spriteGroupCorrection({ x: 1, y: 2, rotation: 0, flipX: true, flipY: false });
spriteGroupCorrection({
  x: 1, y: 2, rotation: 0, flipX: true, flipY: false, scale: 2,
  anchorX: 0.5, anchorY: 0.5, frameWidth: 16, frameHeight: 24,
});
// @ts-expect-error reflection still requires the flip selection
spriteGroupCorrection({ x: 1, y: 2, rotation: 0 });
