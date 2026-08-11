/**
 * Default Expo/Skia asset pipelines (T7.4).
 *
 * Exact primitives used (verified against the installed types, Skia 2.11.0
 * and expo-asset SDK 57):
 * - `Asset.fromModule(source)` -> `await asset.downloadAsync()` ->
 *   `asset.localUri ?? asset.uri` (canonical local URI; static module
 *   handles only);
 * - `Skia.Data.fromURI(uri)` -> `SkData` (disposed as soon as the image is
 *   created — `SkImage.MakeImageFromEncoded` copies the encoded bytes);
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
  const asset = Asset.fromModule(source);
  try {
    await asset.downloadAsync();
  } catch (error) {
    throw new GameAssetError(
      'ASSET_RESOLVE_FAILED',
      [],
      `failed to resolve static asset module ${source}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return asset.localUri ?? asset.uri;
};

const decodePipeline = async (uri: string): Promise<NativeImageHandle> => {
  const data = await Skia.Data.fromURI(uri);
  try {
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (image === null) {
      throw new GameAssetError('ASSET_DECODE_FAILED', [], `decoding ${uri} produced no image`);
    }
    return image as unknown as NativeImageHandle;
  } finally {
    data.dispose();
  }
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
