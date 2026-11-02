import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spriteSheet } from '../src/assets/defineAssets';
import { GameAssetError } from '../src/assets/errors';
import {
  advanceSpriteAnimation,
  playSpriteAnimation,
  resetSpriteAnimation,
  setSpriteAnimationSpeed,
  startSpriteAnimation,
} from '../src/sprites/spriteAnimationState';

const descriptor = spriteSheet(1, {
  frames: { a: { x: 0, y: 0, width: 1, height: 1 } },
  animations: {
    loop: { frames: ['a'], frameDurationMs: 100, mode: 'loop' },
    once: { frames: ['a'], frameDurationMs: 100, mode: 'once' },
  },
});

describe('sprite playback boundary contracts', () => {
  it('accepts a representable scaled delta despite intermediate multiplication overflow', () => {
    const initial = setSpriteAnimationSpeed(startSpriteAnimation(descriptor, 'loop'), Number.MIN_VALUE);
    const advanced = advanceSpriteAnimation(descriptor, initial, Number.MAX_VALUE);
    assert.equal(advanced.elapsedMs, (Number.MAX_VALUE * Number.MIN_VALUE) * 1000);
    assert.ok(advanced.elapsedMs > 0 && Number.isFinite(advanced.elapsedMs));
  });
  it('rejects inherited names in every descriptor-based transition', () => {
    const initial = startSpriteAnimation(descriptor, 'loop');
    for (const clip of ['toString', 'constructor', '__proto__']) {
      const unknown = { ...initial, clip: clip as 'loop' };
      const rejectsUnknown = (action: () => unknown) => assert.throws(action, (error) => {
        assert.ok(error instanceof GameAssetError);
        assert.equal(error.code, 'ASSET_UNKNOWN_CLIP');
        return true;
      });
      rejectsUnknown(() => startSpriteAnimation(descriptor, clip as never));
      rejectsUnknown(() => playSpriteAnimation(descriptor, initial, clip as never));
      rejectsUnknown(() => playSpriteAnimation(descriptor, unknown, clip as never));
      rejectsUnknown(() => advanceSpriteAnimation(descriptor, unknown, 0.01));
      rejectsUnknown(() => advanceSpriteAnimation(descriptor, { ...unknown, paused: true }, 0.01));
    }
  });

  it('accepts own clip names that also exist on Object.prototype', () => {
    const named = spriteSheet(1, {
      frames: descriptor.frames,
      animations: { toString: descriptor.animations.loop },
    });
    const state = startSpriteAnimation(named, 'toString');
    assert.equal(advanceSpriteAnimation(named, state, 0.025).elapsedMs, 25);
  });

  it('rejects arithmetic overflow rather than publishing an invalid or completed state', () => {
    for (const clip of ['loop', 'once'] as const) {
      const initial = startSpriteAnimation(descriptor, clip);
      for (const delta of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
        assert.throws(() => advanceSpriteAnimation(descriptor, initial, delta), /finite.*milliseconds/);
      }
      const fast = setSpriteAnimationSpeed(initial, Number.MAX_VALUE);
      assert.throws(() => advanceSpriteAnimation(descriptor, fast, 1), /finite.*milliseconds/);
      assert.equal(initial.elapsedMs, 0);
      assert.equal(initial.completed, false);
    }
  });

  it('rejects non-finite elapsed accumulation even when the scaled delta is finite', () => {
    const large = spriteSheet(1, {
      frames: descriptor.frames,
      animations: { loop: { ...descriptor.animations.loop, frameDurationMs: Number.MAX_VALUE } },
    });
    const state = { ...startSpriteAnimation(large, 'loop'), elapsedMs: Number.MAX_VALUE / 2 };
    assert.throws(() => advanceSpriteAnimation(large, state, Number.MAX_VALUE / 1000), /finite.*milliseconds/);
  });

  it('validates externally authored playback time and speed before advancing', () => {
    const initial = startSpriteAnimation(descriptor, 'loop');
    for (const elapsedMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assert.throws(() => advanceSpriteAnimation(descriptor, { ...initial, elapsedMs }, 0.01), /elapsed.*finite.*non-negative/);
    }
    for (const speed of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      assert.throws(() => advanceSpriteAnimation(descriptor, { ...initial, speed }, 0.01), /speed.*finite/);
    }
  });

  it('preserves identity when the resulting playback record is unchanged', () => {
    const initial = Object.freeze(startSpriteAnimation(descriptor, 'loop'));
    assert.equal(advanceSpriteAnimation(descriptor, initial, 0), initial);
    assert.equal(advanceSpriteAnimation(descriptor, initial, -1), initial);
    assert.equal(advanceSpriteAnimation(descriptor, initial, 0.1), initial);
    assert.equal(resetSpriteAnimation(initial), initial);
    const once = startSpriteAnimation(descriptor, 'once');
    assert.equal(advanceSpriteAnimation(descriptor, once, 0), once);
    const completed = advanceSpriteAnimation(descriptor, once, 1);
    assert.notEqual(resetSpriteAnimation(completed), completed);
  });

  it('rewinds active playback but preserves paused and completed states', () => {
    const initial = startSpriteAnimation(descriptor, 'once');
    const advanced = advanceSpriteAnimation(descriptor, initial, 0.075);
    assert.equal(advanceSpriteAnimation(descriptor, advanced, -0.025).elapsedMs, 50);
    assert.equal(advanceSpriteAnimation(descriptor, advanced, -0.1).elapsedMs, 0);
    const paused = { ...advanced, paused: true };
    assert.equal(advanceSpriteAnimation(descriptor, paused, Number.MAX_VALUE), paused);
    const completed = advanceSpriteAnimation(descriptor, advanced, 1);
    assert.equal(advanceSpriteAnimation(descriptor, completed, -1), completed);
  });
});
