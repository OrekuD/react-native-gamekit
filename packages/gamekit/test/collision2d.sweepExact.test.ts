/**
 * RED (T11-F2): swept queries against the exact Minkowski geometry.
 *
 * The circle-AABB sweep must treat corners as rounded (no square-corner
 * false positives), and the AABB-AABB sweep must use the asymmetric
 * expansion for its top-left reference. For every nonzero-time hit, the
 * shapes must touch at `time` and not touch just before it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  sweepAabbAabb2D,
  sweepCircleAabb2D,
  type Aabb2D,
  type Circle2D,
} from '../src/index';

const close = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} ~= ${expected}`);

/** Local floating-point tolerance for the touch-at-time property. */
const TOUCH_EPSILON = 1e-9;
const nextDown = (t: number): number => t - 1e-9;

function circleTouches(circle: Circle2D, aabb: Aabb2D): boolean {
  const closestX = Math.max(aabb.x, Math.min(circle.x, aabb.x + aabb.width));
  const closestY = Math.max(aabb.y, Math.min(circle.y, aabb.y + aabb.height));
  const distance = Math.hypot(circle.x - closestX, circle.y - closestY);
  return circle.radius - distance >= -TOUCH_EPSILON;
}

describe('swept circle-AABB exact geometry (T11-F2)', () => {
  const target: Aabb2D = { x: 0, y: 0, width: 36, height: 10 };

  it('reports the rounded-corner entry time, not the square-corner proxy time', () => {
    // The center path (50, 24) -> (30, 4). The old expanded-box method hit
    // the square corner at t = 0.5 with the center at (40, 14), which is
    // 5.66 units from the corner (36, 10) — no actual contact. The rounded
    // corner circle (36, 10) with r = 4 is entered later, at a time where
    // the shapes genuinely touch.
    const hit = sweepCircleAabb2D({
      circle: { x: 50, y: 24, radius: 4 },
      displacement: { x: -20, y: -20 },
      target,
    });
    assert.ok(hit !== undefined);
    // Entry root of the segment against the corner circle:
    // (1120 - sqrt(51200)) / 1600.
    close(hit.time, (1120 - Math.sqrt(51200)) / 1600);
    const at = {
      x: 50 + -20 * hit.time,
      y: 24 + -20 * hit.time,
      radius: 4,
    };
    assert.equal(circleTouches(at, target), true, 'the reported time is a real contact');
  });

  it('reports a true rounded-corner tangent', () => {
    // The center path passes exactly r=4 units from the corner (36, 10):
    // the tangent point is at (40, 14) -> offset (4, 4), distance sqrt(32)
    // is NOT 4; use a true tangent: center passes (40, 12) with r=4, corner
    // distance sqrt(16 + 4) = sqrt(20) != 4. Instead aim through the corner
    // circle: path from (40, 22) to (40, 2) passes (40, 10): distance to the
    // corner (36, 10) is exactly 4 -> tangent at the corner circle.
    const hit = sweepCircleAabb2D({
      circle: { x: 40, y: 22, radius: 4 },
      displacement: { x: 0, y: -20 },
      target,
    });
    assert.ok(hit !== undefined, 'the tangent touches the rounded corner');
    close(hit.time, 12 / 20);
    // At impact the center is (40, 10): the push-out is +x (radial from the
    // corner).
    close(hit.normal.x, 1);
    close(hit.normal.y, 0);
    assert.deepEqual(hit.point, { x: 36, y: 10 }, 'contact on the original corner');
  });

  it('reports a true corner impact', () => {
    // The center path at x=39 passes within 3 units of the corner (36, 10),
    // penetrating the radius-4 corner circle: entry is sqrt(16 - 9) = sqrt(7)
    // below the corner's y.
    const hit = sweepCircleAabb2D({
      circle: { x: 39, y: 20, radius: 4 },
      displacement: { x: 0, y: -20 },
      target,
    });
    assert.ok(hit !== undefined);
    close(hit.time, (20 - (10 + Math.sqrt(7))) / 20);
    assert.ok(Math.abs(Math.hypot(hit.normal.x, hit.normal.y) - 1) < 1e-9);
    assert.deepEqual(hit.point, { x: 36, y: 10 }, 'contact on the original corner');
  });

  it('confirms static contact at the reported time and none just before', () => {
    const circle: Circle2D = { x: 10, y: 40, radius: 4 };
    const displacement = { x: 0, y: 40 };
    const targetBox: Aabb2D = { x: 0, y: 80, width: 36, height: 10 };
    const hit = sweepCircleAabb2D({ circle, displacement, target: targetBox });
    assert.ok(hit !== undefined);
    assert.ok(hit.time > 0);
    // At the reported time the shapes touch (within local tolerance).
    const at = {
      x: circle.x + displacement.x * hit.time,
      y: circle.y + displacement.y * hit.time,
      radius: circle.radius,
    };
    assert.equal(circleTouches(at, targetBox), true, 'contact at the reported time');
    // Just before the reported time there is none.
    const before = {
      x: circle.x + displacement.x * nextDown(hit.time),
      y: circle.y + displacement.y * nextDown(hit.time),
      radius: circle.radius,
    };
    assert.equal(circleTouches(before, targetBox), false, 'no contact immediately before');
  });
});

/** Positive when the boxes penetrate; negative when separated. */
function aabbPenetration(first: Aabb2D, second: Aabb2D): number {
  const xOverlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const yOverlap = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return Math.min(xOverlap, yOverlap);
}

describe('swept AABB-AABB exact geometry (T11-F2)', () => {
  const target: Aabb2D = { x: 100, y: 100, width: 40, height: 40 };

  it('does not report a hit when passing just to the left, right, above, or below', () => {
    const moving = { x: 0, y: 0, width: 10, height: 10 };
    // Pass just to the LEFT of the target: the moving box right edge (x+10)
    // stays left of the target's left edge (100).
    const left = sweepAabbAabb2D({
      aabb: { ...moving, x: 80, y: 120 },
      displacement: { x: 0, y: -40 },
      target,
    });
    assert.equal(left, undefined, 'passing left of the target is a miss');
    // Above: the moving box bottom (y+10) stays above the target top (100)
    // for the whole step.
    const above = sweepAabbAabb2D({
      aabb: { ...moving, x: 110, y: 70 },
      displacement: { x: 0, y: 15 },
      target,
    });
    assert.equal(above, undefined, 'passing above the target is a miss');
    // Right: the moving box left edge stays right of the target right edge (140).
    const right = sweepAabbAabb2D({
      aabb: { ...moving, x: 150, y: 120 },
      displacement: { x: 0, y: -40 },
      target,
    });
    assert.equal(right, undefined, 'passing right of the target is a miss');
    // Below: the moving box top stays below the target bottom (140) for the
    // whole step.
    const below = sweepAabbAabb2D({
      aabb: { ...moving, x: 110, y: 150 },
      displacement: { x: 0, y: -8 },
      target,
    });
    assert.equal(below, undefined, 'passing below the target is a miss');
  });

  it('reports a face hit with contact at time and none just before', () => {
    const moving = { x: 110, y: 0, width: 10, height: 10 };
    const displacement = { x: 0, y: 140 };
    const hit = sweepAabbAabb2D({ aabb: moving, displacement, target });
    assert.ok(hit !== undefined);
    assert.ok(hit.time > 0);
    const at = {
      x: moving.x,
      y: moving.y + displacement.y * hit.time,
      width: moving.width,
      height: moving.height,
    };
    assert.equal(aabbPenetration(at, target) >= -TOUCH_EPSILON, true, 'contact at the reported time');
    const before = {
      x: moving.x,
      y: moving.y + displacement.y * nextDown(hit.time),
      width: moving.width,
      height: moving.height,
    };
    assert.equal(aabbPenetration(before, target) >= -TOUCH_EPSILON, false, 'none just before');
    assert.deepEqual(hit.normal, { x: 0, y: -1 }, 'moving up out of the target');
  });

  it('keeps starting overlap, zero movement, away, and high-speed tunneling', () => {
    const overlap = sweepAabbAabb2D({
      aabb: { x: 105, y: 105, width: 10, height: 10 },
      displacement: { x: 0, y: 40 },
      target,
    });
    assert.ok(overlap !== undefined);
    assert.equal(overlap.time, 0);

    assert.equal(
      sweepAabbAabb2D({ aabb: { x: 110, y: 200, width: 10, height: 10 }, displacement: { x: 0, y: 0 }, target }),
      undefined,
      'zero movement with no overlap',
    );
    assert.equal(
      sweepAabbAabb2D({ aabb: { x: 110, y: 200, width: 10, height: 10 }, displacement: { x: 0, y: 40 }, target }),
      undefined,
      'moving away',
    );

    const fast = sweepAabbAabb2D({
      aabb: { x: 110, y: 0, width: 10, height: 10 },
      displacement: { x: 0, y: 400 },
      target,
    });
    assert.ok(fast !== undefined, 'high-speed tunneling is caught');
  });
});
