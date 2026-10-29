import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeVector2D, type Vector2D } from '../src/geometry';

function assertUnitVector(vector: Vector2D): void {
  assert.ok(Number.isFinite(vector.x), 'normalized x remains finite');
  assert.ok(Number.isFinite(vector.y), 'normalized y remains finite');
  assert.ok(Math.abs(Math.hypot(vector.x, vector.y) - 1) <= 1e-15, 'normalized length is one');
}

describe('geometry normalization numeric boundaries', () => {
  for (const magnitude of [Number.MAX_VALUE, Number.MIN_VALUE, 1e-320]) {
    it(`normalizes signed diagonal vectors at magnitude ${magnitude}`, () => {
      for (const signX of [-1, 1]) {
        for (const signY of [-1, 1]) {
          const result = normalizeVector2D({ x: signX * magnitude, y: signY * magnitude });
          assertUnitVector(result);
          assert.ok(Math.abs(result.x - signX * Math.SQRT1_2) <= Number.EPSILON);
          assert.ok(Math.abs(result.y - signY * Math.SQRT1_2) <= Number.EPSILON);
        }
      }
    });
  }

  it('preserves the direction of asymmetric huge and subnormal vectors', () => {
    const cases = [
      { input: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE / 2 }, ratio: -2 },
      { input: { x: -Number.MIN_VALUE, y: Number.MIN_VALUE * 2 }, ratio: -0.5 },
      { input: { x: 3e-320, y: -4e-320 }, ratio: 3e-320 / -4e-320 },
    ];
    for (const { input, ratio } of cases) {
      const result = normalizeVector2D(input);
      assertUnitVector(result);
      assert.ok(Math.abs(result.x / result.y - ratio) <= Number.EPSILON * Math.abs(ratio));
      assert.equal(Math.sign(result.x), Math.sign(input.x));
      assert.equal(Math.sign(result.y), Math.sign(input.y));
    }
  });

  it('keeps finite unit vectors across normal and subnormal exponent ranges', () => {
    const magnitudes = [
      Number.MIN_VALUE, 1e-320, 1e-310, 2 ** -1022, 1e-100, 1, 1e100, 1e308, Number.MAX_VALUE,
    ];
    for (const x of magnitudes) {
      for (const y of magnitudes) {
        assertUnitVector(normalizeVector2D({ x, y: -y }));
      }
    }
  });

  it('preserves axis directions immediately below, at, and above the normal-length boundary', () => {
    const minimumNormal = 2 ** -1022;
    for (const magnitude of [
      minimumNormal - Number.MIN_VALUE,
      minimumNormal,
      minimumNormal + Number.MIN_VALUE,
    ]) {
      assert.deepEqual(normalizeVector2D({ x: magnitude, y: -0 }), { x: 1, y: -0 });
      assert.deepEqual(normalizeVector2D({ x: -0, y: -magnitude }), { x: -0, y: -1 });
    }
  });

  it('preserves ordinary, axis-aligned, signed-zero, and zero results', () => {
    assert.deepEqual(normalizeVector2D({ x: 3, y: 4 }), { x: 0.6, y: 0.8 });
    assert.deepEqual(normalizeVector2D({ x: -5, y: 12 }), { x: -5 / 13, y: 12 / 13 });
    assert.deepEqual(normalizeVector2D({ x: -Number.MAX_VALUE, y: 0 }), { x: -1, y: 0 });
    assert.deepEqual(normalizeVector2D({ x: 0, y: -Number.MIN_VALUE }), { x: 0, y: -1 });
    assert.deepEqual(normalizeVector2D({ x: 1, y: -0 }), { x: 1, y: -0 });
    assert.deepEqual(normalizeVector2D({ x: -0, y: 0 }), { x: 0, y: 0 });
  });

  it('returns fresh frozen values without changing inputs in every numeric path', () => {
    for (const input of [
      { x: 0, y: 0 }, { x: 3, y: 4 },
      { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
      { x: Number.MIN_VALUE, y: Number.MIN_VALUE },
    ]) {
      const before = { ...input };
      Object.freeze(input);
      const first = normalizeVector2D(input);
      const second = normalizeVector2D(input);
      assert.notEqual(first, input);
      assert.notEqual(first, second);
      assert.ok(Object.isFrozen(first));
      assert.ok(Object.isFrozen(second));
      assert.deepEqual(input, before);
    }
  });
});
