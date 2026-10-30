import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  closestPointOnAabb2D,
  collideCircleAabb2D,
  sweepAabbAabb2D,
  sweepCircleAabb2D,
} from '../src/collision2d';
import { GeometryError } from '../src/geometry';
import type { Aabb2D, Point2D } from '../src/geometry';
import type { SweepAabbAabb2DOptions, SweepCircleAabb2DOptions } from '../src/collision2d';

const box: Aabb2D = { x: 10, y: 20, width: 30, height: 40 };

function geometryError(code: GeometryError['code'], field: string): (error: unknown) => boolean {
  return (error) => error instanceof GeometryError && error.code === code && error.field === field;
}

describe('closest-point query contract', () => {
  it('clamps exterior points and preserves interior points, including zero-size boxes', () => {
    assert.deepEqual(closestPointOnAabb2D({ x: 0, y: 30 }, box), { x: 10, y: 30 });
    assert.deepEqual(closestPointOnAabb2D({ x: 50, y: 70 }, box), { x: 40, y: 60 });
    assert.deepEqual(closestPointOnAabb2D({ x: 20, y: 10 }, box), { x: 20, y: 20 });
    assert.deepEqual(closestPointOnAabb2D({ x: 25, y: 40 }, box), { x: 25, y: 40 });
    assert.deepEqual(
      closestPointOnAabb2D({ x: 25, y: 40 }, { x: 10, y: 20, width: 0, height: 0 }),
      { x: 10, y: 20 },
    );
  });

  it('returns fresh frozen output without freezing or retaining caller-owned points', () => {
    const point = { x: 25, y: 40 };
    const bounds = { ...box };
    const result = closestPointOnAabb2D(point, bounds);
    assert.equal(Object.isFrozen(result), true);
    assert.notEqual(result, point);
    assert.notEqual(result, closestPointOnAabb2D(point, bounds));
    assert.equal(Object.isFrozen(point), false);
    assert.equal(Object.isFrozen(bounds), false);
    point.x = 99;
    bounds.x = 99;
    assert.deepEqual(result, { x: 25, y: 40 });
    assert.throws(() => {
      (result as { x: number }).x = 100;
    }, TypeError);
  });

  it('rejects malformed point and box records with structured errors', () => {
    for (const value of [null, undefined, [], () => undefined]) {
      assert.throws(
        () => closestPointOnAabb2D(value as unknown as Point2D, box),
        geometryError('GEOMETRY_INVALID_SHAPE', 'point'),
      );
      assert.throws(
        () => closestPointOnAabb2D({ x: 0, y: 0 }, value as unknown as Aabb2D),
        geometryError('GEOMETRY_INVALID_SHAPE', 'aabb'),
      );
    }
  });

  it('rejects nonfinite point coordinates and invalid sizes without coercion', () => {
    assert.throws(
      () => closestPointOnAabb2D({ x: Number.NaN, y: 0 }, box),
      geometryError('GEOMETRY_INVALID_NUMBER', 'point.x'),
    );
    assert.throws(
      () => closestPointOnAabb2D({ x: 0, y: Infinity }, box),
      geometryError('GEOMETRY_INVALID_NUMBER', 'point.y'),
    );
    assert.throws(
      () => closestPointOnAabb2D({ x: 0, y: 0 }, { ...box, width: -1 }),
      geometryError('GEOMETRY_INVALID_SIZE', 'aabb.width'),
    );
    assert.throws(
      () => closestPointOnAabb2D({ x: 0, y: 0 }, { ...box, height: Number.NaN }),
      geometryError('GEOMETRY_INVALID_NUMBER', 'aabb.height'),
    );
  });

  it('preserves immutable manifold results for a degenerate target and ordinary misses', () => {
    const hit = collideCircleAabb2D(
      { x: 7, y: 16, radius: 5 },
      { x: 10, y: 20, width: 0, height: 0 },
    );
    assert.ok(hit !== undefined);
    assert.deepEqual(hit.point, { x: 10, y: 20 });
    assert.deepEqual(hit.normal, { x: -0.6, y: -0.8 });
    assert.equal(hit.depth, 0);
    assert.equal(Object.isFrozen(hit.point), true);
    assert.equal(Object.isFrozen(hit.normal), true);
    assert.equal(Object.isFrozen(hit), true);
    assert.equal(collideCircleAabb2D({ x: 0, y: 0, radius: 1 }, box), undefined);
  });
});

describe('sweep options record validation', () => {
  it('rejects malformed options before reading their fields', () => {
    for (const options of [null, undefined, [], () => undefined]) {
      assert.throws(
        () => sweepCircleAabb2D(options as unknown as SweepCircleAabb2DOptions),
        geometryError('GEOMETRY_INVALID_SHAPE', 'options'),
      );
      assert.throws(
        () => sweepAabbAabb2D(options as unknown as SweepAabbAabb2DOptions),
        geometryError('GEOMETRY_INVALID_SHAPE', 'options'),
      );
    }
  });
});
