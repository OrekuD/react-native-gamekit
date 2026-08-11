import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRequire } from 'node:module';

/**
 * Headless root contract (T7.1): importing `react-native-gamekit` must never
 * evaluate Expo, Skia, Reanimated, Worklets, or Gesture Handler modules.
 * The asset manifest types live on this root (their presence is asserted by
 * the T7.2-accepted fixtures in `test/api/`); the loading/decoding machinery
 * lives on the react entry only. This test stays green even while the
 * contract fixtures are intentionally red.
 */
describe('headless root entry', () => {
  it('importing the root loads no native module', () => {
    const require = createRequire(import.meta.url);
    const nativePatterns = /skia|reanimated|gesture-handler|expo-asset|expo-modules-core/;
    const before = new Set(
      Object.keys(require.cache).filter((id) => nativePatterns.test(id)),
    );

    // The root entry resolves without evaluating native modules.
    require('../src/index.ts');

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
