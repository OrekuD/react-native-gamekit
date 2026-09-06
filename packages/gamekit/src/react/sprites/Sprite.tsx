/**
 * `Sprite` — the retained sprite primitive (T7.6).
 *
 * Renders one full-image sprite or one sprite-sheet frame through a
 * source-verified Skia path: full images use `<Image>`; sheet frames use a
 * single-entry Atlas (the RSXform carries rotation + position, a wrapping
 * Group applies the scale/flip part around the anchor). All animatable
 * properties accept plain numbers or Reanimated shared/derived values
 * without mirroring them through React state. Drawing order is React child
 * order. The sprite never subscribes React to the game frame.
 */
import { useMemo } from 'react';
import { Atlas, Group, type SkImage, type SamplingOptions } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { useRectBuffer, useRSXformBuffer } from '@shopify/react-native-skia';

import type { LoadedImage, LoadedSpriteSheet } from '../../assets/types';
import {
  computeSpriteRsxform,
  spriteGroupCorrection,
} from './spriteTransform';
import {
  applySpriteFrameSelection,
  materializeSpriteSelection,
  selectSpriteFrameRect,
} from './spriteSelection';

export { resolveSpriteFrameRect, type SpriteFrameRect } from './spriteTransform';

export type SpriteAnimatable = number | SharedValue<number>;
export type SpriteAnimatableBoolean = boolean | SharedValue<boolean>;
export type SpriteAnimatableString = string | SharedValue<string>;

export interface SpriteProps {
  /** The loaded asset; the renderer borrows and never disposes it. */
  readonly source: LoadedImage | LoadedSpriteSheet;
  /** Frame name for sprite sheets; ignored for full images. A shared value
   * may carry undefined while the selection has not been published. */
  readonly frame?: SpriteAnimatableString | SharedValue<string | undefined>;
  /** Clip name for sprite sheets; the frame is selected from it. */
  readonly clip?: SpriteAnimatableString;
  /** Elapsed milliseconds within the clip (frame selection). */
  readonly elapsedMs?: SpriteAnimatable;
  /** World position in logical units. */
  readonly x?: SpriteAnimatable;
  readonly y?: SpriteAnimatable;
  /** Rotation in radians around the anchor. */
  readonly rotation?: SpriteAnimatable;
  /** Uniform scale around the anchor. */
  readonly scale?: SpriteAnimatable;
  /** Normalized anchor in [0, 1] relative to the selected frame. */
  readonly anchor?: { readonly x: number; readonly y: number };
  /** Explicit flips preserve the anchor. */
  readonly flipX?: SpriteAnimatableBoolean;
  readonly flipY?: SpriteAnimatableBoolean;
  /** Opacity in [0, 1]. */
  readonly opacity?: SpriteAnimatable;
  /** Optional tint color applied to the draw. */
  readonly tint?: string;
  /** Sampling for the texture; pixel-art defaults to nearest. */
  readonly sampling?: SamplingOptions;
  /** Hide the sprite without unmounting it. */
  readonly visible?: SpriteAnimatableBoolean;
}

export function Sprite({
  source,
  frame,
  clip,
  elapsedMs = 0,
  x = 0,
  y = 0,
  rotation = 0,
  scale = 1,
  anchor = { x: 0, y: 0 },
  flipX = false,
  flipY = false,
  opacity = 1,
  tint,
  sampling,
  visible = true,
}: SpriteProps) {
  const image = source.image as SkImage;

  // Worklet-safe frame resolution: an explicit `frame` wins; otherwise the
  // clip + elapsed time select the frame (the clip/elapsed may be animated
  // shared values, so the resolution happens inside the rect modifier).
  // The arithmetic lives in the shared selection contract — this modifier
  // only adapts props into it (GS-ANIMATION-01).
  const resolveFrameRectWorklet = (
    rect: { setXYWH(x: number, y: number, width: number, height: number): void },
  ): void => {
    'worklet';
    const clipValue = typeof clip === 'string' ? clip : clip?.value;
    const elapsedValue = typeof elapsedMs === 'number' ? elapsedMs : elapsedMs?.value;
    const name: string | undefined = typeof frame === 'string' ? frame : frame?.value;
    applySpriteFrameSelection(rect, source, {
      ...(name === undefined ? {} : { frame: name }),
      ...(clipValue === undefined ? {} : { clip: clipValue }),
      ...(elapsedValue === undefined ? {} : { elapsedMs: elapsedValue }),
    });
  };

  const rects = useRectBuffer(1, resolveFrameRectWorklet);
  const xforms = useRSXformBuffer(1, (xform) => {
    'worklet';
    // GS-SPRITE-03: the same shared selection the rect modifier resolves,
    // so clip-driven frame changes reach the anchor math with current
    // dimensions. Absent selection draws nothing; its transform is finite.
    const resolved = selectSpriteFrameRect(
      source,
      materializeSpriteSelection(frame, clip, elapsedMs),
    );
    const result = computeSpriteRsxform({
      x,
      y,
      rotation,
      scale,
      flipX,
      flipY,
      anchorX: anchor.x,
      anchorY: anchor.y,
      frameWidth: resolved?.width ?? 0,
      frameHeight: resolved?.height ?? 0,
    });
    xform.set(result.scos, result.ssin, result.tx, result.ty);
  });
  // GS-SPRITE-01: the correction depends on position, rotation, scale,
  // flips, and the live frame dimensions, so it is derived on the UI
  // runtime from live values — never memoized from React-render reads.
  const groupTransform = useDerivedValue(() => {
    const resolved = selectSpriteFrameRect(
      source,
      materializeSpriteSelection(frame, clip, elapsedMs),
    );
    return spriteGroupCorrection({
      x,
      y,
      rotation,
      scale,
      flipX,
      flipY,
      anchorX: anchor.x,
      anchorY: anchor.y,
      frameWidth: resolved?.width ?? 0,
      frameHeight: resolved?.height ?? 0,
    });
  }, [x, y, rotation, scale, flipX, flipY, frame, clip, elapsedMs, source, anchor.x, anchor.y]);
  const colors = useMemo(() => (tint === undefined ? undefined : [tint]), [tint]);

  // The Skia Group has no `visible` prop: hiding is expressed as a combined
  // opacity so the component stays mounted (topology is never remounted per
  // frame) while the draw is fully transparent. RF4: derived on the UI
  // runtime for every static/shared combination of opacity and visible.
  const effectiveOpacity = useDerivedValue(() => {
    'worklet';
    const o = typeof opacity === 'number' ? opacity : opacity.value;
    const v = typeof visible === 'boolean' ? visible : visible.value;
    return v ? o : 0;
  }, [opacity, visible]);

  return (
    <Group transform={groupTransform as never} opacity={effectiveOpacity}>
      <Atlas
        image={image}
        sprites={rects}
        transforms={xforms}
        colors={colors as never}
        sampling={(sampling ?? 'nearest') as never}
      />
    </Group>
  );
}
