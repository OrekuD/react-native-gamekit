/**
 * GS-VIEWPORT-01 — ViewportBinding disposal contract.
 *
 * Disposal clears CURRENT subscribers; it is not a lifecycle gate. Late
 * subscriptions still register and setSurfaceSize still resolves — callers
 * must discard the binding instead of reusing it after disposal.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ViewportBinding } from '../src/react/viewportBinding.ts';

const config = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

describe('GS-VIEWPORT-01 binding disposal contract', () => {
  it('dispose clears current subscribers; later layout notifies nobody', () => {
    const binding = new ViewportBinding(config);
    binding.setSurfaceSize({ width: 640, height: 360 });
    let notifications = 0;
    const unsubscribe = binding.subscribe(() => {
      notifications += 1;
    });
    binding.setSurfaceSize({ width: 800, height: 450 });
    assert.equal(notifications, 1);
    binding.dispose();
    binding.setSurfaceSize({ width: 1024, height: 576 });
    assert.equal(notifications, 1, 'disposed subscribers stay silent');
    assert.equal(binding.resolved?.surfaceSize.width, 1024, 'resolution itself still runs');
    unsubscribe();
  });

  it('a late subscription after disposal still registers (no lifecycle gate)', () => {
    const binding = new ViewportBinding(config);
    binding.setSurfaceSize({ width: 640, height: 360 });
    binding.dispose();
    let notifications = 0;
    const unsubscribe = binding.subscribe(() => {
      notifications += 1;
    });
    binding.setSurfaceSize({ width: 800, height: 450 });
    assert.equal(
      notifications,
      1,
      'documented: disposal clears, it does not forbid reuse — discard instead',
    );
    unsubscribe();
  });
});
