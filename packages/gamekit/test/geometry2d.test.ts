/**
 * T11.1: canonical geometry values and validation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aabbCenter2D,
  addVector2D,
  distancePoint2D,
  expandAabb2D,
  GeometryError,
  lengthVector2D,
  normalizeVector2D,
  scaleVector2D,
  subtractVector2D,
  translateAabb2D,
  unionAabb2D,
  type Aabb2D,
} from '../src/index';
import { assertValidSegment2D } from '../src/geometry/validation.ts';

describe('geometry values', () => {
  it('keeps Point2D source-compatible and shape-compatible with Aabb2D', () => {
    const point = { x: 1, y: 2 } as const;
    point satisfies { readonly x: number; readonly y: number };
    const aabb: Aabb2D = { x: 0, y: 0, width: 10, height: 20 };
    // The viewport Rect is structurally identical to Aabb2D.
    const viewportRect = { x: 1, y: 2, width: 3, height: 4 };
    viewportRect satisfies Aabb2D;
    void aabb;
  });

  it('rejects NaN and infinity in every validation path', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => aabbCenter2D({ x: bad, y: 0, width: 1, height: 1 }),
        GeometryError,
      );
      assert.throws(
        () => aabbCenter2D({ x: 0, y: 0, width: bad, height: 1 }),
        GeometryError,
      );
      assert.throws(() => translateAabb2D({ x: 0, y: 0, width: 1, height: 1 }, { x: bad, y: 0 }), GeometryError);
      assert.throws(() => scaleVector2D({ x: 1, y: 0 }, bad), GeometryError);
    }
  });

  it('rejects negative sizes and validates zero sizes as valid', () => {
    assert.throws(
      () => aabbCenter2D({ x: 0, y: 0, width: -1, height: 1 }),
      (error: unknown) => error instanceof GeometryError && error.code === 'GEOMETRY_INVALID_SIZE',
    );
    assert.throws(
      () => aabbCenter2D({ x: 0, y: 0, width: 1, height: -1 }),
      GeometryError,
    );
    // Zero-size shapes are valid geometry.
    assert.deepEqual(aabbCenter2D({ x: 4, y: 6, width: 0, height: 0 }), { x: 4, y: 6 });
  });

  it('rejects malformed segments', () => {
    assert.throws(
      () =>
        assertValidSegment2D({
          start: { x: 1, y: 1 },
          end: { x: 1, y: 1 },
        }),
      (error: unknown) => error instanceof GeometryError && error.code === 'GEOMETRY_INVALID_SEGMENT',
    );
    assert.doesNotThrow(() =>
      assertValidSegment2D({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }),
    );
  });

  it('preserves inputs byte-for-byte and returns fresh values', () => {
    const aabb = Object.freeze({ x: 10, y: 20, width: 30, height: 40 });
    const before = JSON.stringify(aabb);
    const translated = translateAabb2D(aabb, { x: 5, y: -5 });
    assert.equal(JSON.stringify(aabb), before, 'input unchanged');
    assert.notEqual(translated, aabb);
    assert.deepEqual(translated, { x: 15, y: 15, width: 30, height: 40 });
  });

  it('computes exact centers and union bounds for integer cases', () => {
    assert.deepEqual(aabbCenter2D({ x: 10, y: 20, width: 30, height: 40 }), { x: 25, y: 40 });
    assert.deepEqual(unionAabb2D({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), {
      x: 0,
      y: 0,
      width: 15,
      height: 15,
    });
    assert.deepEqual(expandAabb2D({ x: 10, y: 10, width: 20, height: 20 }, { x: 5, y: 2 }), {
      x: 5,
      y: 8,
      width: 30,
      height: 24,
    });
    // A negative inset shrinks; a shrink that stays valid is allowed, one
    // that inverts the size is not.
    assert.deepEqual(expandAabb2D({ x: 10, y: 10, width: 20, height: 20 }, -4), {
      x: 14,
      y: 14,
      width: 12,
      height: 12,
    });
    assert.throws(() => expandAabb2D({ x: 10, y: 10, width: 4, height: 4 }, -5), GeometryError);
  });

  it('computes exact vector arithmetic for simple values', () => {
    assert.deepEqual(addVector2D({ x: 1, y: 2 }, { x: 3, y: 4 }), { x: 4, y: 6 });
    assert.deepEqual(subtractVector2D({ x: 3, y: 4 }, { x: 1, y: 2 }), { x: 2, y: 2 });
    assert.deepEqual(scaleVector2D({ x: 2, y: 3 }, 4), { x: 8, y: 12 });
    assert.equal(lengthVector2D({ x: 3, y: 4 }), 5);
    assert.deepEqual(normalizeVector2D({ x: 3, y: 4 }), { x: 0.6, y: 0.8 });
    assert.deepEqual(normalizeVector2D({ x: 0, y: 0 }), { x: 0, y: 0 }, 'zero vector never NaN');
    assert.equal(distancePoint2D({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });
});
