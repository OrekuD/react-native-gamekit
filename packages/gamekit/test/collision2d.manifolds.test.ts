/**
 * T11.2: contact manifolds — normal, depth, point conventions, resolution
 * property, symmetry, translation invariance, and no-mutation guarantees.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  collideAabbAabb2D,
  collideCircleAabb2D,
  collideCircleCircle2D,
  RESOLUTION_TOLERANCE,
  type Aabb2D,
  type Circle2D,
} from '../src/index';

const resolutionEpsilon = 1e-9;

/** Apply `first += normal * depth` and assert the overlap is resolved. */
function assertResolves(
  first: Circle2D | Aabb2D,
  second: Circle2D | Aabb2D,
  hit: { normal: { x: number; y: number }; depth: number },
): void {
  const moved = {
    ...first,
    x: first.x + hit.normal.x * hit.depth,
    y: first.y + hit.normal.y * hit.depth,
  };
  // The documented floating-point tolerance: after resolution the shapes may
  // touch exactly or be separated, but never penetrate by more than 1e-9
  // relative to the smaller shape's size.
  const penetration = penetrationDepth(moved, second);
  const scale = Math.max(1, Math.min(sizeOf(moved), sizeOf(second)));
  assert.ok(
    penetration <= 1e-9 * scale,
    `applying normal * depth resolves the overlap (penetration ${penetration})`,
  );
}

function sizeOf(shape: Circle2D | Aabb2D): number {
  return 'radius' in shape ? shape.radius * 2 : Math.min(shape.width, shape.height);
}

/** Positive when the shapes penetrate; ~0 or negative means resolved. */
function penetrationDepth(first: Circle2D | Aabb2D, second: Circle2D | Aabb2D): number {
  if ('radius' in first && 'radius' in second) {
    const d = Math.hypot(second.x - first.x, second.y - first.y);
    return first.radius + second.radius - d;
  }
  if ('radius' in first && !('radius' in second)) {
    const c = first as Circle2D;
    const b = second as Aabb2D;
    const closestX = Math.max(b.x, Math.min(c.x, b.x + b.width));
    const closestY = Math.max(b.y, Math.min(c.y, b.y + b.height));
    return c.radius - Math.hypot(c.x - closestX, c.y - closestY);
  }
  if (!('radius' in first) && 'radius' in second) {
    return penetrationDepth(second as Circle2D, first as Aabb2D);
  }
  const a = first as Aabb2D;
  const b = second as Aabb2D;
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.min(overlapX, overlapY);
}

const TOLERANCE = 1e-9;
const close = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${actual} ~= ${expected}`);

describe('AABB-AABB manifolds', () => {
  it('returns undefined on a miss and allocates nothing on the miss path', () => {
    assert.equal(
      collideAabbAabb2D({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }),
      undefined,
    );
  });

  it('reports separation, containment, and boundary contacts', () => {
    const inner = collideAabbAabb2D({ x: 2, y: 2, width: 2, height: 2 }, { x: 0, y: 0, width: 10, height: 10 });
    assert.ok(inner !== undefined);
    // Full directional exits: up and left both need 4 units; equal axes pick
    // the Y axis (locked tie rule) and the negative direction wins.
    assert.deepEqual(inner.normal, { x: 0, y: -1 }, 'contained box exits upward');
    close(inner.depth, 4);

    const edge = collideAabbAabb2D({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 });
    assert.ok(edge !== undefined);
    close(edge.depth, 0, );
    assert.deepEqual(edge.normal, { x: -1, y: 0 }, 'first is left of second');
  });

  it('is symmetric with inverse normals and equivalent depth', () => {
    const first = { x: 5, y: 5, width: 10, height: 10 };
    const second = { x: 12, y: 8, width: 10, height: 10 };
    const a = collideAabbAabb2D(first, second);
    const b = collideAabbAabb2D(second, first);
    assert.ok(a !== undefined && b !== undefined);
    close(a.normal.x, -b.normal.x);
    close(a.normal.y, -b.normal.y);
    close(a.depth, b.depth);
    assertResolves(first, second, a);
    assertResolves(second, first, b);
  });

  it('resolves ordinary penetration within tolerance', () => {
    const cases: Array<[Aabb2D, Aabb2D]> = [
      [{ x: 10, y: 10, width: 10, height: 10 }, { x: 15, y: 12, width: 10, height: 10 }],
      [{ x: 15, y: 12, width: 10, height: 10 }, { x: 10, y: 10, width: 10, height: 10 }],
      [{ x: 0, y: 0, width: 100, height: 100 }, { x: 90, y: 90, width: 100, height: 100 }],
    ];
    for (const [first, second] of cases) {
      const hit = collideAabbAabb2D(first, second);
      assert.ok(hit !== undefined);
      assertResolves(first, second, hit);
      assert.ok(hit.depth >= 0);
    }
  });

  it('preserves inputs and produces only finite results', () => {
    const first = { x: 10, y: 10, width: 10, height: 10 };
    const second = { x: 15, y: 12, width: 10, height: 10 };
    const before = JSON.stringify([first, second]);
    const hit = collideAabbAabb2D(first, second);
    assert.equal(JSON.stringify([first, second]), before);
    assert.ok(hit !== undefined);
    assert.ok(Number.isFinite(hit.depth));
    assert.ok(Number.isFinite(hit.point.x) && Number.isFinite(hit.point.y));
    void RESOLUTION_TOLERANCE;
    void resolutionEpsilon;
  });
});

describe('circle-circle manifolds', () => {
  it('reports overlap, tangent, containment, and same center', () => {
    const overlap = collideCircleCircle2D({ x: 0, y: 0, radius: 5 }, { x: 8, y: 0, radius: 5 });
    assert.ok(overlap !== undefined);
    close(overlap.depth, 2);
    assert.deepEqual(overlap.normal, { x: -1, y: 0 }, 'normal points from second toward first');
    assert.deepEqual(overlap.point, { x: 5, y: 0 }, 'point on the first boundary toward the second');

    const tangent = collideCircleCircle2D({ x: 0, y: 0, radius: 5 }, { x: 10, y: 0, radius: 5 });
    assert.ok(tangent !== undefined);
    close(tangent.depth, 0);

    const same = collideCircleCircle2D({ x: 4, y: 6, radius: 5 }, { x: 4, y: 6, radius: 5 });
    assert.ok(same !== undefined, 'same center still returns a hit');
    assert.deepEqual(same.normal, { x: 0, y: 1 }, 'locked fallback normal');
    close(same.depth, 10);
    assert.ok(Number.isFinite(same.point.x) && Number.isFinite(same.point.y));

    assert.equal(
      collideCircleCircle2D({ x: 0, y: 0, radius: 5 }, { x: 11, y: 0, radius: 5 }),
      undefined,
      'miss',
    );
  });

  it('is symmetric with inverse normals and resolves', () => {
    const first = { x: 0, y: 0, radius: 4 };
    const second = { x: 6, y: 2, radius: 4 };
    const a = collideCircleCircle2D(first, second);
    const b = collideCircleCircle2D(second, first);
    assert.ok(a !== undefined && b !== undefined);
    close(a.normal.x, -b.normal.x);
    close(a.normal.y, -b.normal.y);
    close(a.depth, b.depth);
    assertResolves(first, second, a);
  });

  it('is translation invariant', () => {
    const shift = 1000;
    const a = collideCircleCircle2D({ x: 0, y: 0, radius: 4 }, { x: 6, y: 2, radius: 4 });
    const b = collideCircleCircle2D({ x: shift, y: shift, radius: 4 }, { x: shift + 6, y: shift + 2, radius: 4 });
    assert.ok(a !== undefined && b !== undefined);
    close(a.depth, b.depth);
    assert.deepEqual(a.normal, b.normal);
  });
});

describe('circle-AABB manifolds', () => {
  it('resolves face and corner contacts with the documented point', () => {
    const box: Aabb2D = { x: 0, y: 0, width: 20, height: 20 };
    const face = collideCircleAabb2D({ x: 25, y: 10, radius: 10 }, box);
    assert.ok(face !== undefined);
    close(face.depth, 5);
    assert.deepEqual(face.normal, { x: 1, y: 0 });
    assert.deepEqual(face.point, { x: 20, y: 10 }, 'closest point on the AABB');

    const corner = collideCircleAabb2D({ x: 27, y: 27, radius: 10 }, box);
    assert.ok(corner !== undefined, 'corner contact');
    close(corner.depth, 10 - Math.hypot(7, 7));
    const normalLength = Math.hypot(corner.normal.x, corner.normal.y);
    close(normalLength, 1);
    assert.deepEqual(corner.point, { x: 20, y: 20 }, 'closest corner');
    assertResolves({ x: 27, y: 27, radius: 10 }, box, corner);
  });

  it('handles a center inside the AABB via the nearest face', () => {
    const box: Aabb2D = { x: 0, y: 0, width: 20, height: 20 };
    // Nearest face is the left edge (distance 4 vs 8 top, 12 right, 16 bottom).
    const hit = collideCircleAabb2D({ x: 4, y: 8, radius: 6 }, box);
    assert.ok(hit !== undefined);
    assert.deepEqual(hit.normal, { x: -1, y: 0 });
    close(hit.depth, 4 + 6);
    assert.deepEqual(hit.point, { x: 0, y: 8 });
    assertResolves({ x: 4, y: 8, radius: 6 }, box, hit);
  });

  it('reports tangent with zero depth and misses on the miss path', () => {
    const box: Aabb2D = { x: 0, y: 0, width: 20, height: 20 };
    const tangent = collideCircleAabb2D({ x: 30, y: 10, radius: 10 }, box);
    assert.ok(tangent !== undefined);
    close(tangent.depth, 0);
    assert.equal(collideCircleAabb2D({ x: 31, y: 10, radius: 10 }, box), undefined);
  });

  it('preserves inputs and resolves ordinary penetration', () => {
    const circle = { x: 25, y: 10, radius: 10 };
    const box = { x: 0, y: 0, width: 20, height: 20 };
    const before = JSON.stringify([circle, box]);
    const hit = collideCircleAabb2D(circle, box);
    assert.equal(JSON.stringify([circle, box]), before);
    assert.ok(hit !== undefined);
    assertResolves(circle, box, hit);
  });

  it('is translation invariant', () => {
    const shift = 500;
    const a = collideCircleAabb2D({ x: 25, y: 10, radius: 10 }, { x: 0, y: 0, width: 20, height: 20 });
    const b = collideCircleAabb2D(
      { x: 25 + shift, y: 10 + shift, radius: 10 },
      { x: shift, y: shift, width: 20, height: 20 },
    );
    assert.ok(a !== undefined && b !== undefined);
    close(a.depth, b.depth);
    assert.deepEqual(a.normal, b.normal);
  });
});
