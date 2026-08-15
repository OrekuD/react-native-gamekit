/**
 * T11.3: swept queries and segment crossings.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GeometryError,
  intersectSegmentAabb2D,
  intersectSegmentCircle2D,
  sweepAabbAabb2D,
  sweepCircleAabb2D,
  type Aabb2D,
  type Circle2D,
} from '../src/index';

const close = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} ~= ${expected}`);

describe('swept circle-AABB', () => {
  it('hits a thin brick that discrete overlap would miss (anti-tunneling)', () => {
    // A fast ball crosses an entire 10-unit brick in one step of 40 units.
    const hit = sweepCircleAabb2D({
      circle: { x: 10, y: 40, radius: 4 },
      displacement: { x: 0, y: 40 },
      target: { x: 0, y: 80, width: 36, height: 10 },
    });
    assert.ok(hit !== undefined, 'the swept ball hits the thin brick');
    close(hit.time, 36 / 40);
    assert.deepEqual(hit.normal, { x: 0, y: -1 }, 'moving up out of the brick');
    // Contact point on the target at impact: the ball touches the top face.
    close(hit.point.x, 10);
    close(hit.point.y, 80);
  });

  it('reports no future impact when moving away', () => {
    const hit = sweepCircleAabb2D({
      circle: { x: 10, y: 100, radius: 4 },
      displacement: { x: 0, y: 40 },
      target: { x: 0, y: 80, width: 36, height: 10 },
    });
    assert.equal(hit, undefined);
  });

  it('handles zero displacement without NaN', () => {
    const hit = sweepCircleAabb2D({
      circle: { x: 10, y: 30, radius: 4 },
      displacement: { x: 0, y: 0 },
      target: { x: 0, y: 0, width: 36, height: 10 },
    });
    assert.equal(hit, undefined, 'no movement and no overlap means no hit');
  });

  it('returns time 0 with the manifold normal for a starting overlap', () => {
    const hit = sweepCircleAabb2D({
      circle: { x: 30, y: 12, radius: 4 },
      displacement: { x: -40, y: 0 },
      target: { x: 0, y: 0, width: 36, height: 10 },
    });
    assert.ok(hit !== undefined);
    assert.equal(hit.time, 0);
    // The circle overlaps the bottom face, so the manifold pushes it down.
    assert.deepEqual(hit.normal, { x: 0, y: 1 });
  });

  it('resolves corner impacts with a unit normal', () => {
    // The center path passes exactly through the expanded corner (40, 14)
    // at t = 0.5.
    const hit = sweepCircleAabb2D({
      circle: { x: 50, y: 24, radius: 4 },
      displacement: { x: -20, y: -20 },
      target: { x: 0, y: 0, width: 36, height: 10 },
    });
    assert.ok(hit !== undefined);
    close(hit.time, 0.5);
    close(Math.hypot(hit.normal.x, hit.normal.y), 1);
    close(hit.point.x, 36);
    close(hit.point.y, 10);
  });

  it('is translation invariant', () => {
    const shift = 1000;
    const a = sweepCircleAabb2D({
      circle: { x: 10, y: 40, radius: 4 },
      displacement: { x: 0, y: 40 },
      target: { x: 0, y: 80, width: 36, height: 10 },
    });
    const b = sweepCircleAabb2D({
      circle: { x: 10 + shift, y: 40 + shift, radius: 4 },
      displacement: { x: 0, y: 40 },
      target: { x: shift, y: 80 + shift, width: 36, height: 10 },
    });
    assert.ok(a !== undefined && b !== undefined);
    close(a.time, b.time);
    assert.deepEqual(a.normal, b.normal);
  });
});

describe('swept AABB-AABB', () => {
  it('hits an AABB the discrete step would skip', () => {
    const hit = sweepAabbAabb2D({
      aabb: { x: 0, y: 0, width: 8, height: 8 },
      displacement: { x: 0, y: 60 },
      target: { x: 0, y: 60, width: 20, height: 4 },
    });
    assert.ok(hit !== undefined);
    // The swept box's bottom edge (y=8) reaches the target's top (y=60)
    // after 52 units of the 60-unit displacement.
    close(hit.time, 52 / 60);
    assert.deepEqual(hit.normal, { x: 0, y: -1 });
  });

  it('returns time 0 for a starting overlap and undefined moving away', () => {
    const overlap = sweepAabbAabb2D({
      aabb: { x: 0, y: 0, width: 8, height: 8 },
      displacement: { x: 0, y: 50 },
      target: { x: 0, y: 4, width: 20, height: 4 },
    });
    assert.ok(overlap !== undefined);
    assert.equal(overlap.time, 0);

    const away = sweepAabbAabb2D({
      aabb: { x: 0, y: 100, width: 8, height: 8 },
      displacement: { x: 0, y: 50 },
      target: { x: 0, y: 60, width: 20, height: 4 },
    });
    assert.equal(away, undefined);
  });
});

describe('segment-AABB queries', () => {
  const box: Aabb2D = { x: 0, y: 0, width: 20, height: 10 };

  it('reports enter and exit crossings', () => {
    const enter = intersectSegmentAabb2D({ start: { x: -10, y: 5 }, end: { x: 30, y: 5 } }, box);
    assert.ok(enter !== undefined);
    close(enter.time, 0.25);
    assert.deepEqual(enter.normal, { x: -1, y: 0 }, 'outward normal of the entered face');
    assert.deepEqual(enter.point, { x: 0, y: 5 });
  });

  it('handles inside starts, parallel misses, and tangent grazes', () => {
    const inside = intersectSegmentAabb2D({ start: { x: 5, y: 5 }, end: { x: 30, y: 5 } }, box);
    assert.ok(inside !== undefined);
    assert.equal(inside.time, 0);
    assert.deepEqual(inside.point, { x: 5, y: 5 });
    // Nearest faces: left and right are both 5 away; top/bottom 5 away too —
    // tie rule left, top, right, bottom -> left.
    assert.deepEqual(inside.normal, { x: -1, y: 0 });

    const parallel = intersectSegmentAabb2D({ start: { x: -10, y: 20 }, end: { x: 30, y: 20 } }, box);
    assert.equal(parallel, undefined);

    const tangent = intersectSegmentAabb2D({ start: { x: -10, y: 0 }, end: { x: 30, y: 0 } }, box);
    assert.equal(tangent, undefined, 'grazing the boundary is not a crossing');
  });

  it('rejects zero-length segments', () => {
    assert.throws(
      () => intersectSegmentAabb2D({ start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }, box),
      GeometryError,
    );
  });
});

describe('segment-circle queries', () => {
  const circle: Circle2D = { x: 10, y: 10, radius: 5 };

  it('reports enter, inside-start, tangent, and miss', () => {
    const enter = intersectSegmentCircle2D({ start: { x: 0, y: 10 }, end: { x: 20, y: 10 } }, circle);
    assert.ok(enter !== undefined);
    close(enter.time, 0.25);
    assert.deepEqual(enter.normal, { x: -1, y: 0 }, 'radial normal at entry');
    assert.deepEqual(enter.point, { x: 5, y: 10 });

    const inside = intersectSegmentCircle2D({ start: { x: 10, y: 10 }, end: { x: 20, y: 10 } }, circle);
    assert.ok(inside !== undefined);
    assert.equal(inside.time, 0);
    assert.deepEqual(inside.normal, { x: 0, y: 1 }, 'center fallback normal');

    const miss = intersectSegmentCircle2D({ start: { x: 0, y: 20 }, end: { x: 20, y: 20 } }, circle);
    assert.equal(miss, undefined);
  });
});
