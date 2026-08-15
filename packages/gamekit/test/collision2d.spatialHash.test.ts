/**
 * T11.5: deterministic spatial hash broad phase.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSpatialHash2D,
  querySpatialHash2D,
  GeometryError,
  type Aabb2D,
} from '../src/index';

const items = [
  { id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } as Aabb2D },
  { id: 'b', bounds: { x: 20, y: 20, width: 10, height: 10 } as Aabb2D },
  { id: 'c', bounds: { x: -10, y: -10, width: 100, height: 100 } as Aabb2D },
];

describe('spatial hash broad phase', () => {
  it('queries empty, single-cell, multi-cell, and negative-coordinate regions', () => {
    const index = buildSpatialHash2D({ items, cellSize: 16 });
    // Bounds ending exactly on a cell boundary conservatively include the
    // neighbor cell (b lives in cell (1,1)), so it appears as a candidate.
    assert.deepEqual(querySpatialHash2D(index, { x: 0, y: 0, width: 16, height: 16 }), ['a', 'b', 'c']);
    assert.deepEqual(querySpatialHash2D(index, { x: 0, y: 0, width: 15, height: 15 }), ['a', 'c']);
    assert.deepEqual(querySpatialHash2D(index, { x: 30, y: 30, width: 1, height: 1 }), ['b', 'c']);
    // Negative coordinates work; keep the query strictly inside cell -1.
    assert.deepEqual(querySpatialHash2D(index, { x: -16, y: -16, width: 15, height: 15 }), ['c']);
    const empty = buildSpatialHash2D({ items: [], cellSize: 16 });
    assert.deepEqual(querySpatialHash2D(empty, { x: 0, y: 0, width: 10, height: 10 }), []);
  });

  it('returns one large item exactly once even across many cells', () => {
    const index = buildSpatialHash2D({ items, cellSize: 8 });
    const result = querySpatialHash2D(index, { x: 0, y: 0, width: 8, height: 8 });
    assert.equal(result.filter((id) => id === 'c').length, 1, 'no duplicate candidates');
  });

  it('is deterministic across rebuilds and preserves insertion order', () => {
    const first = buildSpatialHash2D({ items, cellSize: 16 });
    const second = buildSpatialHash2D({ items, cellSize: 16 });
    const bounds = { x: 5, y: 5, width: 30, height: 30 };
    assert.deepEqual(querySpatialHash2D(first, bounds), querySpatialHash2D(second, bounds));
    const result = querySpatialHash2D(first, bounds);
    assert.deepEqual(result, [...result].sort((x, y) => items.findIndex((i) => i.id === x) - items.findIndex((i) => i.id === y)), 'insertion order');
  });

  it('includes every true overlap from a brute-force oracle', () => {
    const index = buildSpatialHash2D({ items, cellSize: 16 });
    const bounds = { x: 5, y: 5, width: 30, height: 30 };
    const expected = items
      .filter((item) => overlaps(item.bounds, bounds))
      .map((item) => item.id);
    const candidates = querySpatialHash2D(index, bounds);
    for (const id of expected) {
      assert.ok(candidates.includes(id), `${id} is a true overlap and must be a candidate`);
    }
  });

  it('fails clearly on duplicate ids and invalid cell sizes', () => {
    assert.throws(
      () => buildSpatialHash2D({ items: [items[0]!, { ...items[1]!, id: 'a' }], cellSize: 16 }),
      /duplicate/,
    );
    assert.throws(() => buildSpatialHash2D({ items, cellSize: 0 }), GeometryError);
    assert.throws(() => buildSpatialHash2D({ items, cellSize: -4 }), GeometryError);
    assert.throws(() => buildSpatialHash2D({ items, cellSize: Number.NaN }), GeometryError);
  });
});

function overlaps(first: Aabb2D, second: Aabb2D): boolean {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
}
