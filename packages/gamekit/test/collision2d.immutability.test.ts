/**
 * RED (T11-F5): caller-owned inputs must never leak into immutable
 * outputs, and the spatial hash must fail fast on unbounded spans.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSpatialHash2D,
  GeometryError,
  placeCollider2D,
  querySpatialHash2D,
  rectangleCollider2D,
} from '../src/index';

describe('collider filter immutability (T11-F5)', () => {
  it('isolates colliders from later mutation of the input filter', () => {
    // Typed as a mutable caller-owned record (the API accepts it
    // structurally); the collider must clone it.
    const filter = { categoryBits: 0b1, maskBits: 0b10 } as { categoryBits: number; maskBits: number };
    const local = rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 10, height: 10, filter });
    const placed = placeCollider2D(local, { x: 5, y: 5 });

    // The caller mutates its own object.
    filter.categoryBits = 0b100;
    filter.maskBits = 0b1000;

    assert.deepEqual(local.filter, { categoryBits: 0b1, maskBits: 0b10 }, 'the local collider is unchanged');
    assert.deepEqual(placed.filter, { categoryBits: 0b1, maskBits: 0b10 }, 'the placed collider is unchanged');
  });

  it('leaves constructor inputs unfrozen and otherwise untouched', () => {
    const filter = { categoryBits: 0b1, maskBits: 0b10 };
    const offset = { x: 3, y: 4 };
    rectangleCollider2D({ offset, width: 5, height: 5, filter });
    assert.equal(Object.isFrozen(filter), false, 'the caller filter is not frozen');
    assert.equal(Object.isFrozen(offset), false, 'the caller offset is not frozen');
    assert.deepEqual(filter, { categoryBits: 0b1, maskBits: 0b10 });
  });
});

describe('spatial hash immutability (T11-F5)', () => {
  it('ignores later mutation of the caller item and its nested bounds', () => {
    const item = { id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } };
    const index = buildSpatialHash2D({ items: [item], cellSize: 16 });

    // The caller mutates the ORIGINAL object and its nested bounds.
    item.bounds.x = 500;
    item.bounds.width = 500;

    assert.deepEqual(index.items[0]!.bounds, { x: 0, y: 0, width: 10, height: 10 }, 'the public view is cloned');
    assert.equal(Object.isFrozen(index.items[0]), true);
    assert.equal(Object.isFrozen(index.items[0]!.bounds), true);
    // The buckets were built from the cloned bounds: a query over the
    // original location still finds the item.
    assert.deepEqual(querySpatialHash2D(index, { x: 0, y: 0, width: 16, height: 16 }), ['a']);
    // The caller's object itself is untouched (not frozen).
    assert.equal(Object.isFrozen(item), false);
  });

  it('fails fast on unbounded spans and unsafe indices', () => {
    assert.throws(
      () =>
        buildSpatialHash2D({
          items: [{ id: 'huge', bounds: { x: 0, y: 0, width: 1e9, height: 10 } }],
          cellSize: 16,
        }),
      (error: unknown) =>
        error instanceof GeometryError && error.code === 'GEOMETRY_SPATIAL_INDEX_RANGE',
    );
    assert.throws(
      () => querySpatialHash2D(buildSpatialHash2D({ items: [], cellSize: 16 }), { x: 0, y: 0, width: 1e9, height: 1e9 }),
      GeometryError,
    );
    assert.throws(
      () =>
        buildSpatialHash2D({
          items: [{ id: 'a', bounds: { x: 1e300, y: 0, width: 10, height: 10 } }],
          cellSize: 16,
        }),
      (error: unknown) =>
        error instanceof GeometryError && error.code === 'GEOMETRY_SPATIAL_INDEX_RANGE',
    );
  });

  it('returns frozen query results that reject runtime mutation (T11-FF5)', () => {
    const index = buildSpatialHash2D({
      items: [{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } }],
      cellSize: 16,
    });
    const empty = querySpatialHash2D(index, { x: 500, y: 500, width: 4, height: 4 });
    assert.equal(Object.isFrozen(empty), true, 'the empty result is frozen');
    const result = querySpatialHash2D(index, { x: 0, y: 0, width: 4, height: 4 });
    assert.equal(Object.isFrozen(result), true, 'the result is frozen');
    assert.throws(() => {
      (result as string[]).push('mutated');
    }, TypeError);
  });

  it('enforces the per-axis cell maximum as occupied cells (T11-FF5)', () => {
    // Exactly 1024 occupied cells: allowed.
    const at = buildSpatialHash2D({
      items: [{ id: 'a', bounds: { x: 0, y: 0, width: 16 * 1024 - 1, height: 4 } }],
      cellSize: 16,
    });
    assert.ok(at !== undefined);
    // 1025 occupied cells: rejected with the structured range error.
    assert.throws(
      () =>
        buildSpatialHash2D({
          items: [{ id: 'a', bounds: { x: 0, y: 0, width: 16 * 1024, height: 4 } }],
          cellSize: 16,
        }),
      (error: unknown) =>
        error instanceof GeometryError && error.code === 'GEOMETRY_SPATIAL_INDEX_RANGE',
    );
    // Zero-size bounds exactly on a cell boundary occupy one cell.
    const boundary = buildSpatialHash2D({
      items: [{ id: 'a', bounds: { x: 16, y: 16, width: 0, height: 0 } }],
      cellSize: 16,
    });
    assert.deepEqual(querySpatialHash2D(boundary, { x: 16, y: 16, width: 0, height: 0 }), ['a']);
  });

  it('uses the structured duplicate-id error', () => {
    assert.throws(
      () =>
        buildSpatialHash2D({
          items: [
            { id: 'a', bounds: { x: 0, y: 0, width: 1, height: 1 } },
            { id: 'a', bounds: { x: 5, y: 5, width: 1, height: 1 } },
          ],
          cellSize: 16,
        }),
      (error: unknown) =>
        error instanceof GeometryError && error.code === 'GEOMETRY_DUPLICATE_ID',
    );
  });
});
