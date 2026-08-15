/**
 * T11-F8: the guide's broad-phase flow compiles and executes against the
 * shipped API: object-owned lookup, skip-self, explicit missing ids, and a
 * moved collider found after an index update.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { broadPhaseExample } from '../../../apps/playground/src/docs-examples/broadphase-guide.ts';
import {
  buildSpatialHash2D,
  circleCollider2D,
  placeCollider2D,
  querySpatialHash2D,
  rectangleCollider2D,
  worldColliderBounds2D,
  type WorldCollider2D,
} from '../src/index';

describe('broad-phase guide example', () => {
  it('keeps the MDX snippet byte-equal to the compile-checked fixture (FF6)', () => {
    // The package tests run with cwd = packages/gamekit.
    const mdx = readFileSync('../../apps/docs/content/docs/guides/detect-collisions.mdx', 'utf8');
    const fixture = readFileSync('../../apps/playground/src/docs-examples/broadphase-guide.ts', 'utf8');
    const start = mdx.indexOf('```ts\n' + fixture.split('\n')[0]);
    assert.ok(start >= 0, 'the fixture header opens the fenced block');
    const block = mdx.slice(start + 6, mdx.indexOf('```', start + 6)).trim();
    assert.equal(block, fixture.trim(), 'the MDX block is the exact fixture');
  });

  it('skips a stale candidate id deliberately (FF6)', () => {
    const colliders = new Map<string, WorldCollider2D>();
    colliders.set('player', placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 10 }), { x: 60, y: 60 }));
    // The index references an id the application no longer owns.
    const index = buildSpatialHash2D({
      items: [
        { id: 'player', bounds: worldColliderBounds2D(colliders.get('player')!) },
        { id: 'ghost', bounds: { x: 55, y: 55, width: 10, height: 10 } },
      ],
      cellSize: 32,
    });
    const moving = colliders.get('player')!;
    const candidates = querySpatialHash2D(index, worldColliderBounds2D(moving));
    assert.ok(candidates.includes('ghost'), 'the stale id is a candidate');
    const hits: string[] = [];
    for (const id of candidates) {
      if (id === 'player') continue;
      const other = colliders.get(id);
      if (other === undefined) continue; // The documented stale-id branch.
      hits.push(id);
    }
    assert.ok(!hits.includes('ghost'), 'the stale id is skipped, not asserted away');
  });

  it('finds a moved collider after the documented rebuild (FF6)', () => {
    const colliders = new Map<string, WorldCollider2D>();
    const moving = placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 10 }), { x: 60, y: 60 });
    const enemy = placeCollider2D(rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 20, height: 20 }), { x: 66, y: 60 });
    colliders.set('player', moving);
    colliders.set('enemy', enemy);
    const build = (): ReturnType<typeof buildSpatialHash2D> =>
      buildSpatialHash2D({
        items: [...colliders.entries()].map(([id, collider]) => ({ id, bounds: worldColliderBounds2D(collider) })),
        cellSize: 32,
      });

    let index = build();
    assert.ok(querySpatialHash2D(index, worldColliderBounds2D(moving)).includes('enemy'));
    // The enemy moves far away; rebuild as documented.
    colliders.set('enemy', placeCollider2D(rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 20, height: 20 }), { x: 260, y: 40 }));
    index = build();
    const candidates = querySpatialHash2D(index, worldColliderBounds2D(moving));
    assert.ok(!candidates.includes('enemy'), 'the rebuilt index reflects the new position');
  });

  it('reports the overlapping enemy but not the distant coin or itself', () => {
    const { hits } = broadPhaseExample();
    const ids = hits.map((entry) => entry.otherId);
    assert.ok(ids.includes('enemy'), 'the overlapping enemy is found');
    assert.ok(!ids.includes('coin'), 'the distant coin is not a hit');
    assert.ok(!ids.includes('player'), 'the moving object never collides with itself');
  });
});
