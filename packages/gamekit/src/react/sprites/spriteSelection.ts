/**
 * Shared sprite frame selection (GS-ANIMATION-01).
 *
 * The single headless selection contract behind `Sprite`'s rect modifier
 * and `GameSprite`'s frame-name derivation: an explicit frame wins,
 * otherwise clip + elapsed time resolve through the pure sampler. Absent
 * selection (nothing chosen yet) presents nothing without throwing;
 * invalid clips and frames fail clearly instead of masking bad data.
 *
 * Headless-safe: only type imports plus the pure sampler, so the same
 * functions execute identically in tests and on the UI runtime. Every
 * function carries the worklet directive for UI execution; the reachable
 * call graph is plain arithmetic plus plain `Error` construction
 * (GS-ANIMATION-02).
 */
import type { LoadedImage, LoadedSpriteSheet } from '../../assets/types';
import type { SpriteFrameRect } from './spriteTransform';
import { spriteFrameNameForClip } from '../../sprites/sampleSpriteClip';
import type { SharedValue } from 'react-native-reanimated';

/** A static value or a UI-runtime shared value carrying it. Shared-value
 * payloads list both the exact and the undefined-extended shapes because
 * shared values are invariant in their payload. */
export type SpriteSelectable<T> = T | SharedValue<T>;

/** Selection props as the Sprite/GameSprite call sites declare them. */
export type SpriteFrameProp =
  | string
  | SharedValue<string>
  | SharedValue<string | undefined>
  | undefined;
export type SpriteClipProp = string | SharedValue<string> | undefined;

/** The discrete selection inputs for one sprite (all optional). */
export interface SpriteSelection {
  /** The exact frame name; overrides clip + elapsedMs. */
  readonly frame?: string;
  /** The clip to select from the sprite sheet. */
  readonly clip?: string;
  /** Elapsed time within the clip in milliseconds. */
  readonly elapsedMs?: number;
}

/**
 * Resolve the source rectangle for a selection.
 *
 * Returns `undefined` for absent selection (present nothing); throws for
 * unknown clips and frames.
 */
export function selectSpriteFrameRect(
  source: LoadedImage | LoadedSpriteSheet,
  selection: SpriteSelection,
): SpriteFrameRect | undefined {
  'worklet';
  if (source.descriptor.kind === 'image') {
    const image = source as LoadedImage;
    return { x: 0, y: 0, width: image.width, height: image.height };
  }
  const sheet = source as LoadedSpriteSheet;
  let name = selection.frame;
  if (name === undefined) {
    if (selection.clip === undefined) {
      return undefined;
    }
    name = spriteFrameNameForClip(
      sheet.descriptor.animations,
      selection.clip,
      selection.elapsedMs ?? 0,
    );
  }
  const rect = sheet.frames[name];
  if (rect === undefined) {
    throw new Error(
      `frame ${JSON.stringify(name)} does not belong to this sprite sheet (loaded frames: ${Object.keys(sheet.frames).join(', ')})`,
    );
  }
  return rect;
}

/**
 * Materialize mixed static/shared selection props into one plain selection
 * (GS-SPRITE-03): every worklet that resolves frames — rect, transform, and
 * Group correction — starts from this single helper, so clip-driven frame
 * changes reach every consumer coherently.
 */
export function materializeSpriteSelection(
  frame: SpriteFrameProp,
  clip: SpriteClipProp,
  elapsedMs: SpriteSelectable<number> | undefined,
): SpriteSelection {
  'worklet';
  const selection: {
    frame?: string;
    clip?: string;
    elapsedMs?: number;
  } = {};
  const frameValue = typeof frame === 'string' ? frame : frame?.value;
  if (frameValue !== undefined) {
    selection.frame = frameValue;
  }
  const clipValue = typeof clip === 'string' ? clip : clip?.value;
  if (clipValue !== undefined) {
    selection.clip = clipValue;
  }
  const elapsedValue = typeof elapsedMs === 'number' ? elapsedMs : elapsedMs?.value;
  if (elapsedValue !== undefined) {
    selection.elapsedMs = elapsedValue;
  }
  return selection;
}

/** A Skia rect-buffer entry (structural: only `setXYWH` is used). */
export interface SpriteRectBuffer {
  setXYWH(x: number, y: number, width: number, height: number): void;
}

/**
 * Apply a selection to a rect-buffer entry: the component callback logic
 * behind `Sprite`'s modifier, executed here so tests observe it directly.
 */
export function applySpriteFrameSelection(
  rect: SpriteRectBuffer,
  source: LoadedImage | LoadedSpriteSheet,
  selection: SpriteSelection,
): void {
  'worklet';
  const resolved = selectSpriteFrameRect(source, selection);
  if (resolved === undefined) {
    rect.setXYWH(0, 0, 0, 0);
    return;
  }
  rect.setXYWH(resolved.x, resolved.y, resolved.width, resolved.height);
}
