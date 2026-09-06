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
