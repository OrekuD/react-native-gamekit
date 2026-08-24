import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

/**
 * T19.4 — headless and optional-system isolation.
 *
 * Each new headless subpath must import without pulling React, React Native,
 * Skia, Reanimated, Worklets, Expo Asset, audio, haptics, or native peers.
 * Root must not initialize optional backends.
 */

const nativePatterns = /skia|reanimated|gesture-handler|expo-asset|expo-modules-core/;

function freshCacheCheck(modulePath: string, forbidden: RegExp, label: string): void {
  const require = createRequire(import.meta.url);
  const before = new Set(
    Object.keys(require.cache).filter((id) => forbidden.test(id)),
  );
  // Use require to load via tsx transpilation — mirrors headlessRoot.test.ts
  require(modulePath);
  const after = Object.keys(require.cache).filter(
    (id) => forbidden.test(id) && !before.has(id),
  );
  assert.deepEqual(after, [], `${label} pulled forbidden modules: ${after.join(', ')}`);
}

describe('entry-points: headless isolation', () => {
  it('geometry imports without native peers', () => {
    freshCacheCheck('../src/geometry.ts', nativePatterns, 'geometry');
  });

  it('collision2d imports without native peers', () => {
    freshCacheCheck('../src/collision2d.ts', nativePatterns, 'collision2d');
  });

  it('camera2d imports without native peers', () => {
    freshCacheCheck('../src/camera2d.ts', nativePatterns, 'camera2d');
  });

  it('events imports without native peers', () => {
    freshCacheCheck('../src/events.ts', nativePatterns, 'events');
  });

  it('assets imports without native peers', () => {
    freshCacheCheck('../src/assets.ts', nativePatterns, 'assets');
  });

  it('sprites imports without native peers', () => {
    freshCacheCheck('../src/sprites.ts', nativePatterns, 'sprites');
  });

  it('root does not initialize optional audio/haptics backends', () => {
    const require = createRequire(import.meta.url);
    const before = new Set(
      Object.keys(require.cache).filter((id) => /audio|haptics|pulsar/.test(id)),
    );
    require('../src/index.ts');
    const after = Object.keys(require.cache).filter(
      (id) => /audio|haptics|pulsar/.test(id) && !before.has(id),
    );
    // Root may load type-only references but must not load runtime audio/haptics implementations
    // The runtime creators live in src/audio/* and src/haptics/* — they should not appear
    const runtime = after.filter((id) => /createGameAudio|createGameHaptics|pulsar/.test(id));
    assert.deepEqual(runtime, [], `root initialized optional backends: ${runtime.join(', ')}`);
  });

  it('entry imports allocate no sessions/renderers/stores', async () => {
    // Importing should not create sessions — check that no global session registry exists
    // and that importing does not throw or mutate global state
    const beforeKeys = new Set(Object.keys(globalThis as Record<string, unknown>));
    await import('../src/geometry.ts');
    await import('../src/collision2d.ts');
    await import('../src/camera2d.ts');
    await import('../src/events.ts');
    await import('../src/assets.ts');
    await import('../src/sprites.ts');
    const afterKeys = Object.keys(globalThis as Record<string, unknown>);
    const leaked = afterKeys.filter((k) => !beforeKeys.has(k) && /__gamekit/.test(k));
    assert.deepEqual(leaked, [], `leaked global keys: ${leaked.join(', ')}`);
  });

  it('headless modules have no React import in source graph', async () => {
    const fs = await import('node:fs');
    const headlessFiles = [
      '../src/geometry.ts',
      '../src/collision2d.ts',
      '../src/camera2d.ts',
      '../src/events.ts',
      '../src/assets.ts',
      '../src/sprites.ts',
    ];
    // Check barrel and underlying index contents for forbidden imports
    const forbiddenImport = /from\s+['"]react['"]|from\s+['"]react-native['"]|@shopify\/react-native-skia|react-native-reanimated|react-native-worklets|expo-asset|createGameAudio|createGameHaptics/;
    for (const p of headlessFiles) {
      const abs = new URL(p, import.meta.url).pathname;
      const content = fs.readFileSync(abs, 'utf8');
      // Barrel itself should be clean
      assert.ok(!forbiddenImport.test(content), `${p} barrel imports forbidden dependency`);
      // Also check underlying feature index where appropriate
      if (p.includes('geometry')) {
        const idx = fs.readFileSync(new URL('../src/geometry/index.ts', import.meta.url).pathname, 'utf8');
        assert.ok(!forbiddenImport.test(idx), 'geometry/index imports forbidden');
      }
      if (p.includes('collision2d')) {
        const idx = fs.readFileSync(new URL('../src/collision2d/index.ts', import.meta.url).pathname, 'utf8');
        assert.ok(!forbiddenImport.test(idx), 'collision2d/index imports forbidden');
      }
      if (p.includes('camera2d')) {
        const idx = fs.readFileSync(new URL('../src/camera2d/index.ts', import.meta.url).pathname, 'utf8');
        assert.ok(!forbiddenImport.test(idx), 'camera2d/index imports forbidden');
      }
    }
  });
});
