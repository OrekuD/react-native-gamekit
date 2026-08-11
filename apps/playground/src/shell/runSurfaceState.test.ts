import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GameSession } from 'react-native-gamekit';
import {
  EMPTY_RUN_SURFACE_STATE,
  reduceRunSurfaceState,
  settleRunSurfaceState,
  type RunSurfaceAttachment,
} from './runSurfaceState.ts';

function fakeSession(name: string): GameSession {
  return { name } as unknown as GameSession;
}

function attachment(session: GameSession): RunSurfaceAttachment {
  return {
    session,
    pointer: {},
    view: {},
  };
}

describe('run surface ownership', () => {
  it('publishes an attached session without retiring it', () => {
    const run = attachment(fakeSession('run-1'));
    const state = reduceRunSurfaceState(EMPTY_RUN_SURFACE_STATE, {
      kind: 'attach',
      attachment: run,
    });

    assert.equal(state.current, run);
    assert.deepEqual(state.retiring, []);
  });

  it('defers a detached session until after the replacement render commits', () => {
    const run = attachment(fakeSession('run-1'));
    const attached = reduceRunSurfaceState(EMPTY_RUN_SURFACE_STATE, {
      kind: 'attach',
      attachment: run,
    });
    const detached = reduceRunSurfaceState(attached, {
      kind: 'detach',
      session: run.session,
    });

    assert.equal(detached.current, undefined);
    assert.deepEqual(detached.retiring, [run.session]);

    const settled = settleRunSurfaceState(detached);
    assert.deepEqual(settled.disposable, [run.session]);
    assert.deepEqual(settled.state.retiring, []);
  });

  it('atomically replaces the session and its instrumentation', () => {
    const first = attachment(fakeSession('run-1'));
    const second = attachment(fakeSession('run-2'));
    const attached = reduceRunSurfaceState(EMPTY_RUN_SURFACE_STATE, {
      kind: 'attach',
      attachment: first,
    });
    const replaced = reduceRunSurfaceState(attached, {
      kind: 'attach',
      attachment: second,
    });

    assert.equal(replaced.current, second);
    assert.deepEqual(replaced.retiring, [first.session]);
  });

  it('does not let a stale detach clear a newer run', () => {
    const first = attachment(fakeSession('run-1'));
    const second = attachment(fakeSession('run-2'));
    const replaced = reduceRunSurfaceState(
      reduceRunSurfaceState(EMPTY_RUN_SURFACE_STATE, {
        kind: 'attach',
        attachment: second,
      }),
      { kind: 'detach', session: first.session },
    );

    assert.equal(replaced.current, second);
    assert.deepEqual(replaced.retiring, [first.session]);
  });

  it('deduplicates repeated detach cleanup', () => {
    const run = attachment(fakeSession('run-1'));
    const first = reduceRunSurfaceState(EMPTY_RUN_SURFACE_STATE, {
      kind: 'detach',
      session: run.session,
    });
    const second = reduceRunSurfaceState(first, {
      kind: 'detach',
      session: run.session,
    });

    assert.deepEqual(second.retiring, [run.session]);
  });
});
