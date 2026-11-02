import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defineAssets, image, spriteSheet } from '../src/assets/defineAssets';
import { GameAssetError } from '../src/assets/errors';
import type { AssetGroupMap } from '../src/assets/types';

const rect = { x: 0, y: 0, width: 8, height: 8 };
const clip = { frames: ['idle' as const], frameDurationMs: 100, mode: 'loop' as const };
const runtimeSheet = (spec: unknown) =>
  spriteSheet(1, spec as Parameters<typeof spriteSheet>[1]);
const runtimeManifest = (groups: unknown) => defineAssets(groups as AssetGroupMap);

function assetError(code: GameAssetError['code'], path: readonly string[]) {
  return (error: unknown) => {
    assert.ok(error instanceof GameAssetError);
    assert.equal(error.code, code);
    assert.deepEqual(error.path, path);
    return true;
  };
}

describe('asset definition boundaries', () => {
  for (const value of [null, undefined, 1, 'assets', []]) {
    it(`rejects a malformed manifest (${String(value)})`, () => {
      assert.throws(() => runtimeManifest(value), assetError('ASSET_INVALID_IDENTIFIER', []));
    });
    it(`rejects a malformed group (${String(value)})`, () => {
      assert.throws(() => runtimeManifest({ boot: value }), assetError('ASSET_INVALID_IDENTIFIER', ['boot']));
    });
    it(`rejects a malformed sheet spec (${String(value)})`, () => {
      assert.throws(() => runtimeSheet(value), assetError('ASSET_INVALID_IDENTIFIER', []));
    });
    it(`rejects a malformed frame table (${String(value)})`, () => {
      assert.throws(() => runtimeSheet({ frames: value, animations: {} }), assetError('ASSET_INVALID_FRAME_RECT', ['frames']));
    });
    it(`rejects a malformed animation table (${String(value)})`, () => {
      assert.throws(() => runtimeSheet({ frames: {}, animations: value }), assetError('ASSET_EMPTY_CLIP', ['animations']));
    });
    it(`rejects a malformed frame (${String(value)})`, () => {
      assert.throws(() => runtimeSheet({ frames: { idle: value }, animations: {} }), assetError('ASSET_INVALID_FRAME_RECT', ['frames', 'idle']));
    });
    it(`rejects a malformed clip (${String(value)})`, () => {
      assert.throws(() => runtimeSheet({ frames: { idle: rect }, animations: { idle: value } }), assetError('ASSET_EMPTY_CLIP', ['animations', 'idle']));
    });
  }

  for (const frames of [null, undefined, {}, { 0: 'idle', length: 1 }, new Set(['idle']), [], 'idle']) {
    it('requires a nonempty array of clip frame names', () => {
      assert.throws(() => runtimeSheet({ frames: { idle: rect }, animations: { idle: { ...clip, frames } } }), assetError('ASSET_EMPTY_CLIP', ['animations', 'idle']));
    });
  }

  for (const name of ['toString', 'constructor', '__proto__']) {
    it(`rejects an inherited frame name (${name})`, () => {
      assert.throws(() => runtimeSheet({ frames: { idle: rect }, animations: { idle: { ...clip, frames: [name] } } }), assetError('ASSET_UNKNOWN_FRAME', ['animations', 'idle', 'frames']));
    });
  }

  it('rejects a nonenumerable frame omitted by declaration copying', () => {
    const frames = Object.defineProperty({}, 'hidden', { value: rect, enumerable: false });
    assert.throws(() => runtimeSheet({ frames, animations: { idle: { ...clip, frames: ['hidden'] } } }), assetError('ASSET_UNKNOWN_FRAME', ['animations', 'idle', 'frames']));
  });

  for (const name of [1n, Symbol('frame'), Object.create(null), { toJSON() { throw new Error('must not serialize'); } }]) {
    it('reports invalid frame references without serializing caller values', () => {
      assert.throws(() => runtimeSheet({ frames: { idle: rect }, animations: { idle: { ...clip, frames: [name] } } }), assetError('ASSET_UNKNOWN_FRAME', ['animations', 'idle', 'frames']));
    });
  }

  it('accepts explicitly declared prototype-like names and null-prototype tables', () => {
    const frames = Object.assign(Object.create(null), { toString: rect });
    const sheet = runtimeSheet({ frames, animations: { idle: { ...clip, frames: ['toString'] } } });
    assert.deepEqual(sheet.frames.toString, rect);
  });

  it('retains complete manifest paths for nested validation errors', () => {
    assert.throws(() => runtimeManifest({ boot: { logo: { kind: 'image', source: -1 } } }), assetError('ASSET_INVALID_SOURCE', ['boot', 'logo', 'source']));
    assert.throws(() => runtimeManifest({ play: { hero: { kind: 'sprite-sheet', source: 1, frames: { idle: null }, animations: {} } } }), assetError('ASSET_INVALID_FRAME_RECT', ['play', 'hero', 'frames', 'idle']));
    assert.throws(() => runtimeManifest({ play: { hero: { kind: 'sprite-sheet', source: 1, frames: { idle: rect }, animations: { idle: { ...clip, frameDurationMs: 0 } } } } }), assetError('ASSET_INVALID_DURATION', ['play', 'hero', 'animations', 'idle', 'frameDurationMs']));
  });
});

describe('canonical asset declaration ownership', () => {
  it('copies only supported frame and clip fields without freezing extension metadata', () => {
    const metadata = { label: 'caller-owned' };
    const spec = { frames: { idle: { ...rect, metadata } }, animations: { idle: { ...clip, metadata } } };
    const sheet = spriteSheet(1, spec);
    assert.equal(Object.isFrozen(metadata), false);
    assert.deepEqual(sheet.frames.idle, rect);
    assert.deepEqual(sheet.animations.idle, clip);
    assert.ok(Object.isFrozen(sheet.frames.idle));
    assert.ok(Object.isFrozen(sheet.animations.idle.frames));
  });

  it('snapshots structural descriptors while retaining helper descriptor identity', () => {
    const helper = image(1);
    const metadata = { label: 'caller-owned' };
    const raw = { kind: 'image' as const, source: 2, metadata };
    const sheet = { kind: 'sprite-sheet' as const, source: 3, frames: { idle: { ...rect } }, animations: { idle: { ...clip } } };
    const manifest = defineAssets({ boot: { helper, raw, sheet }, again: { raw } });
    assert.equal(manifest.boot.helper, helper);
    assert.notEqual(manifest.boot.raw, raw);
    assert.equal(manifest.boot.raw, manifest.again.raw, 'one snapshot per raw descriptor per manifest');
    assert.deepEqual(manifest.boot.raw, { kind: 'image', source: 2 });
    assert.equal(Object.isFrozen(raw), false);
    assert.equal(Object.isFrozen(metadata), false);
    assert.equal(Object.isFrozen(sheet), false);
    assert.equal(Object.isFrozen(sheet.frames.idle), false);
    assert.equal(Object.isFrozen(sheet.animations.idle.frames), false);
    raw.source = 9;
    sheet.frames.idle.width = 99;
    sheet.animations.idle.frames.push('idle');
    assert.equal(manifest.boot.raw.source, 2);
    assert.equal(manifest.boot.sheet.frames.idle.width, 8);
    assert.deepEqual(manifest.boot.sheet.animations.idle.frames, ['idle']);
    assert.ok(Object.isFrozen(manifest.boot.sheet.frames.idle));
  });
});
