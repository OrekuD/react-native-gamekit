/**
 * T11.6: headless debug projections.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  circleCollider2D,
  collideCircleAabb2D,
  placeCollider2D,
  projectHit2D,
  projectSweepPath2D,
  projectVector2D,
  projectWorldCollider2D,
  rectangleCollider2D,
  type DebugPrimitive2D,
} from '../src/index';

describe('debug projections', () => {
  it('projects world colliders with their author labels', () => {
    const local = rectangleCollider2D({ offset: { x: -10, y: -18 }, width: 20, height: 36, id: 'body' });
    const world = placeCollider2D(local, { x: 120, y: 80 });
    const debug = projectWorldCollider2D(world);
    debug satisfies DebugPrimitive2D;
    assert.equal(debug.kind, 'aabb');
    assert.equal(debug.label, 'body');
    assert.deepEqual(
      { x: debug.x, y: debug.y, width: debug.width, height: debug.height },
      { x: 110, y: 62, width: 20, height: 36 },
    );

    const hurt = projectWorldCollider2D(
      placeCollider2D(circleCollider2D({ offset: { x: 0, y: -8 }, radius: 12, id: 'hurtbox' }), { x: 0, y: 0 }),
    );
    assert.equal(hurt.kind, 'circle');
    assert.equal(hurt.label, 'hurtbox');
  });

  it('projects hits into a contact point and a normal arrow', () => {
    const hit = collideCircleAabb2D({ x: 25, y: 10, radius: 10 }, { x: 0, y: 0, width: 20, height: 20 });
    assert.ok(hit !== undefined);
    const { point, normal } = projectHit2D(hit);
    assert.equal(point.kind, 'point');
    assert.deepEqual({ x: point.x, y: point.y }, { x: 20, y: 10 });
    assert.equal(normal.kind, 'vector');
    assert.deepEqual({ dx: normal.dx, dy: normal.dy }, { dx: 1, dy: 0 });
  });

  it('projects sweep paths and vectors without native imports', () => {
    const path = projectSweepPath2D({ x: 0, y: 0 }, { x: 40, y: 0 }, 'sweep');
    assert.equal(path.kind, 'segment');
    assert.equal(path.label, 'sweep');
    assert.deepEqual(path.end, { x: 40, y: 0 });
    const arrow = projectVector2D({ x: 10, y: 10 }, { x: 1, y: 0 });
    assert.equal(arrow.kind, 'vector');
    assert.deepEqual({ dx: arrow.dx, dy: arrow.dy }, { dx: 1, dy: 0 });
  });
});
