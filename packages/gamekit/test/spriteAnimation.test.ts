import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { spriteSheet } from '../src/index';
import {
  advanceSpriteAnimation,
  pauseSpriteAnimation,
  playSpriteAnimation,
  resetSpriteAnimation,
  resumeSpriteAnimation,
  setSpriteAnimationSpeed,
  startSpriteAnimation,
} from '../src/index';
import {
  sampleSpriteClipFrame,
  sampleSpriteClipFrameName,
  spriteClipDurationMs,
} from '../src/index';

const SHEET = 43;

function sheet() {
  return spriteSheet(SHEET, {
    frames: {
      'idle-0': { x: 0, y: 0, width: 32, height: 32 },
      'idle-1': { x: 32, y: 0, width: 32, height: 32 },
      'idle-2': { x: 64, y: 0, width: 32, height: 32 },
    },
    animations: {
      idle: { frames: ['idle-0', 'idle-1', 'idle-2'], frameDurationMs: 100, mode: 'loop' },
      pop: { frames: ['idle-0', 'idle-1', 'idle-2'], frameDurationMs: 100, mode: 'once' },
      single: { frames: ['idle-1'], frameDurationMs: 250, mode: 'loop' },
    },
  });
}

describe('clip frame sampling (T7.3)', () => {
  it('selects frames exactly before, at, and after every boundary', () => {
    const idle = sheet().animations.idle;
    // 100 ms per frame.
    assert.equal(sampleSpriteClipFrame(idle, 0), 0, 'at 0');
    assert.equal(sampleSpriteClipFrame(idle, 99.999), 0, 'just before the first boundary');
    assert.equal(sampleSpriteClipFrame(idle, 100), 1, 'at the first boundary');
    assert.equal(sampleSpriteClipFrame(idle, 100.001), 1, 'just after the first boundary');
    assert.equal(sampleSpriteClipFrame(idle, 199.999), 1, 'just before the second boundary');
    assert.equal(sampleSpriteClipFrame(idle, 200), 2, 'at the second boundary');
    assert.equal(sampleSpriteClipFrame(idle, 299.999), 2, 'just before the loop point');
    assert.equal(sampleSpriteClipFrame(idle, 300), 0, 'loops back to frame 0 exactly');
  });

  it('looping wraps without a duplicate or zero-length boundary frame', () => {
    const idle = sheet().animations.idle;
    for (let ms = 0; ms <= 3000; ms += 1) {
      const frame = sampleSpriteClipFrame(idle, ms);
      assert.ok(frame >= 0 && frame <= 2, `frame ${frame} in range at ${ms}ms`);
    }
    assert.equal(sampleSpriteClipFrame(idle, 300), 0, 'the loop point is frame 0, not a duplicate');
    assert.equal(sampleSpriteClipFrame(idle, 301), 0, '1 ms into the second loop is still frame 0');
    assert.equal(sampleSpriteClipFrame(idle, 400), 1, 'the second loop reaches frame 1 at 400');
  });

  it('one-shot clips hold their final frame and report completion', () => {
    const pop = sheet().animations.pop;
    assert.equal(sampleSpriteClipFrame(pop, 0), 0);
    assert.equal(sampleSpriteClipFrame(pop, 299.999), 2, 'final frame');
    assert.equal(sampleSpriteClipFrame(pop, 300), 2, 'holds the final frame');
    assert.equal(sampleSpriteClipFrame(pop, 10_000), 2, 'holds forever');
    assert.equal(sampleSpriteClipFrameName(pop, 10_000), 'idle-2');
  });

  it('a single-frame clip is stable for all elapsed values', () => {
    const single = sheet().animations.single;
    for (const ms of [0, 249.999, 250, 251, 10_000, 1_000_000]) {
      assert.equal(sampleSpriteClipFrame(single, ms), 0);
      assert.equal(sampleSpriteClipFrameName(single, ms), 'idle-1');
    }
  });

  it('uniform durations produce the documented timeline', () => {
    const idle = sheet().animations.idle;
    assert.equal(spriteClipDurationMs(idle), 300);
    assert.equal(sampleSpriteClipFrameName(idle, 100), 'idle-1');
    assert.equal(sampleSpriteClipFrameName(idle, 200), 'idle-2');
  });

  it('equivalent elapsed time produces identical frames at any Hz schedule', () => {
    const idle = sheet().animations.idle;
    // 1.234 seconds of game time at 30/60/90/120 Hz presentation.
    const schedules = [30, 60, 90, 120];
    const frames = schedules.map((hz) => {
      const step = 1 / hz;
      const steps = Math.round(1.234 / step);
      return sampleSpriteClipFrame(idle, steps * step * 1000);
    });
    assert.equal(new Set(frames).size, 1, 'all schedules select the same frame');
  });
});

describe('animation playback state (T7.3)', () => {
  it('advances elapsed time and never mutates the input state', () => {
    const descriptor = sheet();
    const initial = startSpriteAnimation(descriptor, 'idle');
    const advanced = advanceSpriteAnimation(descriptor, initial, 0.25);
    assert.equal(initial.elapsedMs, 0, 'input state unchanged');
    assert.equal(advanced.elapsedMs, 250, '0.25 s at speed 1');
    assert.equal(advanced.clip, 'idle');
    assert.equal(advanced.completed, false);
  });

  it('loop clips keep elapsed time bounded within one timeline', () => {
    const descriptor = sheet();
    let state = startSpriteAnimation(descriptor, 'idle');
    state = advanceSpriteAnimation(descriptor, state, 10_000);
    assert.equal(state.elapsedMs, 100, '10 000 s wraps into one timeline (bounded arithmetic)');
    assert.equal(sampleSpriteClipFrame(descriptor.animations.idle, state.elapsedMs), 1);
  });

  it('one-shot clips hold their final frame and report completion once', () => {
    const descriptor = sheet();
    let state = startSpriteAnimation(descriptor, 'pop');
    state = advanceSpriteAnimation(descriptor, state, 0.299999);
    assert.equal(state.completed, false, 'not yet complete');
    state = advanceSpriteAnimation(descriptor, state, 0.000002);
    assert.equal(state.completed, true, 'completes at the boundary');
    const later = advanceSpriteAnimation(descriptor, state, 5);
    assert.equal(later.completed, true, 'stays completed');
    assert.equal(later.elapsedMs, state.elapsedMs, 'holds the final elapsed time');
  });

  it('pause/resume are exact and immutable', () => {
    const descriptor = sheet();
    const state = startSpriteAnimation(descriptor, 'idle');
    const paused = pauseSpriteAnimation(state);
    assert.equal(paused.paused, true);
    assert.equal(pauseSpriteAnimation(paused), paused, 'pause is idempotent');
    const advancedWhilePaused = advanceSpriteAnimation(descriptor, paused, 1);
    assert.equal(advancedWhilePaused.elapsedMs, 0, 'advance is a no-op while paused');
    const resumed = resumeSpriteAnimation(advancedWhilePaused);
    assert.equal(resumed.paused, false);
    const advancedAfter = advanceSpriteAnimation(descriptor, resumed, 0.1);
    assert.equal(advancedAfter.elapsedMs, 100);
  });

  it('restart and clip change return fresh playback', () => {
    const descriptor = sheet();
    let state = startSpriteAnimation(descriptor, 'pop');
    state = advanceSpriteAnimation(descriptor, state, 1);
    assert.equal(state.completed, true);
    const reset = resetSpriteAnimation(state);
    assert.equal(reset.elapsedMs, 0);
    assert.equal(reset.completed, false);
    assert.equal(state.completed, true, 'original unchanged');

    const changed = playSpriteAnimation(descriptor, state, 'idle');
    assert.equal(changed.clip, 'idle');
    assert.equal(changed.elapsedMs, 0);
    assert.equal(playSpriteAnimation(descriptor, changed, 'idle'), changed, 'same clip is a no-op');
  });

  it('speed multiplies elapsed time and is validated', () => {
    const descriptor = sheet();
    const state = startSpriteAnimation(descriptor, 'idle');
    const fast = setSpriteAnimationSpeed(state, 2);
    const advanced = advanceSpriteAnimation(descriptor, fast, 0.1);
    assert.equal(advanced.elapsedMs, 200, '0.1 s at speed 2');
    assert.throws(() => setSpriteAnimationSpeed(state, 0), /greater than zero/);
    assert.throws(() => setSpriteAnimationSpeed(state, Number.NaN), /finite/);
    assert.throws(() => setSpriteAnimationSpeed(state, -1), /greater than zero/);
  });

  it('negative deltas clamp to zero; NaN/infinity fail clearly', () => {
    const descriptor = sheet();
    const state = startSpriteAnimation(descriptor, 'idle');
    assert.equal(advanceSpriteAnimation(descriptor, state, -0.5).elapsedMs, 0, 'clamped to zero');
    assert.throws(() => advanceSpriteAnimation(descriptor, state, Number.NaN), /finite/);
    assert.throws(() => advanceSpriteAnimation(descriptor, state, Number.POSITIVE_INFINITY), /finite/);
  });

  it('playback helpers are worklet-compatible and capture no native objects', () => {
    const descriptor = sheet();
    const state = startSpriteAnimation(descriptor, 'idle');
    // The helpers must be plain functions carrying no native state; JSON
    // round-tripping the state proves it stays serializable.
    const snapshot = JSON.parse(JSON.stringify(state));
    assert.deepEqual(snapshot, {
      clip: 'idle',
      elapsedMs: 0,
      paused: false,
      speed: 1,
      completed: false,
    });
    assert.equal(typeof advanceSpriteAnimation, 'function');
  });
});
