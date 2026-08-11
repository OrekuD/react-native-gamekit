import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { batchUpdatePolicy } from '../src/react/sprites/spriteBatchPolicy.ts';

describe('SpriteBatch update policy (RF8)', () => {
  it('accepts counts within capacity', () => {
    assert.deepEqual(batchUpdatePolicy(0, 4, true), { overflow: false, activeCount: 0 });
    assert.deepEqual(batchUpdatePolicy(1, 4, true), { overflow: false, activeCount: 1 });
    assert.deepEqual(batchUpdatePolicy(4, 4, true), { overflow: false, activeCount: 4 });
  });

  it('reports overflow in development with the selected count and capacity', () => {
    assert.throws(() => batchUpdatePolicy(5, 4, true), /overflow: 5 items selected with capacity 4/);
  });

  it('clamps silently in production', () => {
    assert.deepEqual(batchUpdatePolicy(1000, 64, false), { overflow: true, activeCount: 64 });
  });

  it('rejects invalid capacity at mount time', () => {
    // The component validates capacity; the policy treats zero as an invalid
    // configuration that must never render active slots.
    assert.deepEqual(batchUpdatePolicy(0, 0, false), { overflow: false, activeCount: 0 });
  });
});
