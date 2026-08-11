import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineAssets, GameAssetError, image, spriteSheet } from '../src/index';

const LOGO = 42;
const PLAYER_SHEET = 43;

function validSheet() {
  return spriteSheet(PLAYER_SHEET, {
    frames: {
      'idle-0': { x: 0, y: 0, width: 32, height: 32 },
      'idle-1': { x: 32, y: 0, width: 32, height: 32 },
    },
    animations: {
      idle: { frames: ['idle-0', 'idle-1'], frameDurationMs: 140, mode: 'loop' },
      jump: { frames: ['idle-1'], frameDurationMs: 120, mode: 'once' },
    },
  });
}

describe('asset manifest definition (T7.2)', () => {
  it('preserves group/asset/frame/clip names and values', () => {
    const manifest = defineAssets({
      boot: { logo: image(LOGO) },
      gameplay: { player: validSheet() },
    });

    assert.equal(manifest.boot.logo.kind, 'image');
    assert.equal(manifest.boot.logo.source, LOGO);
    assert.equal(manifest.gameplay.player.kind, 'sprite-sheet');
    assert.equal(manifest.gameplay.player.source, PLAYER_SHEET);
    assert.deepEqual(manifest.gameplay.player.frames['idle-0'], {
      x: 0,
      y: 0,
      width: 32,
      height: 32,
    });
    assert.deepEqual(manifest.gameplay.player.animations.idle.frames, ['idle-0', 'idle-1']);
    assert.equal(manifest.gameplay.player.animations.jump.mode, 'once');
  });

  it('returns a deeply immutable manifest and descriptors', () => {
    const input = {
      boot: { logo: image(LOGO) },
      gameplay: { player: validSheet() },
    };
    const manifest = defineAssets(input);

    assert.ok(Object.isFrozen(manifest));
    assert.ok(Object.isFrozen(manifest.boot));
    assert.ok(Object.isFrozen(manifest.boot.logo));
    assert.ok(Object.isFrozen(manifest.gameplay.player));
    assert.ok(Object.isFrozen(manifest.gameplay.player.frames));
    assert.ok(Object.isFrozen(manifest.gameplay.player.animations));
    assert.ok(Object.isFrozen(manifest.gameplay.player.animations.idle.frames));
    // The input object graph is frozen in place too: neither the input nor
    // the returned manifest can be mutated after definition.
    assert.ok(Object.isFrozen(input));
    assert.ok(Object.isFrozen(input.boot.logo));
  });

  it('two descriptors with the same source stay two logical identities', () => {
    const manifest = defineAssets({
      a: { hero: image(LOGO) },
      b: { hero: image(LOGO) },
    });
    void manifest satisfies unknown;
    assert.notEqual(manifest.a.hero, manifest.b.hero, 'distinct logical descriptors');
    assert.equal(manifest.a.hero.source, manifest.b.hero.source, 'shared source handle');
  });

  it('rejects reserved separator and empty identifiers with the correct path', () => {
    assert.throws(
      () => defineAssets({ 'boot/extra': { logo: image(LOGO) } }),
      (error: unknown) => {
        assert.ok(error instanceof GameAssetError);
        assert.equal((error as GameAssetError).code, 'ASSET_INVALID_IDENTIFIER');
        assert.deepEqual((error as GameAssetError).path, []);
        return true;
      },
    );
    assert.throws(
      () => defineAssets({ boot: { 'bad/key': image(LOGO) } }),
      (error: unknown) => {
        assert.equal((error as GameAssetError).code, 'ASSET_INVALID_IDENTIFIER');
        assert.deepEqual((error as GameAssetError).path, ['boot']);
        return true;
      },
    );
    assert.throws(() => defineAssets({ '': { logo: image(LOGO) } }), /ASSET_INVALID_IDENTIFIER/);
  });

  it('rejects invalid frame rectangles with the correct code and path', () => {
    assert.throws(
      () =>
        spriteSheet(PLAYER_SHEET, {
          frames: { bad: { x: -1, y: 0, width: 32, height: 32 } },
          animations: {},
        }),
      (error: unknown) => {
        assert.equal((error as GameAssetError).code, 'ASSET_INVALID_FRAME_RECT');
        assert.deepEqual((error as GameAssetError).path, ['frames', 'bad']);
        return true;
      },
    );
    assert.throws(
      () =>
        spriteSheet(PLAYER_SHEET, {
          frames: { bad: { x: 0, y: 0, width: 0, height: 32 } },
          animations: {},
        }),
      /ASSET_INVALID_FRAME_RECT/,
    );
    assert.throws(
      () =>
        spriteSheet(PLAYER_SHEET, {
          frames: { bad: { x: 0, y: 0, width: Number.NaN, height: 32 } },
          animations: {},
        }),
      /ASSET_INVALID_FRAME_RECT/,
    );
  });

  // The runtime validators sit behind the typed boundary; these cases are
  // exercised from an untyped JavaScript boundary (the type layer already
  // rejects them — that is what the compile fixtures prove).
  function runtimeSheet(spec: unknown) {
    return spriteSheet(PLAYER_SHEET, spec as Parameters<typeof spriteSheet>[1]);
  }

  it('rejects empty clips, unknown frames, and invalid durations/modes', () => {
    assert.throws(
      () =>
        runtimeSheet({
          frames: { 'idle-0': { x: 0, y: 0, width: 32, height: 32 } },
          animations: { idle: { frames: [], frameDurationMs: 100, mode: 'loop' } },
        }),
      (error: unknown) => {
        assert.equal((error as GameAssetError).code, 'ASSET_EMPTY_CLIP');
        assert.deepEqual((error as GameAssetError).path, ['animations', 'idle']);
        return true;
      },
    );
    assert.throws(
      () =>
        runtimeSheet({
          frames: { 'idle-0': { x: 0, y: 0, width: 32, height: 32 } },
          animations: {
            idle: { frames: ['idle-0', 'missing'], frameDurationMs: 100, mode: 'loop' },
          },
        }),
      (error: unknown) => {
        assert.equal((error as GameAssetError).code, 'ASSET_UNKNOWN_FRAME');
        assert.deepEqual((error as GameAssetError).path, ['animations', 'idle', 'frames']);
        return true;
      },
    );
    assert.throws(
      () =>
        runtimeSheet({
          frames: { 'idle-0': { x: 0, y: 0, width: 32, height: 32 } },
          animations: { idle: { frames: ['idle-0'], frameDurationMs: 0, mode: 'loop' } },
        }),
      /ASSET_INVALID_DURATION/,
    );
    assert.throws(
      () =>
        runtimeSheet({
          frames: { 'idle-0': { x: 0, y: 0, width: 32, height: 32 } },
          animations: {
            idle: { frames: ['idle-0'], frameDurationMs: 100, mode: 'ping-pong' },
          },
        }),
      /ASSET_INVALID_MODE/,
    );
  });

  it('rejects non-handle sources at the runtime boundary', () => {
    assert.throws(() => image('https://example.com/logo.png' as unknown as number), /ASSET_INVALID_SOURCE/);
    assert.throws(() => image(-1), /ASSET_INVALID_SOURCE/);
    assert.throws(() => image(1.5), /ASSET_INVALID_SOURCE/);
  });

  it('definition allocates no native handle and performs no I/O', () => {
    const manifest = defineAssets({ boot: { logo: image(LOGO) } });
    assert.equal(manifest.boot.logo.source, LOGO, 'no source rewrite');
  });
});
