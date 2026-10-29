import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCamera2D } from '../src/camera2d.ts';
import { canCollide2D, pointInAabb2D } from '../src/collision2d.ts';
import {
  aabbCenter2D,
  expandAabb2D,
  GeometryError,
  scaleVector2D,
  type GeometryErrorCode,
} from '../src/geometry.ts';
import {
  assertFiniteNumber,
  assertNonnegativeSize,
  assertUnsigned32Bits,
  assertValidAabb2D,
  assertValidCircle2D,
  assertValidPoint2D,
  assertValidSegment2D,
  assertValidVector2D,
} from '../src/geometry/validation.ts';

const box = Object.freeze({ x: 10, y: 20, width: 30, height: 40 });

function expectGeometryError(
  action: () => unknown,
  code: GeometryErrorCode,
  field: string,
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof GeometryError);
    assert.equal(error.code, code);
    assert.equal(error.field, field);
    return true;
  });
}

function invalidNumbers(): { values: readonly unknown[]; coercionCount: () => number } {
  let calls = 0;
  const fail = () => {
    calls += 1;
    throw new Error('diagnostics must not execute coercion hooks');
  };
  return {
    values: [
      Object.create(null),
      { toString: fail },
      { [Symbol.toPrimitive]: fail },
      Object.assign(() => undefined, { toString: fail, [Symbol.toPrimitive]: fail }),
    ],
    coercionCount: () => calls,
  };
}

describe('geometry boundary errors', () => {
  it('rejects malformed inset shapes before reading per-axis components', () => {
    const malformed: readonly unknown[] = [
      null,
      undefined,
      true,
      '2',
      2n,
      Symbol('inset'),
      [],
      Object.assign([], { x: 1, y: 1 }),
      Object.assign(() => undefined, { x: 1, y: 1 }),
    ];
    for (const inset of malformed) {
      expectGeometryError(
        () => expandAabb2D(box, inset as never),
        'GEOMETRY_INVALID_SHAPE',
        'inset',
      );
    }
  });

  it('keeps inset field paths for missing and non-finite numeric values', () => {
    for (const inset of [NaN, Infinity, -Infinity]) {
      expectGeometryError(() => expandAabb2D(box, inset), 'GEOMETRY_INVALID_NUMBER', 'inset.x');
    }
    expectGeometryError(() => expandAabb2D(box, {} as never), 'GEOMETRY_INVALID_NUMBER', 'inset.x');
    expectGeometryError(() => expandAabb2D(box, { x: 1 } as never), 'GEOMETRY_INVALID_NUMBER', 'inset.y');
    expectGeometryError(() => expandAabb2D(box, -16), 'GEOMETRY_INVALID_SIZE', 'expanded.width');
  });

  it('reports invalid numeric fields and scalars without executing coercion hooks', () => {
    const { values, coercionCount } = invalidNumbers();
    for (const value of values) {
      expectGeometryError(() => assertFiniteNumber(value as never, 'number'), 'GEOMETRY_INVALID_NUMBER', 'number');
      expectGeometryError(() => assertNonnegativeSize(value as never, 'size'), 'GEOMETRY_INVALID_NUMBER', 'size');
      expectGeometryError(() => assertUnsigned32Bits(value as never, 'bits'), 'GEOMETRY_INVALID_BITS', 'bits');
      expectGeometryError(() => aabbCenter2D({ ...box, x: value as never }), 'GEOMETRY_INVALID_NUMBER', 'aabb.x');
      expectGeometryError(() => expandAabb2D(box, { x: value as never, y: 1 }), 'GEOMETRY_INVALID_NUMBER', 'inset.x');
      expectGeometryError(() => expandAabb2D(box, { x: 1, y: value as never }), 'GEOMETRY_INVALID_NUMBER', 'inset.y');
      expectGeometryError(() => scaleVector2D({ x: 1, y: 2 }, value as never), 'GEOMETRY_INVALID_NUMBER', 'scalar');
    }
    assert.equal(coercionCount(), 0);
  });

  it('reports malformed outer records without coercing functions', () => {
    const { values, coercionCount } = invalidNumbers();
    const invalidFunction = values[3];
    const validators = [
      { name: 'point', validate: assertValidPoint2D },
      { name: 'vector', validate: assertValidVector2D },
      { name: 'aabb', validate: assertValidAabb2D },
      { name: 'circle', validate: assertValidCircle2D },
      { name: 'segment', validate: assertValidSegment2D },
    ];
    for (const { name, validate } of validators) {
      for (const value of [invalidFunction, null, undefined, [], 12, false, 'shape', 1n, Symbol('shape')]) {
        expectGeometryError(() => validate(value as never), 'GEOMETRY_INVALID_SHAPE', name);
      }
    }
    assert.equal(coercionCount(), 0);
  });

  it('retains useful primitive numeric diagnostics and rejects coercible values', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => assertFiniteNumber(value, 'number'), {
        code: 'GEOMETRY_INVALID_NUMBER',
        field: 'number',
        message: `GEOMETRY_INVALID_NUMBER at number: expected a finite number, got ${String(value)}`,
      });
    }
    for (const value of [null, undefined, true, '2', 2n, Symbol('number'), new Number(2)]) {
      expectGeometryError(() => assertFiniteNumber(value as never, 'number'), 'GEOMETRY_INVALID_NUMBER', 'number');
      expectGeometryError(() => assertUnsigned32Bits(value as never, 'bits'), 'GEOMETRY_INVALID_BITS', 'bits');
    }
    for (const value of [-1, 0.5, 0x100000000]) {
      expectGeometryError(() => assertUnsigned32Bits(value, 'bits'), 'GEOMETRY_INVALID_BITS', 'bits');
    }
    assert.doesNotThrow(() => assertUnsigned32Bits(0, 'bits'));
    assert.doesNotThrow(() => assertUnsigned32Bits(0xffffffff, 'bits'));
  });

  it('reports nested shape and numeric paths for segments', () => {
    expectGeometryError(() => assertValidSegment2D({ start: null, end: { x: 1, y: 1 } } as never), 'GEOMETRY_INVALID_SHAPE', 'segment.start');
    expectGeometryError(() => assertValidSegment2D({ start: { x: 1, y: 1 } } as never), 'GEOMETRY_INVALID_SHAPE', 'segment.end');
    expectGeometryError(() => assertValidSegment2D({ start: { x: 1, y: 1 }, end: { x: 2 } } as never), 'GEOMETRY_INVALID_NUMBER', 'segment.end.y');
    expectGeometryError(() => assertValidSegment2D({ start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }), 'GEOMETRY_INVALID_SEGMENT', 'segment');
    assert.doesNotThrow(() => assertValidSegment2D({ start: { x: 1, y: 1 }, end: { x: 1, y: 2 } }));
  });

  it('preserves structured errors in camera and collision operations using shared validation', () => {
    const { values, coercionCount } = invalidNumbers();
    for (const value of values) {
      expectGeometryError(() => createCamera2D({ center: { x: value as never, y: 0 } }), 'GEOMETRY_INVALID_NUMBER', 'camera.center.x');
      expectGeometryError(() => createCamera2D({ zoom: value as never }), 'GEOMETRY_INVALID_NUMBER', 'camera.zoom');
      expectGeometryError(() => pointInAabb2D({ x: value as never, y: 0 }, box), 'GEOMETRY_INVALID_NUMBER', 'point.x');
      expectGeometryError(
        () => canCollide2D({ categoryBits: value as never, maskBits: 1 }, { categoryBits: 1, maskBits: 1 }),
        'GEOMETRY_INVALID_BITS',
        'first.categoryBits',
      );
    }
    assert.equal(coercionCount(), 0);
  });
});
