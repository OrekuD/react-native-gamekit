import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineGame, defineScene } from '../src/index';
import type { CommitFrame } from '../src/core/session/types';
import { bindGameSession } from '../src/react/bindGameSession';
import { createGameSessionWithDriver, ManualFrameDriver } from '../src/testing';

function counterScene(dispose = () => {}) {
  return defineScene({
    actions: ['jump'],
    create: () => ({ count: 0, held: false }),
    update: ({ state, input }) => ({
      count: state.count + 1,
      held: input.button('jump').held,
    }),
    snapshot: ({ state }) => state,
    dispose,
  });
}

function counterGame(dispose = () => {}) {
  return defineGame({
    viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
    input: { jump: { type: 'button' } },
    scenes: { a: counterScene(dispose), b: counterScene() },
    initialScene: 'a',
  });
}

describe('session review: transition publication through the presentation binding', () => {
  for (const operation of ['setScene', 'restartScene'] as const) {
    for (const elapsed of [10, 25]) {
      it(`${operation} publishes all due updates at ${elapsed} ms`, () => {
        const driver = new ManualFrameDriver();
        const game = counterGame();
        const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
        const frames: CommitFrame<typeof game.scenes>[] = [];
        const unbind = bindGameSession(session, (frame) => frames.push(frame));
        driver.fireNext(0);
        if (operation === 'setScene') session.setScene('b');
        else session.restartScene();
        const before = frames.length;
        driver.fireNext(elapsed);

        const delivered = frames.slice(before);
        assert.equal(delivered.length, 1, 'one cut containing the latest completed state');
        const latest = delivered[0]!;
        assert.equal(latest.scene, operation === 'setScene' ? 'b' : 'a');
        assert.equal(latest.tick, Math.floor(elapsed / 10));
        assert.equal(latest.current.count, latest.tick);
        assert.equal(latest.previous, latest.current);
        assert.equal(latest.hardCut, true);
        assert.equal(session.getRenderFrame().current, latest.current);
        driver.fireNext(elapsed + 1);
        assert.equal(frames.length, before + 1, 'a zero-step successor needs no publication');
        driver.fireNext(elapsed + 10);
        assert.equal(session.getRenderFrame().hardCut, false);
        assert.equal(session.getRenderFrame().previous.count, latest.current.count);
        unbind();
        session.dispose();
      });
    }
  }

  it('a cut listener can pause after the completed callback without scheduling another frame', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(counterGame(), { frameDriver: driver, fixedStepMs: 10 });
    const unbind = bindGameSession(session, (frame) => {
      if (frame.hardCut) session.pause();
    });
    driver.fireNext(0);
    session.setScene('b');
    driver.fireNext(10);
    assert.equal(session.status, 'paused');
    assert.equal(session.getRenderFrame().current.count, 1);
    assert.equal(driver.pendingCount, 0);
    unbind();
    session.dispose();
  });

  it('publishes the prepared target even if its first update fails', () => {
    const driver = new ManualFrameDriver();
    const error = new Error('target update failed');
    const game = counterGame();
    const session = createGameSessionWithDriver({
      ...game,
      scenes: {
        ...game.scenes,
        b: { ...game.scenes.b, update: () => { throw error; } },
      },
    }, { frameDriver: driver, fixedStepMs: 10 });
    const scenes: string[] = [];
    const unbind = bindGameSession(session, (frame) => { scenes.push(frame.scene); });
    driver.fireNext(0);
    session.setScene('b');
    assert.throws(() => driver.fireNext(10), (thrown) => thrown === error);
    assert.equal(session.status, 'paused');
    assert.equal(session.scene, 'b');
    assert.equal(session.getRenderFrame().scene, 'b');
    assert.equal(session.getRenderFrame().hardCut, true);
    assert.equal(session.getRenderFrame().current.count, 0);
    assert.equal(session.getRenderFrame().tick, 0);
    assert.equal(scenes.at(-1), 'b');
    unbind();
    session.dispose();
  });
});

describe('session review: cancellation failure', () => {
  function harness(dispose = () => {}) {
    const driver = new ManualFrameDriver();
    const cancelError = new Error('cancel failed');
    const session = createGameSessionWithDriver(counterGame(dispose), {
      fixedStepMs: 10,
      frameDriver: {
        requestFrame: (callback) => driver.requestFrame(callback),
        cancelFrame: () => { throw cancelError; },
      },
    });
    return { session, driver, cancelError };
  }

  it('pause finishes, clears held input, and permits recovery despite cancellation failure', () => {
    const { session, driver, cancelError } = harness();
    const statuses: string[] = [];
    session.addStatusListener((status) => statuses.push(status));
    session.start();
    driver.fireNext(0);
    session.input.press('jump');
    assert.throws(() => session.pause(), (error) => error === cancelError);
    assert.equal(session.status, 'paused');
    assert.deepEqual(statuses, ['running', 'paused']);
    driver.fireNext(10); // The host retained the callback: it must be harmless.
    assert.equal(session.getRenderFrame().tick, 0);
    assert.equal(driver.pendingCount, 0);
    session.start();
    driver.fireNext(1000);
    driver.fireNext(1010);
    assert.deepEqual(session.getRenderFrame().current, { count: 1, held: false });
    assert.throws(() => session.dispose(), (error) => error === cancelError);
    assert.equal(session.status, 'disposed');
    driver.fireNext(1020);
    assert.equal(driver.pendingCount, 0);
  });

  it('dispose invalidates callbacks and releases scene ownership even when cancellation throws', () => {
    let disposals = 0;
    const { session, driver, cancelError } = harness(() => { disposals += 1; });
    const statuses: string[] = [];
    session.addStatusListener((status) => statuses.push(status));
    session.start();
    driver.fireNext(0);
    assert.throws(() => session.dispose(), (error) => error === cancelError);
    assert.equal(session.status, 'disposed');
    assert.equal(disposals, 1);
    assert.deepEqual(statuses, ['running', 'disposed']);
    driver.fireNext(10);
    assert.equal(driver.pendingCount, 0);
    assert.equal(session.getRenderFrame().tick, 0);
    session.dispose();
    assert.equal(disposals, 1);
  });

  it('preserves cancellation, notification, and scene cleanup failures in order', () => {
    const cleanupError = new Error('cleanup failed');
    const statusError = new Error('observer failed');
    const { session, driver, cancelError } = harness(() => { throw cleanupError; });
    session.start();
    session.addStatusListener(() => { throw statusError; });
    assert.throws(() => session.dispose(), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [cancelError, statusError, cleanupError]);
      return true;
    });
    assert.equal(session.status, 'disposed');
    driver.fireNext(10);
    assert.equal(driver.pendingCount, 0);
    session.dispose();
  });
});

describe('session review: commit listener snapshots', () => {
  it('changes membership only for later passes and preserves duplicate registration behavior', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(counterGame(), { frameDriver: driver, fixedStepMs: 10 });
    const calls: string[] = [];
    const third = () => { calls.push('c'); };
    session.addCommitListener(() => {
      calls.push('a');
      second.remove();
      session.addCommitListener(third);
    });
    const second = session.addCommitListener(() => { calls.push('b'); });
    session.start();
    driver.fireNext(0);
    assert.deepEqual(calls, ['a', 'b']);
    driver.fireNext(10);
    assert.deepEqual(calls, ['a', 'b', 'a', 'c']);
    driver.fireNext(20);
    assert.deepEqual(calls, ['a', 'b', 'a', 'c', 'a', 'c']);
    session.dispose();
  });

  it('duplicate handles remove once and an old removed handle cannot remove a new registration', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(counterGame(), { frameDriver: driver, fixedStepMs: 10 });
    const calls: string[] = [];
    const listener = () => { calls.push('a'); };
    const first = session.addCommitListener(listener);
    const duplicate = session.addCommitListener(listener);
    session.addCommitListener(() => { calls.push('b'); });
    session.start();
    driver.fireNext(0);
    assert.deepEqual(calls, ['a', 'b']);
    duplicate.remove();
    first.remove();
    session.addCommitListener(listener);
    duplicate.remove();
    first.remove();
    driver.fireNext(10);
    assert.deepEqual(calls, ['a', 'b', 'b', 'a']);
    session.dispose();
  });

  it('disposal during delivery finishes the captured pass and prevents future callbacks', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(counterGame(), { frameDriver: driver });
    const calls: string[] = [];
    session.addCommitListener(() => {
      calls.push('a');
      session.dispose();
    });
    session.addCommitListener(() => { calls.push('b'); });
    session.start();
    driver.fireNext(0);
    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(session.status, 'disposed');
    assert.equal(driver.pendingCount, 0);
  });
});

describe('session review: scene dictionary ownership', () => {
  it('rejects inherited names as unknown initial scenes', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      const game = { ...counterGame(), initialScene: name };
      assert.throws(
        () => createGameSessionWithDriver(game as ReturnType<typeof counterGame>, {
          frameDriver: new ManualFrameDriver(),
        }),
        new RegExp(`Unknown initial scene: ${name}`),
      );
    }
  });

  it('supports explicitly declared prototype-like scene names', () => {
    const game = defineGame({
      viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
      input: { jump: { type: 'button' } },
      scenes: { ['__proto__']: counterScene(), constructor: counterScene() },
      initialScene: '__proto__',
    });
    const session = createGameSessionWithDriver(game, { frameDriver: new ManualFrameDriver() });
    session.setScene('constructor');
    assert.equal(session.getRenderFrame().scene, 'constructor');
    session.setScene('__proto__');
    assert.equal(session.getRenderFrame().scene, '__proto__');
    session.dispose();
  });
});
