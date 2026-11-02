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
 * edits cannot reach an already-built manifest. Helper-built descriptors
 * retain their identity; structural descriptors are copied by defineAssets.
 * Only documented fields are copied, so extension metadata stays with the
 * author and is never frozen. Look up structural descriptors through the
 * returned manifest, which owns their immutable declaration copies.
 */
import { validateImageSource, validateManifest, validateSpriteSheet } from './validation';
import type {
  AssetDescriptor,
  AssetGroupMap,
  GameAssetManifest,
  ImageDescriptor,
  SpriteClip,
  SpriteFrameRect,
  SpriteSheetDescriptor,
} from './types';

// Only declarations built here are trusted to contain owned, frozen data.
// An externally shallow-frozen descriptor can still have mutable children.
const declarations = new WeakSet<AssetDescriptor>();

/** Declare a single full-image asset from a static module handle. */
export function image(source: number): ImageDescriptor {
  validateImageSource(source);
  const descriptor = Object.freeze({ kind: 'image', source });
  declarations.add(descriptor);
  return descriptor;
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
  const frames = Object.freeze(Object.fromEntries(
    Object.entries(spec.frames).map(([name, rect]) => [name, Object.freeze({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    })]),
  ));
  const animations = Object.freeze(Object.fromEntries(
    Object.entries(spec.animations).map(([name, clip]) => [
      name,
      Object.freeze({
        frames: Object.freeze([...clip.frames]),
        frameDurationMs: clip.frameDurationMs,
        mode: clip.mode,
      }),
    ]),
  ));
  const descriptor = Object.freeze({
    kind: 'sprite-sheet',
    source,
    frames,
    animations,
  });
  declarations.add(descriptor);
  // Runtime validation and canonical copying preserve the typed names and
  // supported field values; Object.fromEntries cannot retain those keys.
  return descriptor as SpriteSheetDescriptor<TFrames, TClips>;
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
  // Preserve aliases within this manifest without retaining mutable input
  // descriptors or changing helper-built reference membership.
  const copies = new Map<AssetDescriptor, AssetDescriptor>();
  const declare = (descriptor: AssetDescriptor): AssetDescriptor => {
    if (declarations.has(descriptor)) return descriptor;
    const existing = copies.get(descriptor);
    if (existing) return existing;
    const copy = descriptor.kind === 'image'
      ? image(descriptor.source)
      : spriteSheet(descriptor.source, descriptor);
    copies.set(descriptor, copy);
    return copy;
  };
  const groupsCopy = Object.fromEntries(Object.entries(groups).map(([group, assets]) => [
    group,
    Object.freeze(Object.fromEntries(Object.entries(assets).map(([name, descriptor]) => [
      name, declare(descriptor),
    ]))),
  ]));
  return Object.freeze(groupsCopy) as GameAssetManifest<TGroups>;
}
