import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRequire } from 'node:module';

/**
 * Headless root contract (T7.1): importing `react-native-gamekit` must never
 * evaluate Expo, Skia, Reanimated, Worklets, or Gesture Handler modules.
 * The asset manifest types live on this root; the loading/decoding
 * machinery lives on the react entry only.
 */
describe('headless root entry', () => {
  it('importing the root loads no native module', () => {
    const require = createRequire(import.meta.url);
    const nativePatterns = /skia|reanimated|gesture-handler|expo-asset|expo-modules-core/;
    const before = new Set(
      Object.keys(require.cache).filter((id) => nativePatterns.test(id)),
    );

    // The root entry must resolve and expose the asset contract names.
    const root = require('../src/index.ts') as Record<string, unknown>;
    for (const name of [
      'defineAssets',
      'image',
      'spriteSheet',
      'startSpriteAnimation',
      'advanceSpriteAnimation',
      'createGameAssetStore',
    ]) {
      assert.equal(typeof root[name], 'function', `root exports ${name}`);
    }

    const after = Object.keys(require.cache).filter(
      (id) => nativePatterns.test(id) && !before.has(id),
    );
    assert.deepEqual(
      after,
      [],
      `root import pulled in native modules: ${after.join(', ')}`,
    );
  });
});
