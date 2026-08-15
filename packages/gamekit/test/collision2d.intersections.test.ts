/**
 * T11.2: static intersection predicates.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GeometryError,
  intersectsAabbAabb2D,
  intersectsCircleAabb2D,
  intersectsCircleCircle2D,
  pointInAabb2D,
  pointInCircle2D,
  type Aabb2D,
  type Circle2D,
} from '../src/index';

const aabb: Aabb2D = { x: 10, y: 20, width: 30, height: 40 };
const circle: Circle2D = { x: 50, y: 50, radius: 10 };

describe('point predicates', () => {
  it('covers inside, boundary, and outside for AABBs', () => {
    assert.equal(pointInAabb2D({ x: 25, y: 40 }, aabb), true, 'inside');
    assert.equal(pointInAabb2D({ x: 10, y: 20 }, aabb), true, 'top-left corner');
    assert.equal(pointInAabb2D({ x: 40, y: 60 }, aabb), true, 'bottom-right corner');
    assert.equal(pointInAabb2D({ x: 9, y: 40 }, aabb), false, 'left outside');
    assert.equal(pointInAabb2D({ x: 25, y: 61 }, aabb), false, 'below');
  });

  it('covers inside, boundary, and outside for circles', () => {
    assert.equal(pointInCircle2D({ x: 50, y: 50 }, circle), true, 'center');
    assert.equal(pointInCircle2D({ x: 60, y: 50 }, circle), true, 'right boundary');
    assert.equal(pointInCircle2D({ x: 61, y: 50 }, circle), false, 'outside');
  });

  it('validates input and never coerces', () => {
    assert.throws(() => pointInAabb2D({ x: Number.NaN, y: 0 }, aabb), GeometryError);
    assert.throws(() => pointInCircle2D({ x: 0, y: 0 }, { x: 0, y: 0, radius: -1 }), GeometryError);
  });
});

describe('shape intersection predicates', () => {
  it('covers miss, overlap, containment, and boundary for AABB-AABB', () => {
    assert.equal(intersectsAabbAabb2D({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }), false);
    assert.equal(intersectsAabbAabb2D({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), true, 'edge touch');
    assert.equal(intersectsAabbAabb2D({ x: 10, y: 10, width: 5, height: 5 }, { x: 0, y: 0, width: 10, height: 10 }), true, 'corner touch');
    assert.equal(intersectsAabbAabb2D({ x: 2, y: 2, width: 2, height: 2 }, { x: 0, y: 0, width: 10, height: 10 }), true, 'contained');
    assert.equal(intersectsAabbAabb2D({ x: 0, y: 0, width: 5, height: 5 }, { x: 3, y: 3, width: 5, height: 5 }), true, 'overlap');
  });

  it('covers miss, tangent, containment, and same center for circle-circle', () => {
    assert.equal(intersectsCircleCircle2D({ x: 0, y: 0, radius: 5 }, { x: 11, y: 0, radius: 5 }), false);
    assert.equal(intersectsCircleCircle2D({ x: 0, y: 0, radius: 5 }, { x: 10, y: 0, radius: 5 }), true, 'tangent');
    assert.equal(intersectsCircleCircle2D({ x: 0, y: 0, radius: 10 }, { x: 2, y: 0, radius: 2 }), true, 'contained');
    assert.equal(intersectsCircleCircle2D({ x: 3, y: 0, radius: 5 }, { x: 0, y: 0, radius: 5 }), true, 'overlap');
    assert.equal(intersectsCircleCircle2D({ x: 0, y: 0, radius: 5 }, { x: 0, y: 0, radius: 5 }), true, 'same center');
  });

  it('covers face, corner, inside, tangent, and miss for circle-AABB', () => {
    const box: Aabb2D = { x: 0, y: 0, width: 20, height: 20 };
    assert.equal(intersectsCircleAabb2D({ x: 30, y: 10, radius: 10 }, box), true, 'face tangent');
    assert.equal(intersectsCircleAabb2D({ x: 31, y: 10, radius: 10 }, box), false, 'face miss');
    // Exact 6-8-10 triple: the circle reaches the corner at exactly r=10.
    assert.equal(intersectsCircleAabb2D({ x: 26, y: 28, radius: 10 }, box), true, 'corner tangent');
    assert.equal(intersectsCircleAabb2D({ x: 30, y: 30, radius: 10 }, box), false, 'corner miss');
    assert.equal(intersectsCircleAabb2D({ x: 10, y: 10, radius: 5 }, box), true, 'center inside');
    assert.equal(intersectsCircleAabb2D({ x: 10, y: 10, radius: 0 }, box), true, 'zero radius inside');
  });

  it('is translation invariant across positive and negative positions', () => {
    const offset = { x: -1000, y: 500 };
    const shift = <T extends { x: number; y: number }>(shape: T): T => ({
      ...shape,
      x: shape.x + offset.x,
      y: shape.y + offset.y,
    });
    const cases: Array<[Aabb2D, Aabb2D, boolean]> = [
      [{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }, false],
      [{ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }, true],
      [{ x: 0, y: 0, width: 5, height: 5 }, { x: 3, y: 3, width: 5, height: 5 }, true],
    ];
    for (const [first, second, expected] of cases) {
      assert.equal(intersectsAabbAabb2D(first, second), expected);
      assert.equal(intersectsAabbAabb2D(shift(first), shift(second)), expected, 'translated');
    }
  });
});
