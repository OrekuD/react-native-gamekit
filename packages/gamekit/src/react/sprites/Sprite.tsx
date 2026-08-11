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

import type { LoadedImage, LoadedSpriteSheet, SpriteFrameRect } from '../../assets/types';
import {
  computeSpriteRsxform,
  spriteGroupCorrection,
  type SpriteTransformInput,
} from './spriteTransform';

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

/** Resolve the source rectangle for a frame selection. */
export function resolveSpriteFrameRect(
  source: LoadedImage | LoadedSpriteSheet,
  frame: string | undefined,
): SpriteFrameRect {
  if (source.descriptor.kind === 'image') {
    const image = source as LoadedImage;
    return { x: 0, y: 0, width: image.width, height: image.height };
  }
  const sheet = source as LoadedSpriteSheet;
  const rect = frame === undefined ? undefined : sheet.frames[frame];
  if (rect === undefined) {
    throw new Error(
      `frame ${JSON.stringify(frame)} does not belong to this sprite sheet (loaded frames: ${Object.keys(sheet.frames).join(', ')})`,
    );
  }
  return rect;
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
  const resolveFrameRectWorklet = (
    rect: { setXYWH(x: number, y: number, width: number, height: number): void },
  ): void => {
    'worklet';
    const clipValue = typeof clip === 'string' ? clip : clip?.value;
    const elapsedValue = typeof elapsedMs === 'number' ? elapsedMs : elapsedMs?.value;
    let name: string | undefined = typeof frame === 'string' ? frame : frame?.value;
    if (name === undefined && source.descriptor.kind === 'sprite-sheet' && clipValue !== undefined) {
      const sheet = source as LoadedSpriteSheet;
      // R3: resolve the clip through the descriptor's animation table, then
      // the returned frame name through the frame rectangles below.
      const animation = sheet.descriptor.animations[clipValue];
      if (animation !== undefined && animation.frames.length > 0) {
        const duration = animation.frameDurationMs;
        const count = animation.frames.length;
        const index =
          animation.mode === 'once'
            ? Math.min(Math.floor((elapsedValue ?? 0) / duration), count - 1)
            : Math.floor((elapsedValue ?? 0) / duration) % count;
        name = animation.frames[index] ?? animation.frames[0];
      }
    }
    const frameRect =
      source.descriptor.kind === 'image'
        ? { x: 0, y: 0, width: (source as LoadedImage).width, height: (source as LoadedImage).height }
        : name === undefined
          ? undefined
          : (source as LoadedSpriteSheet).frames[name];
    if (frameRect === undefined) {
      if (name === undefined) {
        // RF4: the selection has not been published yet (scene mismatch or a
        // shared frame before its first value): present nothing, never throw.
        rect.setXYWH(0, 0, 0, 0);
        return;
      }
      throw new Error(
        `frame ${JSON.stringify(name)} does not belong to this sprite sheet (loaded frames: ${Object.keys((source as LoadedSpriteSheet).frames).join(', ')})`,
      );
    }
    rect.setXYWH(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
  };

  const staticFrame = typeof frame === 'string' ? frame : undefined;
  const frameSize = useMemo(() => resolveSpriteFrameRect(source, staticFrame), [source, staticFrame]);
  const input: SpriteTransformInput = {
    x,
    y,
    rotation,
    scale,
    flipX,
    flipY,
    anchorX: anchor.x,
    anchorY: anchor.y,
    frameWidth: frameSize.width,
    frameHeight: frameSize.height,
  };

  const rects = useRectBuffer(1, resolveFrameRectWorklet);
  const xforms = useRSXformBuffer(1, (xform) => {
    'worklet';
    // RF4: resolve the selected frame's rectangle and dimensions in the same
    // worklet update so the anchor math always uses the current frame size.
    const name = typeof frame === 'string' ? frame : frame?.value;
    let width = frameSize.width;
    let height = frameSize.height;
    if (name !== undefined && source.descriptor.kind === 'sprite-sheet') {
      const rect = (source as LoadedSpriteSheet).frames[name];
      if (rect !== undefined) {
        width = rect.width;
        height = rect.height;
      }
    }
    const result = computeSpriteRsxform({
      ...input,
      frameWidth: width,
      frameHeight: height,
    });
    xform.set(result.scos, result.ssin, result.tx, result.ty);
  });
  const groupTransform = useMemo(
    () => spriteGroupCorrection(input) as unknown as Parameters<typeof Group>[0]['transform'],
    // The correction reads animated values at draw time; the element list
    // identity is stable (values are shared-value reads inside the group).
    [anchor.x, anchor.y, frameSize.width, frameSize.height],
  );
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
