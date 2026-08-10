import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canBeginPrimaryPointer,
  cancelOnActiveFinalize,
  deactivateAfterUp,
} from '../src/react/gestureLifecycle';

describe('manual gesture terminal lifecycle (F3)', () => {
  it('allows ownership only on the first touch of a native gesture', () => {
    assert.equal(canBeginPrimaryPointer(1), true);
    assert.equal(canBeginPrimaryPointer(2), false, 'a secondary touch cannot steal ownership');
  });

  it('deactivates after the last native touch lifts', () => {
    assert.equal(deactivateAfterUp(0), true, 'no touches remain: terminal');
    assert.equal(deactivateAfterUp(1), false, 'one touch remains: keep recognizing');
  });

  it('cancels only unexpected finalization while a pointer is active', () => {
    assert.equal(cancelOnActiveFinalize(7), true, 'active pointer must be neutralized');
    assert.equal(cancelOnActiveFinalize(undefined), false, 'normal up already released ownership');
  });
});
