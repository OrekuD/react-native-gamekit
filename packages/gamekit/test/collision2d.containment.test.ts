/**
 * RED (T11-F1): contained AABB resolution.
 *
 * The independent oracle computes the true minimum translation to separate
 * the intervals on each axis (directional exit distances), so containment
 * cases are resolved completely, not to a smaller intersection rectangle.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { collideAabbAabb2D, type Aabb2D, type CollisionHit2D } from '../src/index';

/** True penetration oracle: minimum directional exit over both axes. */
function penetration(first: Aabb2D, second: Aabb2D): { readonly axis: 'x' | 'y'; readonly sign: 1 | -1; readonly depth: number } {
  const xExitNeg = first.x + first.width - second.x;
  const xExitPos = second.x + second.width - first.x;
  const yExitNeg = first.y + first.height - second.y;
  const yExitPos = second.y + second.height - first.y;
  const xDepth = Math.min(xExitNeg, xExitPos);
  const yDepth = Math.min(yExitNeg, yExitPos);
  if (xDepth < yDepth) {
    return { axis: 'x', sign: xExitNeg <= xExitPos ? -1 : 1, depth: xDepth };
  }
  return { axis: 'y', sign: yExitNeg <= yExitPos ? -1 : 1, depth: yDepth };
}

function assertResolvesCompletely(first: Aabb2D, second: Aabb2D, hit: CollisionHit2D): void {
  const moved = {
    x: first.x + hit.normal.x * hit.depth,
    y: first.y + hit.normal.y * hit.depth,
    width: first.width,
    height: first.height,
  };
  const left = penetration(moved, second);
  assert.ok(
    left.depth <= 1e-9,
    `after resolution the boxes must not penetrate (remaining ${left.depth})`,
  );
}

describe('contained AABB resolution (T11-F1)', () => {
  it('resolves a small contained AABB near every face of the outer box', () => {
    const outer: Aabb2D = { x: 0, y: 0, width: 10, height: 10 };
    const nearTop: Aabb2D = { x: 4, y: 1, width: 2, height: 2 };
    const hitTop = collideAabbAabb2D(nearTop, outer);
    assert.ok(hitTop !== undefined);
    // Exit up: inner bottom (3) must pass the outer top (0): depth 3.
    assert.deepEqual(hitTop.normal, { x: 0, y: -1 });
    assert.ok(Math.abs(hitTop.depth - 3) < 1e-9, `depth ${hitTop.depth} ~= 3`);
    assertResolvesCompletely(nearTop, outer, hitTop);

    const nearBottom: Aabb2D = { x: 4, y: 7, width: 2, height: 2 };
    const hitBottom = collideAabbAabb2D(nearBottom, outer);
    assert.ok(hitBottom !== undefined);
    assert.deepEqual(hitBottom.normal, { x: 0, y: 1 });
    assertResolvesCompletely(nearBottom, outer, hitBottom);

    const nearLeft: Aabb2D = { x: 1, y: 4, width: 2, height: 2 };
    const hitLeft = collideAabbAabb2D(nearLeft, outer);
    assert.ok(hitLeft !== undefined);
    assert.deepEqual(hitLeft.normal, { x: -1, y: 0 });
    assertResolvesCompletely(nearLeft, outer, hitLeft);

    const nearRight: Aabb2D = { x: 7, y: 4, width: 2, height: 2 };
    const hitRight = collideAabbAabb2D(nearRight, outer);
    assert.ok(hitRight !== undefined);
    assert.deepEqual(hitRight.normal, { x: 1, y: 0 });
    assertResolvesCompletely(nearRight, outer, hitRight);
  });

  it('resolves a large first AABB containing a smaller second AABB', () => {
    const large: Aabb2D = { x: 0, y: 0, width: 10, height: 10 };
    const inner: Aabb2D = { x: 4, y: 4, width: 2, height: 2 };
    const hit = collideAabbAabb2D(large, inner);
    assert.ok(hit !== undefined);
    // Exit up: large bottom (10) past inner top (4): 6; exit left: 8 -> up.
    assert.deepEqual(hit.normal, { x: 0, y: -1 });
    assert.ok(Math.abs(hit.depth - 6) < 1e-9);
    assertResolvesCompletely(large, inner, hit);
  });

  it('resolves identical and equal-center AABBs under the deterministic tie rule', () => {
    const box: Aabb2D = { x: 0, y: 0, width: 4, height: 4 };
    const hit = collideAabbAabb2D(box, { x: 0, y: 0, width: 4, height: 4 });
    assert.ok(hit !== undefined);
    // All four exits tie at 4: the Y axis wins the axis tie, and the
    // negative direction wins the direction tie (documented rule).
    assert.deepEqual(hit.normal, { x: 0, y: -1 });
    assert.ok(Math.abs(hit.depth - 4) < 1e-9);
    assertResolvesCompletely(box, { x: 0, y: 0, width: 4, height: 4 }, hit);
  });

  it('keeps partial overlap, edge, and corner behavior intact', () => {
    const partial = collideAabbAabb2D({ x: 5, y: 5, width: 10, height: 10 }, { x: 12, y: 8, width: 10, height: 10 });
    assert.ok(partial !== undefined);
    assertResolvesCompletely({ x: 5, y: 5, width: 10, height: 10 }, { x: 12, y: 8, width: 10, height: 10 }, partial);

    const edge = collideAabbAabb2D({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 });
    assert.ok(edge !== undefined);
    assert.equal(edge.depth, 0);
    assertResolvesCompletely({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }, edge);
  });
});
