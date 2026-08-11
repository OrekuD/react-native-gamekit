/**
 * Sprite transform math (T7.6).
 *
 * Pure, worklet-compatible. A sprite's frame occupies
 * `[0, 0, frameWidth, frameHeight]` in local space and the documented pivot
 * order is:
 *
 *   M = T(x, y) · R(rotation) · T(anchor) · S(scaleX, scaleY) · T(-anchor)
 *
 * i.e. scale and explicit flips happen around the anchor, then the frame
 * rotates around the anchor at the world position. The RSXform carries the
 * rotation + position (its 2x2 cannot express flips or non-uniform scale);
 * the wrapping Group applies the scale/flip part around the anchor.
 */
import type { SharedValue } from 'react-native-reanimated';

/** A sprite's presentation input; numbers or UI-runtime animated values. */
export interface SpriteTransformInput {
  /** World position in logical units. */
  readonly x: number | SharedValue<number>;
  readonly y: number | SharedValue<number>;
  /** Rotation in radians around the anchor. */
  readonly rotation: number | SharedValue<number>;
  /** Uniform scale around the anchor. */
  readonly scale: number | SharedValue<number>;
  /** Explicit flips preserve the anchor. */
  readonly flipX: boolean | SharedValue<boolean>;
  readonly flipY: boolean | SharedValue<boolean>;
  /** Normalized anchor in [0, 1] relative to the selected frame. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** Selected frame size in source pixels (logical units for placement). */
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/** The computed RSXform (rotation + position, pivot-compensated). */
export interface SpriteRsxform {
  readonly scos: number;
  readonly ssin: number;
  readonly tx: number;
  readonly ty: number;
}

/** A Skia-compatible 3x3 transform element list. */
export type SkiaTransformElement =
  | { readonly translateX: number }
  | { readonly translateY: number }
  | { readonly scaleX: number }
  | { readonly scaleY: number };

function readNumber(value: number | SharedValue<number>): number {
  'worklet';
  return typeof value === 'number' ? value : value.value;
}

function readBoolean(value: boolean | SharedValue<boolean>): boolean {
  'worklet';
  return typeof value === 'boolean' ? value : value.value;
}

/**
 * The RSXform for the atlas path: rotation + position with the pivot
 * compensated (`tx = x - pivotX·cos + pivotY·sin`). Scale and flips are
 * applied by the wrapping Group (`spriteGroupCorrection`).
 */
export function computeSpriteRsxform(input: SpriteTransformInput): SpriteRsxform {
  'worklet';
  const x = readNumber(input.x);
  const y = readNumber(input.y);
  const rotation = readNumber(input.rotation);
  const pivotX = input.anchorX * input.frameWidth;
  const pivotY = input.anchorY * input.frameHeight;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    scos: cos,
    ssin: sin,
    tx: x - pivotX * cos + pivotY * sin,
    ty: y - pivotX * sin - pivotY * cos,
  };
}

/**
 * The scale/flip part around the anchor as a Skia transform element list:
 * `T(anchor) · S(scaleX, scaleY) · T(-anchor)` (the first element is the
 * outermost).
 */
export function spriteGroupCorrection(input: SpriteTransformInput): readonly SkiaTransformElement[] {
  'worklet';
  const scale = readNumber(input.scale);
  const flipX = readBoolean(input.flipX);
  const flipY = readBoolean(input.flipY);
  const pivotX = input.anchorX * input.frameWidth;
  const pivotY = input.anchorY * input.frameHeight;
  return [
    { translateX: pivotX },
    { translateY: pivotY },
    { scaleX: flipX ? -scale : scale },
    { scaleY: flipY ? -scale : scale },
    { translateX: -pivotX },
    { translateY: -pivotY },
  ];
}

/** World position of the anchor point (for debugging and overlays). */
export function spriteAnchorWorld(input: SpriteTransformInput): {
  readonly x: number;
  readonly y: number;
} {
  'worklet';
  return {
    x: readNumber(input.x),
    y: readNumber(input.y),
  };
}
