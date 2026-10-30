import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALL_FILTER2D,
  canCollide2D,
  circleCollider2D,
  collideWorldColliders2D,
  NONE_FILTER2D,
  placeCollider2D,
  projectHit2D,
  projectSweepPath2D,
  projectVector2D,
  projectWorldCollider2D,
  rectangleCollider2D,
  worldColliderBounds2D,
  worldColliderCircle2D,
  type LocalCollider2D,
  type WorldCollider2D,
} from '../src/collision2d';
import { GeometryError, type GeometryErrorCode } from '../src/geometry';

const circle = { space: 'world', shape: 'circle', x: 1, y: 2, radius: 3 } as const;
const aabb = { space: 'world', shape: 'aabb', x: 1, y: 2, width: 3, height: 4 } as const;
const localCircle = { space: 'local', shape: 'circle', offset: { x: 1, y: 2 }, radius: 3 } as const;
const localAabb = { space: 'local', shape: 'aabb', offset: { x: 1, y: 2 }, width: 3, height: 4 } as const;
const malformedRecords = [null, undefined, false, 1, 'record', [], () => undefined];

function expectError(action: () => unknown, code: GeometryErrorCode, field: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof GeometryError);
    assert.equal(error.code, code);
    assert.equal(error.field, field);
    return true;
  });
}

describe('collision filter and constructor boundaries', () => {
  it('validates both filter records before reading their bits or returning a mismatch', () => {
    for (const value of malformedRecords) {
      expectError(() => canCollide2D(value as never, ALL_FILTER2D), 'GEOMETRY_INVALID_SHAPE', 'first');
      expectError(() => canCollide2D(NONE_FILTER2D, value as never), 'GEOMETRY_INVALID_SHAPE', 'second');
    }
    expectError(() => canCollide2D(ALL_FILTER2D, { categoryBits: 1, maskBits: -1 }), 'GEOMETRY_INVALID_BITS', 'second.maskBits');
    expectError(() => canCollide2D(NONE_FILTER2D, {} as never), 'GEOMETRY_INVALID_BITS', 'second.categoryBits');
  });

  it('validates constructor options and offsets before copying them', () => {
    for (const value of malformedRecords) {
      expectError(() => rectangleCollider2D(value as never), 'GEOMETRY_INVALID_SHAPE', 'options');
      expectError(() => circleCollider2D(value as never), 'GEOMETRY_INVALID_SHAPE', 'options');
      expectError(() => rectangleCollider2D({ offset: value, width: 1, height: 1 } as never), 'GEOMETRY_INVALID_SHAPE', 'collider.offset');
      expectError(() => circleCollider2D({ offset: value, radius: 1 } as never), 'GEOMETRY_INVALID_SHAPE', 'collider.offset');
    }
    expectError(() => circleCollider2D({ offset: { x: 1 } as never, radius: 1 }), 'GEOMETRY_INVALID_NUMBER', 'collider.offset.y');
    expectError(() => rectangleCollider2D({ offset: { x: 0, y: 0 }, width: -1, height: 1 }), 'GEOMETRY_INVALID_SIZE', 'collider.width');
    expectError(() => rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 1, height: NaN }), 'GEOMETRY_INVALID_NUMBER', 'collider.height');
    expectError(() => circleCollider2D({ offset: { x: 0, y: 0 }, radius: -1 }), 'GEOMETRY_INVALID_SIZE', 'collider.radius');
  });

  it('rejects malformed optional metadata without coercion', () => {
    for (const construct of [
      (metadata: object) => circleCollider2D({ offset: { x: 0, y: 0 }, radius: 1, ...metadata }),
      (metadata: object) => rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 1, height: 1, ...metadata }),
    ]) {
      for (const filter of malformedRecords.filter((value) => value !== undefined)) {
        expectError(() => construct({ filter }), 'GEOMETRY_INVALID_SHAPE', 'filter');
      }
      expectError(() => construct({ filter: { categoryBits: 1, maskBits: -1 } }), 'GEOMETRY_INVALID_BITS', 'filter.maskBits');
      for (const sensor of [null, 0, 1, 'true', {}]) {
        expectError(() => construct({ sensor }), 'GEOMETRY_INVALID_SHAPE', 'sensor');
      }
      for (const id of [null, 0, true, {}, []]) {
        expectError(() => construct({ id }), 'GEOMETRY_INVALID_SHAPE', 'id');
      }
      assert.doesNotThrow(() => construct({ filter: undefined, sensor: false, id: '' }));
    }
  });
});

describe('collider placement and ownership boundaries', () => {
  it('validates local tags, geometry, and metadata before translating', () => {
    for (const value of malformedRecords) {
      expectError(() => placeCollider2D(value as never, { x: 0, y: 0 }), 'GEOMETRY_INVALID_SHAPE', 'local');
    }
    for (const local of [localCircle, localAabb]) {
      expectError(() => placeCollider2D({ ...local, space: 'world' } as never, { x: 0, y: 0 }), 'GEOMETRY_INVALID_SHAPE', 'local.space');
      expectError(() => placeCollider2D({ ...local, shape: 'triangle' } as never, { x: 0, y: 0 }), 'GEOMETRY_INVALID_SHAPE', 'local.shape');
      expectError(() => placeCollider2D({ ...local, offset: null } as never, { x: 0, y: 0 }), 'GEOMETRY_INVALID_SHAPE', 'local.offset');
      expectError(() => placeCollider2D({ ...local, filter: null } as never, { x: 0, y: 0 }), 'GEOMETRY_INVALID_SHAPE', 'local.filter');
      expectError(() => placeCollider2D({ ...local, sensor: 1 } as never, { x: 0, y: 0 }), 'GEOMETRY_INVALID_SHAPE', 'local.sensor');
    }
    expectError(() => placeCollider2D({ ...localAabb, width: -1 }, { x: 0, y: 0 }), 'GEOMETRY_INVALID_SIZE', 'local.width');
    expectError(() => placeCollider2D({ ...localCircle, radius: NaN }, { x: 0, y: 0 }), 'GEOMETRY_INVALID_NUMBER', 'local.radius');
    expectError(() => placeCollider2D(localCircle, null as never), 'GEOMETRY_INVALID_SHAPE', 'position');
  });

  it('owns a frozen filter even for structurally typed caller-created local records', () => {
    for (const shape of [localCircle, localAabb]) {
      const filter = { categoryBits: 1, maskBits: 2 };
      const local: LocalCollider2D = { ...shape, offset: { x: 1, y: 2 }, filter };
      const world = placeCollider2D(local, { x: 5, y: 6 });
      assert.notEqual(world.filter, filter);
      assert.equal(Object.isFrozen(world.filter), true);
      assert.equal(Object.isFrozen(world), true);
      filter.categoryBits = 8;
      filter.maskBits = 16;
      assert.deepEqual(world.filter, { categoryBits: 1, maskBits: 2 });
      assert.equal(Object.isFrozen(local), false);
      assert.equal(Object.isFrozen(local.offset), false);
      assert.equal(Object.isFrozen(filter), false);
    }
  });
});

describe('world collider boundaries', () => {
  const views = [worldColliderBounds2D, worldColliderCircle2D, projectWorldCollider2D];

  it('requires world-space tags and valid geometry in every public view', () => {
    for (const view of views) {
      for (const value of malformedRecords) {
        expectError(() => view(value as never), 'GEOMETRY_INVALID_SHAPE', 'world');
      }
      for (const world of [circle, aabb]) {
        expectError(() => view({ ...world, space: 'local' } as never), 'GEOMETRY_INVALID_SHAPE', 'world.space');
        expectError(() => view({ ...world, shape: 'triangle' } as never), 'GEOMETRY_INVALID_SHAPE', 'world.shape');
        expectError(() => view({ ...world, x: NaN }), 'GEOMETRY_INVALID_NUMBER', 'world.x');
        expectError(() => view({ ...world, filter: null } as never), 'GEOMETRY_INVALID_SHAPE', 'world.filter');
        expectError(() => view({ ...world, id: false } as never), 'GEOMETRY_INVALID_SHAPE', 'world.id');
      }
      expectError(() => view({ ...circle, radius: -1 }), 'GEOMETRY_INVALID_SIZE', 'world.radius');
      expectError(() => view({ ...aabb, height: -1 }), 'GEOMETRY_INVALID_SIZE', 'world.height');
    }
  });

  it('never hides invalid world records behind a filter mismatch', () => {
    for (const malformed of [
      { ...circle, radius: -1 },
      { ...aabb, width: -1 },
    ]) {
      const field = malformed.shape === 'circle' ? 'radius' : 'width';
      expectError(() => collideWorldColliders2D({ ...malformed, filter: NONE_FILTER2D }, circle), 'GEOMETRY_INVALID_SIZE', `first.${field}`);
      expectError(() => collideWorldColliders2D({ ...circle, filter: NONE_FILTER2D }, malformed), 'GEOMETRY_INVALID_SIZE', `second.${field}`);
    }
    expectError(() => collideWorldColliders2D(null as never, circle), 'GEOMETRY_INVALID_SHAPE', 'first');
    expectError(() => collideWorldColliders2D({ ...circle, filter: NONE_FILTER2D }, null as never), 'GEOMETRY_INVALID_SHAPE', 'second');
    expectError(() => collideWorldColliders2D({ ...circle, filter: null } as never, circle), 'GEOMETRY_INVALID_SHAPE', 'first.filter');
    expectError(() => collideWorldColliders2D(circle, { ...circle, filter: { categoryBits: -1, maskBits: 0 } }), 'GEOMETRY_INVALID_BITS', 'second.filter.categoryBits');
    assert.equal(collideWorldColliders2D({ ...circle, filter: NONE_FILTER2D }, aabb), undefined);
  });

  it('returns owned immutable views and preserves valid AABB absence from circle views', () => {
    assert.equal(worldColliderCircle2D(aabb), undefined);
    for (const world of [circle, aabb]) {
      for (const view of views) {
        const result = view(world);
        if (result !== undefined) assert.equal(Object.isFrozen(result), true);
      }
      assert.equal(Object.isFrozen(world), false);
    }
    assert.deepEqual(worldColliderCircle2D(circle), { x: 1, y: 2, radius: 3 });
    assert.deepEqual(worldColliderBounds2D(circle), { x: -2, y: -1, width: 6, height: 6 });
  });
});

describe('debug projection boundaries', () => {
  const hit = { point: { x: 1, y: 2 }, normal: { x: 0, y: 1 }, depth: 3 };

  it('validates hit records and their numeric components', () => {
    for (const value of malformedRecords) {
      expectError(() => projectHit2D(value as never), 'GEOMETRY_INVALID_SHAPE', 'hit');
    }
    expectError(() => projectHit2D({ ...hit, point: null } as never), 'GEOMETRY_INVALID_SHAPE', 'hit.point');
    expectError(() => projectHit2D({ ...hit, normal: null } as never), 'GEOMETRY_INVALID_SHAPE', 'hit.normal');
    expectError(() => projectHit2D({ ...hit, point: { x: NaN, y: 2 } }), 'GEOMETRY_INVALID_NUMBER', 'hit.point.x');
    expectError(() => projectHit2D({ ...hit, normal: { x: 0, y: Infinity } }), 'GEOMETRY_INVALID_NUMBER', 'hit.normal.y');
    expectError(() => projectHit2D({ ...hit, depth: -1 }), 'GEOMETRY_INVALID_SIZE', 'hit.depth');
  });

  it('rejects malformed labels without executing object conversion hooks', () => {
    const hostile = { toString: () => { throw new Error('must not coerce'); } };
    for (const label of [null, 1, true, [], hostile]) {
      expectError(() => projectSweepPath2D(hit.point, hit.point, label as never), 'GEOMETRY_INVALID_SHAPE', 'label');
      expectError(() => projectVector2D(hit.point, hit.normal, label as never), 'GEOMETRY_INVALID_SHAPE', 'label');
      expectError(() => projectWorldCollider2D({ ...circle, id: label } as unknown as WorldCollider2D), 'GEOMETRY_INVALID_SHAPE', 'world.id');
    }
    assert.doesNotThrow(() => projectSweepPath2D(hit.point, hit.point, ''));
    assert.doesNotThrow(() => projectVector2D(hit.point, hit.normal, 'normal'));
  });

  it('copies hit vectors without freezing or retaining caller-owned objects', () => {
    const result = projectHit2D(hit);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.point), true);
    assert.equal(Object.isFrozen(result.normal), true);
    assert.equal(Object.isFrozen(hit), false);
    assert.equal(Object.isFrozen(hit.point), false);
    assert.equal(Object.isFrozen(hit.normal), false);
    assert.deepEqual(result.point, { kind: 'point', x: 1, y: 2 });
    assert.deepEqual(result.normal, { kind: 'vector', x: 1, y: 2, dx: 0, dy: 1 });
  });
});
