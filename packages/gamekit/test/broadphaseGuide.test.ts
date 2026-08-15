/**
 * T11-F8: the guide's broad-phase flow compiles and executes against the
 * shipped API: object-owned lookup, skip-self, explicit missing ids, and a
 * moved collider found after an index update.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { broadPhaseExample } from '../../../apps/playground/src/docs-examples/broadphase-guide.ts';

describe('broad-phase guide example', () => {
  it('reports the overlapping enemy but not the distant coin or itself', () => {
    const { hits } = broadPhaseExample();
    const ids = hits.map((entry) => entry.otherId);
    assert.ok(ids.includes('enemy'), 'the overlapping enemy is found');
    assert.ok(!ids.includes('coin'), 'the distant coin is not a hit');
    assert.ok(!ids.includes('player'), 'the moving object never collides with itself');
  });
});
