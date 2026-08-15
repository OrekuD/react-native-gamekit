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

function makeGame() {
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
        },
      }),
      menu: defineScene({
        actions: [],
        create: () => ({ ticks: 0 }),
        update: ({ state }) => state,
        snapshot: ({ state }) => state,
      }),
    },
    initialScene: 'play',
  });
  return { game, disposedCounts };
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

  it('surfaces both a listener failure and a scene-disposer failure', () => {
    const { game, disposedCounts } = makeGame();
    const { session } = createSession(game);

    session.addStatusListener(() => {
      throw new Error('listener boom');
    });

    let error: unknown;
    try {
      session.dispose();
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error, 'an error is surfaced');
    assert.equal((error as Error).message, 'listener boom');
    // The scene disposer still ran (its failure would be a second error; the
    // scene here does not throw, so exactly-once is the assertion).
    assert.deepEqual(disposedCounts, [1]);
    assert.equal(session.status, 'disposed');
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

  it('keeps the paused state coherent when the transition itself fails', () => {
    const { game } = makeGame();
    const { session } = createSession(game);
    session.start();

    session.setScene('menu');
    session.addStatusListener((status) => {
      if (status === 'paused') {
        throw new Error('paused listener boom');
      }
    });

    assert.throws(() => session.pause(), /paused listener boom/);
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'menu');
    session.dispose();
  });
});
