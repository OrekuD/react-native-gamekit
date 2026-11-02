import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';
import { defineAssets, image } from '../src/assets/defineAssets';
import { GameAssetError } from '../src/assets/errors';
import type { createGameAssetStore } from '../src/react/assets/decodeSkiaImage';

type Stage = 'module' | 'download' | 'data' | 'image' | 'data-dispose' | 'image-dispose';
let failures: Partial<Record<Stage, unknown>>;
let noImage: boolean;
let dataDisposals: number;
let imageDisposals: number;
let decodedUri: string | undefined;
const nativeFailure = new Error('native failure at /private/device/assets/image.png');
function fail(stage: Stage): void {
  if (Object.hasOwn(failures, stage)) throw failures[stage];
}
const handle = {
  width: () => 16,
  height: () => 32,
  dispose: () => { imageDisposals += 1; fail('image-dispose'); },
};
mock.module('expo-asset', { namedExports: { Asset: {
  fromModule: () => {
    fail('module');
    return {
      localUri: 'file:///private/device/assets/image.png',
      uri: 'asset:/fallback.png',
      downloadAsync: async () => { fail('download'); },
    };
  },
} } });
mock.module('@shopify/react-native-skia', { namedExports: { Skia: {
  Data: { fromURI: async (uri: string) => {
    decodedUri = uri;
    fail('data');
    return { dispose: () => { dataDisposals += 1; fail('data-dispose'); } };
  } },
  Image: { MakeImageFromEncoded: () => { fail('image'); return noImage ? null : handle; } },
} } });

let createStore: typeof createGameAssetStore;
before(async () => {
  createStore = (await import('../src/react/assets/decodeSkiaImage')).createGameAssetStore;
});
beforeEach(() => {
  failures = {};
  noImage = false;
  dataDisposals = 0;
  imageDisposals = 0;
  decodedUri = undefined;
});
const manifest = defineAssets({ boot: { logo: image(1) } });

describe('default Expo/Skia asset pipelines', () => {
  it('releases encoded data after image creation and retains the image until lease release', async () => {
    const store = createStore(manifest);
    const lease = await store.acquire({ groups: ['boot'] });
    assert.equal(decodedUri, 'file:///private/device/assets/image.png');
    assert.equal(dataDisposals, 1);
    assert.equal(imageDisposals, 0);
    assert.equal(lease.assets.get(manifest.boot.logo).image, handle);
    lease.dispose();
    store.dispose();
    assert.equal(imageDisposals, 1);
  });

  for (const stage of ['module', 'download', 'data', 'image'] as const) {
    it(`attributes ${stage} failures without exposing local paths in the summary`, async () => {
      failures[stage] = nativeFailure;
      const store = createStore(manifest);
      await assert.rejects(store.acquire({ groups: ['boot'] }), (error: unknown) => {
        assert.ok(error instanceof GameAssetError);
        assert.equal(error.code, stage === 'module' || stage === 'download' ? 'ASSET_RESOLVE_FAILED' : 'ASSET_DECODE_FAILED');
        assert.equal(error.cause, nativeFailure);
        assert.equal(error.message.includes('/private/'), false);
        return true;
      });
      assert.equal(dataDisposals, stage === 'image' ? 1 : 0);
      assert.equal(imageDisposals, 0);
      store.dispose();
    });
  }

  it('releases encoded data when decoding returns no image', async () => {
    noImage = true;
    const store = createStore(manifest);
    await assert.rejects(store.acquire({ groups: ['boot'] }), (error: unknown) => {
      assert.ok(error instanceof GameAssetError);
      assert.equal(error.code, 'ASSET_DECODE_FAILED');
      assert.equal(error.message.includes('/private/'), false);
      return true;
    });
    assert.equal(dataDisposals, 1);
    assert.equal(imageDisposals, 0);
    store.dispose();
  });

  it('releases an unpublished image if encoded-data cleanup fails', async () => {
    failures['data-dispose'] = nativeFailure;
    const store = createStore(manifest);
    await assert.rejects(store.acquire({ groups: ['boot'] }), (error: unknown) => {
      assert.ok(error instanceof GameAssetError);
      assert.equal(error.code, 'ASSET_DECODE_FAILED');
      assert.equal(error.cause, nativeFailure);
      return true;
    });
    assert.equal(dataDisposals, 1);
    assert.equal(imageDisposals, 1);
    store.dispose();
  });

  it('retains both decode and cleanup failures as causes', async () => {
    failures.image = nativeFailure;
    const cleanupFailure = new Error('data release failed');
    failures['data-dispose'] = cleanupFailure;
    const store = createStore(manifest);
    await assert.rejects(store.acquire({ groups: ['boot'] }), (error: unknown) => {
      assert.ok(error instanceof GameAssetError);
      assert.ok(error.cause instanceof AggregateError);
      assert.deepEqual(error.cause.errors, [nativeFailure, cleanupFailure]);
      return true;
    });
    assert.equal(dataDisposals, 1);
    store.dispose();
  });
});
