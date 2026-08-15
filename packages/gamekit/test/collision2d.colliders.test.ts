/**
 * T11.4: filters, collider records, and placement.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canCollide2D,
  circleCollider2D,
  GeometryError,
  intersectsCircleAabb2D,
  placeCollider2D,
  rectangleCollider2D,
  worldColliderBounds2D,
  type CollisionFilter2D,
  type LocalAabbCollider2D,
  type WorldAabbCollider2D,
  type WorldCircleCollider2D,
} from '../src/index';

describe('collision filters', () => {
  const player: CollisionFilter2D = { categoryBits: 0b1, maskBits: 0b10 };
  const brick: CollisionFilter2D = { categoryBits: 0b10, maskBits: 0b1 };
  const wall: CollisionFilter2D = { categoryBits: 0b100, maskBits: 0b1 };

  it('passes symmetric matches and fails one- and two-way mismatches', () => {
    assert.equal(canCollide2D(player, brick), true, 'each category in the other mask');
    assert.equal(canCollide2D(brick, player), true, 'symmetric');
    // wall masks only category 1, so wall vs brick fails one way.
    assert.equal(canCollide2D(wall, brick), false);
    assert.equal(canCollide2D(brick, wall), false);
    // Zero and all-bit masks.
    assert.equal(canCollide2D({ categoryBits: 0b1, maskBits: 0 }, brick), false);
    assert.equal(
      canCollide2D({ categoryBits: 0b1, maskBits: 0xffffffff }, { categoryBits: 0xffffffff, maskBits: 0xffffffff }),
      true,
    );
  });

  it('rejects invalid bit values', () => {
    assert.throws(() => canCollide2D({ categoryBits: -1, maskBits: 1 }, player), GeometryError);
    assert.throws(() => canCollide2D({ categoryBits: 1.5, maskBits: 1 }, player), GeometryError);
    assert.throws(() => canCollide2D({ categoryBits: 2 ** 32, maskBits: 1 }, player), GeometryError);
  });

  it('sensors and solids produce identical geometry results', () => {
    const solid = rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 10, height: 10 });
    const sensor = rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 10, height: 10, sensor: true });
    const placedSolid = placeCollider2D(solid, { x: 0, y: 0 }) as WorldAabbCollider2D;
    const placedSensor = placeCollider2D(sensor, { x: 0, y: 0 }) as WorldAabbCollider2D;
    assert.equal(placedSensor.sensor, true);
    assert.equal(placedSolid.sensor, undefined);
    // Geometry: both overlap the same circle identically.
    assert.equal(intersectsCircleAabb2D({ x: 5, y: 5, radius: 2 }, worldColliderBounds2D(placedSolid)), true);
    assert.equal(intersectsCircleAabb2D({ x: 5, y: 5, radius: 2 }, worldColliderBounds2D(placedSensor)), true);
  });
});

describe('collider records and placement', () => {
  it('constructs local colliders and places them at positive and negative positions', () => {
    const body = rectangleCollider2D({ offset: { x: -10, y: -18 }, width: 20, height: 36 });
    const hurtbox = circleCollider2D({ offset: { x: 0, y: -8 }, radius: 12, sensor: true, id: 'hurtbox' });

    const placedBody = placeCollider2D(body, { x: 120, y: 80 }) as WorldAabbCollider2D;
    assert.deepEqual(
      { x: placedBody.x, y: placedBody.y, width: placedBody.width, height: placedBody.height },
      { x: 110, y: 62, width: 20, height: 36 },
    );

    const placedHurtbox = placeCollider2D(hurtbox, { x: -40, y: -60 }) as WorldCircleCollider2D;
    assert.deepEqual({ x: placedHurtbox.x, y: placedHurtbox.y, radius: placedHurtbox.radius }, { x: -40, y: -68, radius: 12 });
    assert.equal(placedHurtbox.sensor, true);
    assert.equal(placedHurtbox.id, 'hurtbox');
  });

  it('preserves inputs and metadata during placement', () => {
    const filter: CollisionFilter2D = { categoryBits: 0b1, maskBits: 0b10 };
    const local = rectangleCollider2D({ offset: { x: 1, y: 2 }, width: 8, height: 4, filter, sensor: true, id: 'body' });
    const before = JSON.stringify(local);
    const world = placeCollider2D(local, { x: 10, y: 20 });
    assert.equal(JSON.stringify(local), before, 'the local collider is untouched');
    assert.deepEqual(world.filter, filter);
    assert.equal(world.sensor, true);
    assert.equal(world.id, 'body');
    assert.equal((world as WorldAabbCollider2D).space, 'world');
  });

  it('supports multiple named colliders on one object without engine behavior', () => {
    const object = {
      position: { x: 100, y: 100 },
      colliders: {
        body: rectangleCollider2D({ offset: { x: -10, y: -18 }, width: 20, height: 36 }),
        hurtbox: circleCollider2D({ offset: { x: 0, y: -8 }, radius: 12, sensor: true }),
        attack: rectangleCollider2D({ offset: { x: 10, y: -6 }, width: 16, height: 12, sensor: true }),
      },
    } as const;
    const body = placeCollider2D(object.colliders.body, object.position) as WorldAabbCollider2D;
    const hurtbox = placeCollider2D(object.colliders.hurtbox, object.position) as WorldCircleCollider2D;
    const attack = placeCollider2D(object.colliders.attack, object.position) as WorldAabbCollider2D;
    assert.equal(body.y, 82);
    assert.equal(hurtbox.y, 92);
    assert.equal(attack.x, 110);
    // No hidden behavior: each is independent plain data with the expected
    // world shape keys.
    assert.deepEqual(Object.keys(body).sort(), ['height', 'shape', 'space', 'width', 'x', 'y']);
  });

  it('rejects malformed collider construction', () => {
    assert.throws(() => rectangleCollider2D({ offset: { x: 0, y: 0 }, width: -1, height: 5 }), GeometryError);
    assert.throws(() => circleCollider2D({ offset: { x: 0, y: 0 }, radius: Number.NaN }), GeometryError);
    assert.throws(
      () => rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 5, height: 5, filter: { categoryBits: 2 ** 40, maskBits: 1 } }),
      GeometryError,
    );
  });

  it('keeps the local type distinct at the type level', () => {
    const local: LocalAabbCollider2D = rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 4, height: 4 });
    local satisfies LocalAabbCollider2D;
    void local;
  });
});
