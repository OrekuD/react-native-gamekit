/**
 * Asset descriptor and manifest types (T7.2).
 *
 * The manifest is the static, deeply immutable declaration of a game's local
 * assets. Group, asset, frame, and clip names are preserved as string
 * literals; retrieval goes through typed descriptor references, never
 * duplicated strings. Sources are static module handles (`number` from
 * `require(...)`) only — string/URL sources are rejected at the type
 * boundary and deliberately have no runtime branch.
 */

/** Static React Native module handle returned by `require(...)`. */
export type AssetSourceHandle = number;

/** A single full-image asset. */
export interface ImageDescriptor {
  /** Discriminant. */
  readonly kind: 'image';
  /** Static module handle. */
  readonly source: AssetSourceHandle;
}

/** A named rectangle inside a sprite sheet, in source pixels. */
export interface SpriteFrameRect {
  /** Left edge in source pixels; non-negative finite number. */
  readonly x: number;
  /** Top edge in source pixels; non-negative finite number. */
  readonly y: number;
  /** Width in source pixels; greater than zero. */
  readonly width: number;
  /** Height in source pixels; greater than zero. */
  readonly height: number;
}

/** Clip playback mode: looping or one-shot. */
export type SpriteAnimationMode = 'loop' | 'once';

/**
 * A named animation clip over a sprite sheet's frames.
 *
 * Frame references are restricted to the sheet's declared frame names and
 * durations are uniform per clip in this version (per-frame durations are
 * deferred so precedence cannot be misunderstood).
 */
export interface SpriteClip<TFrameName extends string = string> {
  /** Ordered frame references; at least one, all declared on the sheet. */
  readonly frames: readonly TFrameName[];
  /** Uniform per-frame duration in milliseconds; finite and greater than zero. */
  readonly frameDurationMs: number;
  /** Discriminated playback mode. */
  readonly mode: SpriteAnimationMode;
}

/** A sprite-sheet asset: named frames plus named animation clips. */
export interface SpriteSheetDescriptor<
  TFrames extends Record<string, SpriteFrameRect> = Record<string, SpriteFrameRect>,
  TClips extends Record<string, SpriteClip<Extract<keyof TFrames, string>>> = Record<
    string,
    SpriteClip<Extract<keyof TFrames, string>>
  >,
> {
  /** Discriminant. */
  readonly kind: 'sprite-sheet';
  /** Static module handle. */
  readonly source: AssetSourceHandle;
  /** Named source rectangles. */
  readonly frames: TFrames;
  /** Named animation clips restricted to the declared frames. */
  readonly animations: TClips;
}

/** Union of all asset descriptors. */
export type AssetDescriptor = ImageDescriptor | SpriteSheetDescriptor;

/** A group of named asset descriptors. */
export type AssetGroup = Readonly<Record<string, AssetDescriptor>>;

/** The author-facing group map accepted by `defineAssets`. */
export type AssetGroupMap = Readonly<Record<string, AssetGroup>>;

/**
 * Type-level manifest brand. Every descriptor of a manifest carries a
 * phantom reference to its originating manifest type, so a loaded store can
 * reject descriptors from any other manifest at compile time.
 */
declare const manifestBrand: unique symbol;

export type BrandedAssetDescriptor<
  TManifest,
  TDescriptor extends AssetDescriptor,
> = { readonly [manifestBrand]?: TManifest } & TDescriptor;

/**
 * The deeply immutable manifest produced by `defineAssets`.
 *
 * Groups and assets keep their literal names; every descriptor is branded
 * with the manifest type so lookups stay typed.
 */
export type GameAssetManifest<TGroups extends AssetGroupMap = AssetGroupMap> = {
  readonly [TGroup in keyof TGroups]: {
    readonly [TAsset in keyof TGroups[TGroup]]: BrandedAssetDescriptor<
      GameAssetManifest<TGroups>,
      TGroups[TGroup][TAsset]
    >;
  };
};

/** The manifest type of a descriptor's originating manifest. */
export type ManifestOf<TDescriptor> =
  TDescriptor extends { readonly [manifestBrand]?: infer TManifest } ? TManifest : never;

/** Loaded-asset lookup keyed by typed descriptor reference. */
export interface LoadedAssets<TManifest> {
  /** The manifest this store was created from. */
  readonly manifest: TManifest;
  /** Retrieve a loaded asset by its typed descriptor reference. */
  readonly get: <TDescriptor extends AssetDescriptor>(
    descriptor: BrandedAssetDescriptor<TManifest, TDescriptor>,
  ) => TDescriptor extends { readonly kind: 'sprite-sheet' }
    ? LoadedSpriteSheet
    : LoadedImage;
}

/** A ready full-image resource. */
export interface LoadedImage {
  /** Logical descriptor this resource was loaded for. */
  readonly descriptor: ImageDescriptor;
  /** Decoded source width in pixels. */
  readonly width: number;
  /** Decoded source height in pixels. */
  readonly height: number;
  /** The decoded image handle (Skia's SkImage satisfies this structurally). */
  readonly image: unknown;
}

/** A ready sprite-sheet resource with validated frame rectangles. */
export interface LoadedSpriteSheet {
  /** Logical descriptor this resource was loaded for. */
  readonly descriptor: SpriteSheetDescriptor;
  /** Validated frames in source pixels (offsets against the decoded image). */
  readonly frames: Readonly<Record<string, SpriteFrameRect>>;
  /** Decoded source width in pixels. */
  readonly width: number;
  /** Decoded source height in pixels. */
  readonly height: number;
  /** The decoded image handle (Skia's SkImage satisfies this structurally). */
  readonly image: unknown;
}

/** A ready, typed, caller-owned lease over loaded asset groups. */
export interface GameAssetLease<TManifest> {
  /** Typed lookup; rejects descriptors from other manifests. */
  readonly assets: LoadedAssets<TManifest>;
  /** Release this lease; idempotent; the final release disposes the image. */
  readonly dispose: () => void;
}
