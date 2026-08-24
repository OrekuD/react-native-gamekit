/**
 * Subpath entry for `rn-gamekit/assets`.
 *
 * Asset manifest definitions and public descriptor types — no React hooks,
 * Skia decoding, or Expo Asset acquisition.
 */
export { defineAssets, image, spriteSheet } from './assets/defineAssets';
export { GameAssetError } from './assets/errors';
export type { GameAssetErrorCode } from './assets/errors';
export type {
  AssetDescriptor,
  AssetGroup,
  AssetGroupMap,
  AssetSourceHandle,
  BrandedAssetDescriptor,
  GameAssetLease,
  GameAssetManifest,
  ImageDescriptor,
  LoadedAssets,
  LoadedImage,
  LoadedSpriteSheet,
  ManifestOf,
  SpriteAnimationMode,
  SpriteClip,
  SpriteFrameRect,
  SpriteSheetDescriptor,
} from './assets/types';
