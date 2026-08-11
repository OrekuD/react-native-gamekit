/**
 * Asset definition helpers (T7.2).
 *
 * `image(...)` and `spriteSheet(...)` build immutable descriptors;
 * `defineAssets(...)` groups them into a deeply immutable typed manifest.
 * Definition performs no I/O and allocates no native handle.
 */
import { createDeepFreeze } from '../core/session/deepFreeze';
import { validateImageSource, validateManifest, validateSpriteSheet } from './validation';
import type {
  AssetGroupMap,
  GameAssetManifest,
  ImageDescriptor,
  SpriteClip,
  SpriteFrameRect,
  SpriteSheetDescriptor,
} from './types';

/** Declare a single full-image asset from a static module handle. */
export function image(source: number): ImageDescriptor {
  validateImageSource(source);
  return Object.freeze({ kind: 'image', source });
}

/**
 * Declare a sprite-sheet asset: named source frames plus named animation
 * clips. Frame and clip names are preserved as string literals; clip frame
 * references are restricted to the declared frames.
 */
export function spriteSheet<
  TFrames extends Record<string, SpriteFrameRect>,
  TClips extends Record<string, SpriteClip<Extract<keyof TFrames, string>>>,
>(
  source: number,
  spec: {
    readonly frames: TFrames;
    readonly animations: TClips;
  },
): SpriteSheetDescriptor<TFrames, TClips> {
  validateSpriteSheet(source, spec);
  const freezer = createDeepFreeze();
  return freezer({
    kind: 'sprite-sheet',
    source,
    frames: spec.frames,
    animations: spec.animations,
  }) as SpriteSheetDescriptor<TFrames, TClips>;
}

/**
 * Declare the game's asset manifest: a deeply immutable, fully typed group
 * map. Group, asset, frame, and clip names are preserved as string literals
 * and every descriptor is branded with the manifest type so lookups stay
 * typed. Allocates no native resources and performs no I/O.
 */
export function defineAssets<TGroups extends AssetGroupMap>(
  groups: TGroups,
): GameAssetManifest<TGroups> {
  validateManifest(groups);
  const freezer = createDeepFreeze();
  return freezer(groups) as GameAssetManifest<TGroups>;
}
