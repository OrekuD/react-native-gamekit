/**
 * Default Expo/Skia asset pipelines (T7.4).
 *
 * Exact primitives used (verified against the installed types, Skia 2.11.0
 * and expo-asset SDK 57):
 * - `Asset.fromModule(source)` -> `await asset.downloadAsync()` ->
 *   `asset.localUri ?? asset.uri` (canonical local URI; static module
 *   handles only);
 * - `Skia.Data.fromURI(uri)` -> `SkData` (its wrapper is disposed after image
 *   creation; the native factory accepts reference-counted SkData);
 * - `Skia.Image.MakeImageFromEncoded(data)` -> `SkImage | null` (null is a
 *   structured load failure, never a ready resource).
 */
import { Asset } from 'expo-asset';
import { Skia } from '@shopify/react-native-skia';

import { GameAssetError } from '../../assets/errors';
import type { AssetGroupMap } from '../../assets/types';
import {
  createGameAssetStoreCore,
  type NativeImageHandle,
} from './createGameAssetStore';

const resolvePipeline = async (source: number): Promise<string> => {
  try {
    const asset = Asset.fromModule(source);
    await asset.downloadAsync();
    return asset.localUri ?? asset.uri;
  } catch (error) {
    throw new GameAssetError(
      'ASSET_RESOLVE_FAILED',
      [],
      `failed to resolve static asset module ${source}`,
      { cause: error },
    );
  }
};

/** Preserve the original failure even if releasing an unpublished resource fails. */
function failDecode(error: unknown, resource?: { dispose(): void }): never {
  let cause = error;
  try {
    resource?.dispose();
  } catch (cleanupError) {
    cause = new AggregateError([error, cleanupError], 'Image decoding and cleanup failed');
  }
  throw new GameAssetError('ASSET_DECODE_FAILED', [], 'failed to decode static image', { cause });
}

const decodePipeline = async (uri: string): Promise<NativeImageHandle> => {
  let data;
  try {
    data = await Skia.Data.fromURI(uri);
  } catch (error) {
    return failDecode(error);
  }
  let image;
  try {
    image = Skia.Image.MakeImageFromEncoded(data);
    if (image === null) {
      throw new Error('decoding produced no image');
    }
  } catch (error) {
    return failDecode(error, data);
  }
  try {
    data.dispose();
  } catch (error) {
    return failDecode(error, image);
  }
  return image;
};

/**
 * Create the explicit asset-store owner for a manifest using the default
 * Expo/Skia pipelines. Callers dispose the lease then the store in
 * `finally`.
 */
export function createGameAssetStore<TManifest extends AssetGroupMap>(
  manifest: TManifest,
) {
  // The return type keeps the manifest generic so leases stay typed.
  return createGameAssetStoreCore(manifest, {
    resolve: resolvePipeline,
    decode: decodePipeline,
  });
}
