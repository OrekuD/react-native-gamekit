/**
 * Compile fixture: preferred imports from `rn-gamekit/assets`.
 */
import {
  defineAssets,
  GameAssetError,
  image,
  spriteSheet,
  type AssetDescriptor,
  type AssetGroup,
  type AssetGroupMap,
  type AssetSourceHandle,
  type BrandedAssetDescriptor,
  type GameAssetLease,
  type GameAssetManifest,
  type ImageDescriptor,
  type LoadedAssets,
  type LoadedImage,
  type LoadedSpriteSheet,
  type ManifestOf,
  type SpriteAnimationMode,
  type SpriteClip,
  type SpriteFrameRect,
  type SpriteSheetDescriptor,
  type GameAssetErrorCode,
} from 'rn-gamekit/assets';

const handle: AssetSourceHandle = 42;
const img: ImageDescriptor = image(handle);
const sheet: SpriteSheetDescriptor = spriteSheet(handle, {
  frames: { a: { x: 0, y: 0, width: 32, height: 32 } },
  animations: { idle: { frames: ['a'], frameDurationMs: 100, mode: 'loop' } },
});
void img;
void sheet;

const manifest = defineAssets({
  g: {
    logo: image(handle),
    hero: spriteSheet(handle, {
      frames: { idle: { x: 0, y: 0, width: 16, height: 16 } },
      animations: { idle: { frames: ['idle'], frameDurationMs: 100, mode: 'loop' } },
    }),
  },
});
void manifest;

type _Desc = AssetDescriptor;
type _Group = AssetGroup;
type _GroupMap = AssetGroupMap;
type _Manifest = GameAssetManifest;
type _Lease = GameAssetLease<typeof manifest>;
type _Loaded = LoadedAssets<typeof manifest>;
type _LoadedImage = LoadedImage;
type _LoadedSheet = LoadedSpriteSheet;
type _ManifestOf = ManifestOf<typeof sheet>;
type _Mode = SpriteAnimationMode;
type _Clip = SpriteClip;
type _Rect = SpriteFrameRect;
type _Branded = BrandedAssetDescriptor<typeof manifest, ImageDescriptor>;
void null as unknown as _Desc;
void null as unknown as _Group;
void null as unknown as _GroupMap;
void null as unknown as _Manifest;
void null as unknown as _Lease;
void null as unknown as _Loaded;
void null as unknown as _LoadedImage;
void null as unknown as _LoadedSheet;
void null as unknown as _ManifestOf;
void null as unknown as _Mode;
void null as unknown as _Clip;
void null as unknown as _Rect;
void null as unknown as _Branded;

const err = new GameAssetError('ASSET_INVALID_SOURCE', [], 'bad');
const code: GameAssetErrorCode = 'ASSET_INVALID_SOURCE';
void err;
void code;
