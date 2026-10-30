import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSpatialHash2D,
  querySpatialHash2D,
  type BuildSpatialHash2DOptions,
  type SpatialHashIndex2D,
  type SpatialHashItem2D,
} from '../src/collision2d/spatialHash';
import { GeometryError } from '../src/geometry/validation';

const referenceBudget = 262_144;
const point = { x: 0, y: 0, width: 0, height: 0 };
const bounds = { x: 0, y: 0, width: 255, height: 255 };

function overlapsAtBudget(): SpatialHashItem2D[] {
  // 1,024 overlapping items, each occupying 16 × 16 cells. Counting only
  // distinct occupied cells would miss the 262,144 stored references.
  return Array.from({ length: referenceBudget / 256 }, (_, id) => ({ id: String(id), bounds }));
}

function hasError(code: GeometryError['code'], field?: string): (error: unknown) => boolean {
  return (error) => error instanceof GeometryError && error.code === code &&
    (field === undefined || error.field === field);
}

describe('spatial hash aggregate work budget', () => {
  it('accepts exactly the aggregate budget with overlapping cells and ordered candidates', () => {
    const items = overlapsAtBudget();
    const index = buildSpatialHash2D({ items, cellSize: 16 });
    assert.deepEqual(querySpatialHash2D(index, bounds), items.map((item) => item.id));
    assert.equal(Object.isFrozen(items), false);
    assert.equal(Object.isFrozen(bounds), false);
    assert.equal(Object.isFrozen(index.items[0]!.bounds), true);
  });

  it('rejects one additional reference even when every individual span is small', () => {
    assert.throws(
      () => buildSpatialHash2D({ items: [...overlapsAtBudget(), { id: 'extra', bounds: point }], cellSize: 16 }),
      hasError('GEOMETRY_SPATIAL_INDEX_RANGE', 'items'),
    );
  });

  it('rejects oversized item counts before reading any item', () => {
    const items = new Array<SpatialHashItem2D>(referenceBudget + 1);
    Object.defineProperty(items, 0, { get: () => { throw new Error('must not visit oversized input'); } });
    assert.throws(
      () => buildSpatialHash2D({ items, cellSize: 16 }),
      hasError('GEOMETRY_SPATIAL_INDEX_RANGE', 'items'),
    );
  });
});

describe('spatial hash input and handle ownership', () => {
  it('rejects malformed options, collections, and items with structured errors', () => {
    for (const options of [null, undefined, [], 2]) {
      assert.throws(
        () => buildSpatialHash2D(options as unknown as BuildSpatialHash2DOptions),
        hasError('GEOMETRY_INVALID_SHAPE', 'options'),
      );
    }
    for (const items of [undefined, null, {}, 'items', new Set()]) {
      assert.throws(
        () => buildSpatialHash2D({ items, cellSize: 16 } as unknown as BuildSpatialHash2DOptions),
        hasError('GEOMETRY_INVALID_SHAPE', 'items'),
      );
    }
    for (const item of [null, undefined, [], 'item']) {
      assert.throws(
        () => buildSpatialHash2D({ items: [item], cellSize: 16 } as unknown as BuildSpatialHash2DOptions),
        hasError('GEOMETRY_INVALID_SHAPE', 'items.0'),
      );
    }
  });

  it('requires string IDs without coercing invalid IDs or cell sizes', () => {
    const hostile = { toString: () => { throw new Error('coercion must not run'); } };
    for (const id of [undefined, null, 0, Symbol('id'), Object.create(null), hostile]) {
      assert.throws(
        () => buildSpatialHash2D({ items: [{ id, bounds: point }], cellSize: 16 } as unknown as BuildSpatialHash2DOptions),
        hasError('GEOMETRY_INVALID_SHAPE', 'items.0.id'),
      );
    }
    for (const cellSize of [Object.create(null), hostile]) {
      assert.throws(
        () => buildSpatialHash2D({ items: [], cellSize }),
        hasError('GEOMETRY_INVALID_NUMBER', 'cellSize'),
      );
    }
    const index = buildSpatialHash2D({ items: [{ id: '', bounds: point }], cellSize: 16 });
    assert.deepEqual(querySpatialHash2D(index, point), [''], 'an empty string is a valid unique ID');
  });

  it('copies only canonical AABB fields without retaining caller extensions', () => {
    const extra = { nested: { value: 1 } };
    const inputBounds = { ...point, ...extra };
    const item = { id: 'source', bounds: inputBounds };
    const index = buildSpatialHash2D({ items: [item], cellSize: 16 });
    assert.deepEqual(index.items[0]!.bounds, point);
    inputBounds.x = 100;
    item.id = 'changed';
    assert.deepEqual(querySpatialHash2D(index, point), ['source']);
    assert.equal(Object.isFrozen(inputBounds), false);
    assert.equal(Object.isFrozen(extra.nested), false);
  });

  it('rejects forged and copied process-local handles without changing the original', () => {
    const index = buildSpatialHash2D({ items: [{ id: 'source', bounds: point }], cellSize: 16 });
    for (const copied of [null, {}, { ...index }, structuredClone(index), JSON.parse(JSON.stringify(index))]) {
      assert.throws(
        () => querySpatialHash2D(copied as SpatialHashIndex2D, point),
        hasError('GEOMETRY_INVALID_NUMBER', 'index'),
      );
    }
    assert.deepEqual(querySpatialHash2D(index, point), ['source']);
  });
});
