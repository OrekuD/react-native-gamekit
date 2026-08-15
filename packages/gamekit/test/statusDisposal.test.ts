/**
 * RED (T10-F1, T10-F2): terminal disposal must be exception-safe, and
 * `pause()` must complete its pending-transition work before surfacing a
 * status-listener failure.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineGame, defineScene } from '../src/index';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';
import { statusCountDiagnostics } from './helpers/statusCountDiagnostics';

const FIXED_STEP_MS = 1000 / 60;

function makeGame(options: { readonly disposeThrows?: boolean; readonly menuCreateThrows?: boolean } = {}) {
  const disposedCounts: number[] = [];
  let disposed = 0;
  const game = defineGame({
    viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
    input: {},
    scenes: {
      play: defineScene({
        actions: [],
        create: () => ({ ticks: 0 }),
        update: ({ state }) => state,
        snapshot: ({ state }) => state,
        // Scene state is frozen; count externally.
        dispose: () => {
          disposed += 1;
          disposedCounts.push(disposed);
          if (options.disposeThrows === true) {
            throw new Error('scene dispose boom');
          }
        },
      }),
      menu: defineScene({
        actions: [],
        create: () => {
          if (options.menuCreateThrows === true) {
            throw new Error('transition boom');
          }
          return { ticks: 0 };
        },
        update: ({ state }) => state,
        snapshot: ({ state }) => state,
      }),
    },
    initialScene: 'play',
  });
  return { game, disposedCounts };
}

/** Collects whatever a command throws, including nonstandard values. */
function captureThrow(run: () => void): { readonly threw: boolean; readonly value: unknown } {
  try {
    run();
    return { threw: false, value: undefined };
  } catch (error) {
    return { threw: true, value: error };
  }
}

function createSession(
  game: ReturnType<typeof makeGame>['game'],
  diagnostics?: ReturnType<typeof statusCountDiagnostics>['diagnostics'],
) {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(game, {
    frameDriver: driver,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
  return { session, driver };
}

describe('disposal exception-safety (T10-F1)', () => {
  it('releases status listeners, commit listeners, and the scene even when a listener throws', () => {
    const { game, disposedCounts } = makeGame();
    const { diagnostics, counts } = statusCountDiagnostics();
    const { session } = createSession(game, diagnostics);

    let laterRan = false;
    let commits = 0;
    session.addStatusListener(() => {
      throw new Error('disposed listener boom');
    });
    session.addStatusListener(() => {
      laterRan = true;
    });
    session.addCommitListener(() => {
      commits += 1;
    });

    assert.throws(() => session.dispose(), /disposed listener boom/);
    assert.equal(laterRan, true, 'the whole listener snapshot still runs');
    assert.deepEqual(disposedCounts, [1], 'the scene disposer runs exactly once');
    assert.equal(counts.at(-1), 0, 'status listeners are released even on the failure path');

    // The commit listener set must also be released: after disposal the
    // session rejects new subscriptions, and the old one must not fire.
    assert.equal(commits, 0);
    assert.equal(session.status, 'disposed');
  });

  it('preserves both failures when the listener AND the scene disposer throw', () => {
    const { game, disposedCounts } = makeGame({ disposeThrows: true });
    const { session } = createSession(game);

    session.addStatusListener(() => {
      throw new Error('listener boom');
    });

    const thrown = captureThrow(() => session.dispose());
    assert.equal(thrown.threw, true);
    assert.ok(thrown.value instanceof AggregateError, 'both failures compose into an AggregateError');
    const aggregate = thrown.value as AggregateError;
    assert.deepEqual(
      aggregate.errors.map((error) => (error as Error).message),
      ['listener boom', 'scene dispose boom'],
      'ordered, lossless, and neither failure erased',
    );
    assert.deepEqual(disposedCounts, [1], 'the scene disposer ran exactly once before throwing');
    assert.equal(session.status, 'disposed');
  });

  it('surfaces a scene-disposer failure alone and still releases listeners', () => {
    const { game, disposedCounts } = makeGame({ disposeThrows: true });
    const { diagnostics, counts } = statusCountDiagnostics();
    const { session } = createSession(game, diagnostics);
    session.addStatusListener(() => {});

    const thrown = captureThrow(() => session.dispose());
    assert.equal(thrown.threw, true);
    assert.equal((thrown.value as Error).message, 'scene dispose boom');
    assert.deepEqual(disposedCounts, [1]);
    assert.equal(counts.at(-1), 0, 'listeners are released on the scene-failure path too');

    // Repeated disposal is a terminal no-op and never retries the scene.
    session.dispose();
    assert.deepEqual(disposedCounts, [1]);
  });

  it('never treats throw undefined as success and preserves arbitrary values', () => {
    // A listener that throws undefined must still be surfaced.
    {
      const { game } = makeGame();
      const { session } = createSession(game);
      session.addStatusListener(() => {
        throw undefined;
      });
      const thrown = captureThrow(() => session.dispose());
      assert.equal(thrown.threw, true, 'throw undefined is a real failure');
      assert.equal(thrown.value, undefined);
    }

    // A thrown string is rethrown as-is when it is the only failure.
    {
      const { game } = makeGame();
      const { session } = createSession(game);
      session.addStatusListener(() => {
        throw 'string-boom';
      });
      const thrown = captureThrow(() => session.dispose());
      assert.equal(thrown.value, 'string-boom');
    }

    // An Error that already carries a cause is not mutated or overwritten.
    {
      const { game } = makeGame();
      const { session } = createSession(game);
      const listenerError = new Error('boom', { cause: 'original-cause' });
      session.addStatusListener(() => {
        throw listenerError;
      });
      const thrown = captureThrow(() => session.dispose());
      assert.equal(thrown.value, listenerError, 'the same error instance is surfaced');
      assert.equal((thrown.value as Error).cause, 'original-cause', 'its cause is untouched');
    }
  });

  it('releases listeners for ordinary, re-entrant, and repeated disposal alike', () => {
    // Ordinary + repeated:
    const ordinary = makeGame();
    {
      const { diagnostics, counts } = statusCountDiagnostics();
      const { session } = createSession(ordinary.game, diagnostics);
      session.addStatusListener(() => {});
      session.dispose();
      session.dispose();
      assert.equal(counts.at(-1), 0, 'ordinary disposal releases listeners');
      assert.deepEqual(ordinary.disposedCounts, [1], 'scene disposed exactly once');
    }

    // Re-entrant (dispose from inside a status listener):
    const reentrant = makeGame();
    {
      const { diagnostics, counts } = statusCountDiagnostics();
      const { session } = createSession(reentrant.game, diagnostics);
      session.addStatusListener((status) => {
        if (status === 'paused') {
          session.dispose();
        }
      });
      session.start();
      session.pause();
      assert.deepEqual(reentrant.disposedCounts, [1], 're-entrant disposal disposes the scene once');
      assert.equal(counts.at(-1), 0, 're-entrant disposal releases listeners after the pass');
      assert.equal(session.status, 'disposed');
    }
  });
});

describe('pause command transaction (T10-F2)', () => {
  it('flushes a pending transition before surfacing a paused-listener failure', () => {
    const { game } = makeGame();
    const { session, driver } = createSession(game);
    session.start();
    driver.fireNext(0);

    // A pending external transition, then a listener that throws on paused.
    session.setScene('menu');
    session.addStatusListener((status) => {
      if (status === 'paused') {
        throw new Error('paused listener boom');
      }
    });

    assert.throws(() => session.pause(), /paused listener boom/);
    assert.equal(
      session.scene,
      'menu',
      'the pending transition is committed at the pause boundary before the error surfaces',
    );
    assert.equal(session.status, 'paused');

    // Resume must not commit any stale pending transition on a later frame.
    session.start();
    driver.fireNext(1_000);
    driver.fireNext(1_000 + FIXED_STEP_MS);
    assert.equal(session.scene, 'menu', 'no stale transition commits after resume');
    session.dispose();
  });

  it('preserves both failures when the pending transition and the paused listener throw', () => {
    const { game } = makeGame({ menuCreateThrows: true });
    const { session, driver } = createSession(game);
    session.start();
    driver.fireNext(0);

    session.setScene('menu'); // becomes pending; its create() throws at commit
    session.addStatusListener((status) => {
      if (status === 'paused') {
        throw 'paused-string-boom';
      }
    });

    const thrown = captureThrow(() => session.pause());
    assert.equal(thrown.threw, true);
    assert.ok(thrown.value instanceof AggregateError);
    assert.deepEqual(
      (thrown.value as AggregateError).errors,
      ['paused-string-boom', expectTransitionError()],
      'both the nonstandard listener value and the transition error survive',
    );

    // The pending intent is cleared; the original scene stays coherent and
    // resume cannot replay the transition.
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'play');
    session.start();
    driver.fireNext(1_000);
    driver.fireNext(1_000 + FIXED_STEP_MS);
    assert.equal(session.scene, 'play', 'no transition replay after resume');
    session.dispose();
  });

  /** The exact transition failure committed by the menu scene's create(). */
  function expectTransitionError(): Error {
    return new Error('transition boom');
  }
});
