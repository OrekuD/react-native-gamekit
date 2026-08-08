import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { advanceAlpha, type AlphaClockCommit, type AlphaClockState } from '../src/react/alphaClock';

const commit = (epoch: number, revision: number, stepMs = 16.6667): AlphaClockCommit => ({
  epoch,
  revision,
  stepMs,
});

describe('T5: UI-owned alpha clock (pure logic)', () => {
  it('resets to zero on a newer commit and advances from frame deltas', () => {
    let state: AlphaClockState = { epoch: 1, revision: 1, alpha: 0 };
    state = advanceAlpha(state, commit(1, 1), 8.33);
    assert.equal(state.alpha, 8.33 / 16.6667);
    state = advanceAlpha(state, commit(1, 2), 8.33);
    assert.equal(state.alpha, 0, 'a new revision resets the clock');
    state = advanceAlpha(state, commit(1, 2), 8.33);
    assert.ok(state.alpha > 0, 'the clock advances again after the reset');
  });

  it('clamps at 1 and holds without extrapolating', () => {
    let state: AlphaClockState = { epoch: 1, revision: 1, alpha: 0.95 };
    state = advanceAlpha(state, commit(1, 1), 16.67);
    assert.equal(state.alpha, 1);
    const held = advanceAlpha(state, commit(1, 1), 1000);
    assert.equal(held.alpha, 1, 'later frames must not advance past the snapshot');
    assert.equal(held.revision, 1);
  });

  it('ignores stale and duplicate commits without resetting alpha', () => {
    const current: AlphaClockState = { epoch: 1, revision: 5, alpha: 0.6 };
    const stale = advanceAlpha(current, commit(1, 4), 8);
    assert.equal(stale.alpha, 0.6, 'an older revision must not reset presentation');
    assert.equal(stale.revision, 5, 'the clock state stays on the newer revision');
    const duplicate = advanceAlpha(current, commit(1, 5), 4);
    assert.equal(duplicate.alpha, 0.6 + 4 / 16.6667, 'a duplicate revision just advances');
  });

  it('accepts a new epoch even when its revision restarts at zero', () => {
    const current: AlphaClockState = { epoch: 1, revision: 12, alpha: 0.8 };
    const replaced = advanceAlpha(current, commit(2, 0), 8);
    assert.equal(replaced.alpha, 0, 'the new epoch resets the clock');
    assert.equal(replaced.epoch, 2);
    assert.equal(replaced.revision, 0);
  });

  it('ignores a delayed write from an old epoch', () => {
    const current: AlphaClockState = { epoch: 2, revision: 0, alpha: 0.4 };
    const delayed = advanceAlpha(current, commit(1, 5), 8);
    assert.equal(delayed.alpha, 0.4, 'an old-epoch write must not reset or advance');
    assert.deepEqual(delayed, current);
  });

  it('holds while paused (no frames) and resumes from the held value', () => {
    const current: AlphaClockState = { epoch: 1, revision: 3, alpha: 0.5 };
    // Paused: no frame callbacks arrive, so the state is untouched.
    const afterPause = advanceAlpha(current, commit(1, 3), 0);
    assert.equal(afterPause.alpha, 0.5);
    const resumed = advanceAlpha(afterPause, commit(1, 3), 8);
    assert.equal(resumed.alpha, 0.5 + 8 / 16.6667, 'resume continues from the held value');
  });

  it('treats a hard-cut commit like any other new commit (resets to zero)', () => {
    const current: AlphaClockState = { epoch: 1, revision: 7, alpha: 0.9 };
    const cut = advanceAlpha(current, commit(1, 8), 0);
    assert.equal(cut.alpha, 0, 'the hard cut renders the new snapshots immediately');
    assert.equal(cut.revision, 8);
  });
});
