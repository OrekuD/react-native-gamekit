import type { LoadedImage, LoadedSpriteSheet } from '../../assets/types';

/** The resolved source rectangle for one frame selection. */
export interface SpriteFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Resolve the source rectangle for a static frame selection.
 *
 * RF4: an absent selection (the dynamic clip/elapsed mode before its first
 * value) presents nothing instead of throwing. The static baseline uses the
 * sheet's first frame so the anchor/scale correction has sane dimensions
 * while the per-frame worklet resolves the real selection.
 */
export function resolveSpriteFrameRect(
  source: LoadedImage | LoadedSpriteSheet,
  frame: string | undefined,
): SpriteFrameRect {
  if (source.descriptor.kind === 'image') {
    const image = source as LoadedImage;
    return { x: 0, y: 0, width: image.width, height: image.height };
  }
  const sheet = source as LoadedSpriteSheet;
  if (frame === undefined) {
    const firstAnimationName = Object.keys(sheet.descriptor.animations)[0];
    const firstAnimation =
      firstAnimationName === undefined
        ? undefined
        : sheet.descriptor.animations[firstAnimationName];
    const firstFrameName = firstAnimation?.frames[0];
    const baseline =
      firstFrameName === undefined ? undefined : sheet.frames[firstFrameName];
    return baseline ?? { x: 0, y: 0, width: 0, height: 0 };
  }
  const rect = sheet.frames[frame];
  if (rect === undefined) {
    throw new Error(
      `frame ${JSON.stringify(frame)} does not belong to this sprite sheet (loaded frames: ${Object.keys(sheet.frames).join(', ')})`,
    );
  }
  return rect;
}

/**
 * Sprite transform math (T7.6).
 *
 * Pure, worklet-compatible. A sprite's frame occupies
 * `[0, 0, frameWidth, frameHeight]` in local space and the documented pivot
 * order is:
 *
 *   M = T(x, y) · R(rotation) · S(scaleX, scaleY) · T(-anchor)
 *
 * i.e. uniform scale and explicit flips happen around the anchor in the
 * local frame, then the frame rotates around the anchor at the world
 * position. The invariant: the anchor maps to `(x, y)` under every scale,
 * rotation, and flip (GS-SPRITE-01).
 *
 * Split across Skia's retained primitives (the Atlas RSXform is innermost,
 * the wrapping Group is outermost): the RSXform carries `T·R·S` with the
 * pivot pre-compensated, so no-flip sprites need no Group transform at
 * all; reflection — which an RSXform cannot express — is isolated in the
 * Group as a mirror that fixes the world anchor
 * (`T(x,y)·R·F·R⁻¹·T(−x,−y)`).
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

/** A Skia-compatible 3x3 transform element list (rotation in radians). */
export type SkiaTransformElement =
  | { readonly translateX: number }
  | { readonly translateY: number }
  | { readonly scaleX: number }
  | { readonly scaleY: number }
  | { readonly rotate: number };

function readNumber(value: number | SharedValue<number>): number {
  'worklet';
  return typeof value === 'number' ? value : value.value;
}

function readBoolean(value: boolean | SharedValue<boolean>): boolean {
  'worklet';
  return typeof value === 'boolean' ? value : value.value;
}

/**
 * The RSXform for the atlas path: `T(x,y)·R·S` with the pivot
 * pre-compensated (`t = p − s·R·pivot`), so the anchor lands exactly on
 * `(x, y)` (GS-SPRITE-01/02). Uniform scale is encoded in the
 * coefficients; the batch path shares this helper and needs no Group.
 */
export function computeSpriteRsxform(input: SpriteTransformInput): SpriteRsxform {
  'worklet';
  const x = readNumber(input.x);
  const y = readNumber(input.y);
  const rotation = readNumber(input.rotation);
  const scale = readNumber(input.scale);
  const pivotX = input.anchorX * input.frameWidth;
  const pivotY = input.anchorY * input.frameHeight;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    scos: scale * cos,
    ssin: scale * sin,
    tx: x - scale * (pivotX * cos - pivotY * sin),
    ty: y - scale * (pivotX * sin + pivotY * cos),
  };
}

/**
 * The reflection part as a Skia transform element list, outermost first.
 *
 * Without flips the RSXform alone carries the transform, so the correction
 * is empty (identity). With flips it is the anchor-fixing mirror
 * `T(x,y)·R·F·R⁻¹·T(−x,−y)`: mirroring about the rotated anchor axes while
 * the world anchor stays fixed. Depends on position and rotation (not just
 * the pivot), so callers must derive it on the UI runtime from live values
 * — never memoize it from stale React-render reads (GS-SPRITE-01).
 */
export function spriteGroupCorrection(input: SpriteTransformInput): readonly SkiaTransformElement[] {
  'worklet';
  const flipX = readBoolean(input.flipX);
  const flipY = readBoolean(input.flipY);
  if (!flipX && !flipY) {
    return [];
  }
  const x = readNumber(input.x);
  const y = readNumber(input.y);
  const rotation = readNumber(input.rotation);
  return [
    { translateX: x },
    { translateY: y },
    { rotate: rotation },
    { scaleX: flipX ? -1 : 1 },
    { scaleY: flipY ? -1 : 1 },
    { rotate: -rotation },
    { translateX: -x },
    { translateY: -y },
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
