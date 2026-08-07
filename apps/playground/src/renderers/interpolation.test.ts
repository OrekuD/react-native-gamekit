import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { interpolateBall, interpolatePaddle } from './interpolation.ts';

describe('brick breaker presentation interpolation (feedback)', () => {
  it('blends same-scene ball values with alpha', () => {
    const previous = { x: 100, y: 120 };
    const current = { x: 110, y: 140 };
    assert.deepEqual(interpolateBall(previous, current, 0), { x: 100, y: 120 });
    assert.deepEqual(interpolateBall(previous, current, 1), { x: 110, y: 140 });
    assert.deepEqual(interpolateBall(previous, current, 0.5), { x: 105, y: 130 });
  });

  it('blends same-scene paddle values with alpha', () => {
    assert.equal(interpolatePaddle({ x: 100 }, { x: 120 }, 0.25), 105);
  });

  it('is a no-op on a hard cut where previous and current are identical', () => {
    const snapshot = { x: 80, y: 90 };
    assert.deepEqual(interpolateBall(snapshot, snapshot, 0.7), snapshot);
    assert.equal(interpolatePaddle(snapshot, snapshot, 0.7), 80);
  });

  it('stays within the previous/current interval for alpha in [0, 1]', () => {
    const previous = { x: 0, y: 0 };
    const current = { x: 300, y: 160 };
    for (const alpha of [0, 0.1, 0.33, 0.5, 0.9, 1]) {
      const value = interpolateBall(previous, current, alpha);
      assert.ok(value.x >= previous.x && value.x <= current.x);
      assert.ok(value.y >= previous.y && value.y <= current.y);
    }
  });
});
