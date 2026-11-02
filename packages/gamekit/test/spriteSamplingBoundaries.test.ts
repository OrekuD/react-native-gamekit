import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defineAssets, spriteSheet } from '../src/assets/defineAssets';
import { GameAssetError } from '../src/assets/errors';
import type { SpriteClip } from '../src/assets/types';
import {
  sampleSpriteClipFrame,
  sampleSpriteClipFrameName,
  spriteClipDurationMs,
  spriteFrameNameForClip,
} from '../src/sprites/sampleSpriteClip';

const clip: SpriteClip = { frames: ['a', 'b', 'c'], frameDurationMs: 100, mode: 'loop' };

describe('sprite sampling numeric and lookup boundaries', () => {
  it('reduces huge loop times before quotient precision loses frame selection', () => {
    const fast: SpriteClip = { frames: ['a', 'b', 'c', 'd'], frameDurationMs: 0.1, mode: 'loop' };
    assert.equal(sampleSpriteClipFrame(fast, 1e16), 2);
    assert.equal(sampleSpriteClipFrameName(fast, 1e16), 'c');
    assert.equal(sampleSpriteClipFrame({ ...fast, frames: ['a', 'b'] }, 900719925474098.1), 0);
  });

  it('keeps tiny negative offsets on the final frame even when division underflows', () => {
    assert.equal(sampleSpriteClipFrame(clip, -Number.MIN_VALUE), 2);
    assert.equal(sampleSpriteClipFrame(clip, -0), 0);
    assert.equal(sampleSpriteClipFrame(clip, -300), 0);
  });
  it('keeps finite elapsed samples in range when elapsed/duration overflows', () => {
    const tiny = { ...clip, frameDurationMs: Number.MIN_VALUE };
    for (const elapsed of [1, -1, Number.MAX_VALUE, -Number.MAX_VALUE]) {
      const index = sampleSpriteClipFrame(tiny, elapsed);
      assert.ok(Number.isInteger(index) && index >= 0 && index < 3);
      assert.equal(sampleSpriteClipFrameName(tiny, elapsed), tiny.frames[index]);
    }
    assert.equal(sampleSpriteClipFrame(tiny, Number.MIN_VALUE), 1);
    assert.equal(sampleSpriteClipFrame(tiny, -Number.MIN_VALUE), 2);
  });

  it('rejects a total timeline that overflows before it reaches playback', () => {
    const enormous = { ...clip, frameDurationMs: Number.MAX_VALUE };
    assert.throws(() => sampleSpriteClipFrame(enormous, 0), /finite.*duration|duration.*finite/);
    assert.throws(() => spriteClipDurationMs(enormous), /finite.*duration|duration.*finite/);
    const spec = { frames: { a: { x: 0, y: 0, width: 1, height: 1 } }, animations: {
      idle: { frames: ['a', 'a'] as const, frameDurationMs: Number.MAX_VALUE, mode: 'loop' as const },
    } };
    assert.throws(() => spriteSheet(1, spec), (error: unknown) => {
      assert.ok(error instanceof GameAssetError);
      assert.equal(error.code, 'ASSET_INVALID_DURATION');
      assert.deepEqual(error.path, ['animations', 'idle', 'frameDurationMs']);
      return true;
    });
    assert.throws(() => defineAssets({ play: { hero: { kind: 'sprite-sheet', source: 1, ...spec } } }),
      (error: unknown) => {
        assert.ok(error instanceof GameAssetError);
        assert.deepEqual(error.path, ['play', 'hero', 'animations', 'idle', 'frameDurationMs']);
        return true;
      });
  });

  it('validates raw clips consistently across duration and frame helpers', () => {
    const invalid = [null, { ...clip, frames: 'abc' }, { ...clip, frames: [] },
      { ...clip, frameDurationMs: 0 }, { ...clip, frameDurationMs: Infinity },
      { ...clip, mode: 'bounce' }];
    for (const value of invalid) {
      assert.throws(() => sampleSpriteClipFrame(value as SpriteClip, 0));
      assert.throws(() => spriteClipDurationMs(value as SpriteClip));
    }
  });

  it('does not mask a missing selected frame as an empty frame name', () => {
    const sparse: SpriteClip = { ...clip, frames: new Array<string>(3) };
    assert.throws(() => sampleSpriteClipFrameName(sparse, 100), /frame/);
  });

  it('treats inherited names as unknown clips while allowing own prototype-like names', () => {
    for (const name of ['toString', 'constructor', '__proto__']) {
      assert.throws(() => spriteFrameNameForClip({ idle: clip }, name, 0), /ASSET_UNKNOWN_CLIP/);
      assert.equal(spriteFrameNameForClip({ [name]: clip }, name, 100), 'b');
    }
    assert.equal(spriteFrameNameForClip(Object.assign(Object.create(null), { idle: clip }), 'idle', 100), 'b');
  });
});
