/**
 * Asset definition helpers (T7.2).
 *
 * `image(...)` and `spriteSheet(...)` build immutable descriptors;
 * `defineAssets(...)` groups them into a deeply immutable typed manifest.
 * Definition performs no I/O and allocates no native handle.
 *
 * Ownership decision (GS-ASSET-04): declaration helpers CLONE the
 * author-supplied structure and freeze the clone. Caller-owned spec
 * records, frame/clip objects, and group maps are never frozen in place,
 * so one reusable author record can back several declarations and later
 * edits cannot reach an already-built manifest. Descriptor objects are
 * expected from `image(...)`/`spriteSheet(...)` and are shared already
 * immutable; the helpers never take ownership of caller input.
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
  const TFrames extends Record<string, SpriteFrameRect>,
  const TClips extends Record<string, SpriteClip<Extract<keyof TFrames, string>>>,
>(
  source: number,
  spec: {
    readonly frames: TFrames;
    readonly animations: TClips;
  },
): SpriteSheetDescriptor<TFrames, TClips> {
  validateSpriteSheet(source, spec);
  // Clone the author records before freezing: the caller's spec stays
  // owned by the caller and reusable for further declarations.
  const frames = Object.fromEntries(
    Object.entries(spec.frames).map(([name, rect]) => [name, { ...rect }]),
  ) as TFrames;
  const animations = Object.fromEntries(
    Object.entries(spec.animations).map(([name, clip]) => [
      name,
      { ...clip, frames: [...clip.frames] },
    ]),
    // The shape was validated above; the clone preserves every value.
  ) as unknown as TClips;
  const freezer = createDeepFreeze();
  return freezer({
    kind: 'sprite-sheet',
    source,
    frames,
    animations,
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
  // Clone the group/asset maps before freezing: the caller's object stays
  // owned by the caller. Descriptor values are shared — they are expected
  // from image()/spriteSheet() and are already immutable.
  const groupsCopy = Object.fromEntries(
    Object.entries(groups).map(([group, assets]) => [group, { ...assets }]),
  ) as TGroups;
  const freezer = createDeepFreeze();
  return freezer(groupsCopy) as GameAssetManifest<TGroups>;
}
