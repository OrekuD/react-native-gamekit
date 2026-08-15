/**
 * RED (T11-F3, T11-F4): collider-pair ordering and filter normalization,
 * plus the inside-circle segment normal direction.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALL_FILTER2D,
  NONE_FILTER2D,
  circleCollider2D,
  collideWorldColliders2D,
  intersectSegmentCircle2D,
  placeCollider2D,
  rectangleCollider2D,
  type CollisionFilter2D,
} from '../src/index';

describe('collider-pair dispatch order (T11-F3)', () => {
  it('returns inverse normals and equal depth for both mixed orders', () => {
    const circle = placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 10 }), { x: 25, y: 10 });
    const box = placeCollider2D(rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 20, height: 20 }), { x: 0, y: 0 });

    const circleFirst = collideWorldColliders2D(circle, box);
    const boxFirst = collideWorldColliders2D(box, circle);
    assert.ok(circleFirst !== undefined && boxFirst !== undefined, 'both orders report the contact');
    // The circle overlaps the box's right face by 5 units.
    assert.ok(Math.abs(circleFirst.depth - 5) < 1e-9);
    assert.ok(Math.abs(boxFirst.depth - 5) < 1e-9, 'equal depth');
    // Inverse normals: the circle sits to the RIGHT of the box, so the
    // circle-first normal pushes the circle right (+x) and the box-first
    // normal pushes the box left (-x).
    assert.deepEqual(circleFirst.normal, { x: 1, y: 0 });
    assert.deepEqual(boxFirst.normal, { x: -1, y: 0 }, 'the box-first normal moves the box left');
    // First-argument resolution: applying the box-first normal to the box
    // separates the pair.
    const movedBox = { x: 0 + boxFirst.normal.x * boxFirst.depth, y: 0, width: 20, height: 20 };
    const circleAt = { x: 25, y: 10, radius: 10 };
    const closestX = Math.max(movedBox.x, Math.min(circleAt.x, movedBox.x + movedBox.width));
    const closestY = Math.max(movedBox.y, Math.min(circleAt.y, movedBox.y + movedBox.height));
    const distance = Math.hypot(circleAt.x - closestX, circleAt.y - closestY);
    assert.ok(distance >= 10 - 1e-9, 'applying the normal to the first argument resolves the overlap');
  });

  it('preserves order invariants for same-shape pairs', () => {
    const a = placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 5 }), { x: 0, y: 0 });
    const b = placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 5 }), { x: 8, y: 0 });
    const first = collideWorldColliders2D(a, b);
    const second = collideWorldColliders2D(b, a);
    assert.ok(first !== undefined && second !== undefined);
    assert.deepEqual(first.normal, { x: -1, y: 0 }, 'moves the first (left) circle out');
    assert.deepEqual(second.normal, { x: 1, y: 0 });
  });
});

describe('filter normalization (T11-F3)', () => {
  const circle = () =>
    placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 10 }), { x: 25, y: 10 });
  const box = (filter?: CollisionFilter2D) =>
    placeCollider2D(
      rectangleCollider2D({
        offset: { x: 0, y: 0 },
        width: 20,
        height: 20,
        ...(filter === undefined ? {} : { filter }),
      }),
      { x: 0, y: 0 },
    );

  it('treats an absent filter as eligible with everything', () => {
    const a = circle();
    const b = box({ categoryBits: 0b10, maskBits: 0b1 });
    // Unfiltered circle: its category/mask default to ALL, so the box's
    // mask (0b1) includes the circle's all-bits category, and the circle's
    // all-bits mask includes the box's category.
    assert.ok(collideWorldColliders2D(a, b) !== undefined, 'unfiltered is eligible');
    const c = circle();
    const d = box();
    assert.ok(collideWorldColliders2D(c, d) !== undefined, 'both unfiltered is eligible');
  });

  it('preserves NONE_FILTER2D as collide-with-nothing on either side', () => {
    const none = circle();
    // Rebuild with a NONE filter by constructing with an explicit filter.
    const noneCircle = () =>
      placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 10, filter: NONE_FILTER2D }), {
        x: 25,
        y: 10,
      });
    assert.equal(collideWorldColliders2D(noneCircle(), box()), undefined, 'NONE vs unfiltered');
    assert.equal(collideWorldColliders2D(box(), noneCircle()), undefined, 'unfiltered vs NONE');
    assert.equal(
      collideWorldColliders2D(noneCircle(), box(ALL_FILTER2D)),
      undefined,
      'NONE vs all-filtered',
    );
    void none;
  });

  it('fails one-way masks through the composed API', () => {
    const a = circle();
    // The box masks only category 0b100; the circle's all-bits category
    // includes it, but the circle's all-bits mask includes the box's
    // category 0b10 too... use an explicit one-way failure: the box masks
    // nothing that the circle's category has.
    const b = box({ categoryBits: 0b10, maskBits: 0 });
    assert.equal(collideWorldColliders2D(a, b), undefined, 'zero mask on the box blocks the pair');
  });
});

describe('inside-circle segment normal (T11-F4)', () => {
  const circle = { x: 10, y: 10, radius: 5 };

  it('returns the outward radial normal for off-center inside starts', () => {
    // Start to the RIGHT of the center: the outward normal points +x.
    const right = intersectSegmentCircle2D({ start: { x: 12, y: 10 }, end: { x: 20, y: 10 } }, circle);
    assert.ok(right !== undefined);
    assert.equal(right.time, 0);
    assert.deepEqual(right.normal, { x: 1, y: 0 }, 'outward, away from the center');

    const left = intersectSegmentCircle2D({ start: { x: 8, y: 10 }, end: { x: 0, y: 10 } }, circle);
    assert.ok(left !== undefined);
    assert.deepEqual(left.normal, { x: -1, y: 0 });

    const above = intersectSegmentCircle2D({ start: { x: 10, y: 8 }, end: { x: 10, y: 0 } }, circle);
    assert.ok(above !== undefined);
    assert.deepEqual(above.normal, { x: 0, y: -1 });

    const below = intersectSegmentCircle2D({ start: { x: 10, y: 12 }, end: { x: 10, y: 20 } }, circle);
    assert.ok(below !== undefined);
    assert.deepEqual(below.normal, { x: 0, y: 1 });

    // Diagonal inside start: unit outward radial.
    const diagonal = intersectSegmentCircle2D({ start: { x: 13, y: 13 }, end: { x: 20, y: 20 } }, circle);
    assert.ok(diagonal !== undefined);
    const expected = Math.SQRT1_2;
    assert.ok(Math.abs(diagonal.normal.x - expected) < 1e-9);
    assert.ok(Math.abs(diagonal.normal.y - expected) < 1e-9);
  });

  it('keeps the center fallback deterministic', () => {
    const center = intersectSegmentCircle2D({ start: { x: 10, y: 10 }, end: { x: 20, y: 10 } }, circle);
    assert.ok(center !== undefined);
    assert.deepEqual(center.normal, { x: 0, y: 1 });
  });
});
