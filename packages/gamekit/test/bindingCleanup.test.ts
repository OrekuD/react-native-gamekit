/**
 * GS-REACT-02 — failed setup and cleanup leak no later resources.
 *
 * Setup is transactional: every acquired subscription has a release path
 * even when a subsequent step fails. Cleanup attempts all releases in
 * reverse order and preserves failures instead of stopping at the first
 * one. Listener counts return to baseline in every path.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bindAppLifecycle, type AppLifecycleSource } from '../src/react/bindAppLifecycle';
import { bindGameSession } from '../src/react/bindGameSession';
import { createCleanupList } from '../src/react/cleanupList';
import type { GameSessionStatus } from '../src/core/session/types';
import { defineGame, defineScene } from '../src/index';
import { createGameSessionWithDriver, ManualFrameDriver } from '../src/testing';

interface ListenerCounts {
  commit: number;
  status: number;
}

/** Minimal session stub with counted listeners and injectable failures. */
function stubSession(options: {
  readonly failStart?: unknown;
  readonly failPause?: unknown;
  readonly failPresent?: unknown;
  readonly counts: ListenerCounts;
}) {
  const counts = options.counts;
  return {
    status: 'running' as const,
    getRenderFrame: () => ({ revision: 0 }) as never,
    addCommitListener: (_listener: (frame: never) => void) => {
      counts.commit += 1;
      let removed = false;
      return {
        remove: () => {
          if (!removed) {
            removed = true;
            counts.commit -= 1;
          }
        },
      };
    },
    addStatusListener: (_listener: (status: never) => void) => {
      counts.status += 1;
      let removed = false;
      return {
        remove: () => {
          if (!removed) {
            removed = true;
            counts.status -= 1;
          }
        },
      };
    },
    start: () => {
      if (options.failStart !== undefined) {
        throw options.failStart;
      }
    },
    pause: () => {
      if (options.failPause !== undefined) {
        throw options.failPause;
      }
    },
  };
}

function fakeAppState(options: {
  readonly initial: string | null;
  readonly failRegister?: unknown;
}): AppLifecycleSource & { readonly listenerCount: () => number } {
  let registrations = 0;
  return {
    currentState: options.initial,
    listenerCount: () => registrations,
    addEventListener: (_event: 'change', _listener: (next: string) => void) => {
      if (options.failRegister !== undefined) {
        throw options.failRegister;
      }
      registrations += 1;
      return {
        remove: () => {
          registrations -= 1;
        },
      };
    },
  };
}

describe('GS-REACT-02 transactional binding setup and cleanup', () => {
  it('bindGameSession removes the commit listener when start() throws', () => {
    const counts: ListenerCounts = { commit: 0, status: 0 };
    const session = stubSession({ failStart: new Error('start exploded'), counts });
    assert.throws(() => bindGameSession(session as never, () => {}), /start exploded/);
    assert.equal(counts.commit, 0, 'the registered listener is released');
  });

  it('bindGameSession propagates an initial present failure with nothing acquired', () => {
    const counts: ListenerCounts = { commit: 0, status: 0 };
    const session = stubSession({ counts });
    assert.throws(
      () =>
        bindGameSession(session as never, () => {
          throw new Error('present exploded');
        }),
      /present exploded/,
    );
    assert.equal(counts.commit, 0, 'no listener was ever registered');
  });

  it('bindGameSession cleanup is idempotent and safe on a disposed session', () => {
    const counts: ListenerCounts = { commit: 0, status: 0 };
    const session = stubSession({ counts });
    const cleanup = bindGameSession(session as never, () => {});
    assert.equal(counts.commit, 1);
    cleanup();
    cleanup();
    assert.equal(counts.commit, 0, 'released exactly once');
  });

  it('bindAppLifecycle releases the status subscription when AppState registration throws', () => {
    const counts: ListenerCounts = { commit: 0, status: 0 };
    const session = stubSession({ counts });
    const source = fakeAppState({ initial: 'active', failRegister: new Error('appstate exploded') });
    assert.throws(
      () =>
        bindAppLifecycle(source, {
          getStatus: () => 'running',
          pause: () => session.pause(),
          resume: () => {},
          addStatusListener: (listener) => session.addStatusListener(listener) as never,
        }),
      /appstate exploded/,
    );
    assert.equal(counts.status, 0, 'the registered status subscription is released');
    assert.equal(source.listenerCount(), 0, 'no AppState registration leaked');
  });

  it('bindAppLifecycle releases the status subscription when the initial background pause throws', () => {
    const counts: ListenerCounts = { commit: 0, status: 0 };
    const session = stubSession({ failPause: new Error('pause exploded'), counts });
    const source = fakeAppState({ initial: 'background' });
    assert.throws(
      () =>
        bindAppLifecycle(source, {
          getStatus: () => 'running',
          pause: () => session.pause(),
          resume: () => {},
          addStatusListener: (listener) => session.addStatusListener(listener) as never,
        }),
      /pause exploded/,
    );
    assert.equal(counts.status, 0, 'the registered status subscription is released');
    assert.equal(source.listenerCount(), 0, 'the AppState registration never happened');
  });

  it('bindAppLifecycle cleanup attempts every release and preserves failures', () => {
    const counts: ListenerCounts = { commit: 0, status: 0 };
    const session = stubSession({ counts });
    const source = fakeAppState({ initial: 'active' });
    const cleanup = bindAppLifecycle(source, {
      getStatus: () => 'running',
      pause: () => session.pause(),
      resume: () => {},
      addStatusListener: (listener) => session.addStatusListener(listener) as never,
    });
    assert.equal(counts.status, 1);
    assert.equal(source.listenerCount(), 1);
    cleanup();
    cleanup();
    assert.equal(counts.status, 0, 'released exactly once');
    assert.equal(source.listenerCount(), 0);
  });

  it('cleanup lists run in reverse order, attempt everything, and compose failures', () => {
    const order: string[] = [];
    const releases = createCleanupList();
    releases.add(() => {
      order.push('first');
    });
    releases.add(() => {
      order.push('second');
      throw new Error('second exploded');
    });
    releases.add(() => {
      order.push('third');
      throw new Error('third exploded');
    });
    const thrown: unknown = (() => {
      try {
        releases.releaseAll();
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    assert.deepEqual(order, ['third', 'second', 'first'], 'reverse order, all attempted');
    assert.ok(thrown instanceof AggregateError, 'failures compose');
    assert.deepEqual(
      (thrown as AggregateError).errors.map((entry) => (entry as Error).message),
      ['third exploded', 'second exploded'],
    );
    // Releasing twice is a no-op: the list drains.
    releases.releaseAll();
  });

  it('a lone cleanup failure rethrows unwrapped', () => {
    const releases = createCleanupList();
    const failure = new Error('only failure');
    releases.add(() => {
      throw failure;
    });
    assert.throws(
      () => releases.releaseAll(),
      (error: unknown) => error === failure,
      'a single failure keeps its identity',
    );
  });
});

describe('binding failure ownership', () => {
  it('drains releases before callbacks can reenter cleanup', () => {
    const cleanups = createCleanupList();
    const calls: string[] = [];
    let reentered = false;
    cleanups.add(() => { calls.push('first'); });
    cleanups.add(() => {
      calls.push('last');
      if (!reentered) {
        reentered = true;
        cleanups.releaseAll();
      }
    });
    cleanups.releaseAll();
    assert.deepEqual(calls, ['last', 'first']);
  });

  for (const setupError of [undefined, null, 0, new Error('setup')]) {
    it(`preserves a ${String(setupError)} setup failure and each cleanup failure`, () => {
      const cleanups = createCleanupList();
      const nestedError = new AggregateError(['nested'], 'user cleanup');
      cleanups.add(() => { throw nestedError; });
      cleanups.add(() => { throw undefined; });
      assert.throws(() => cleanups.releaseAfterFailure(setupError), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [setupError, undefined, nestedError]);
        return true;
      });
      cleanups.releaseAll();
    });
  }

  it('rethrows the original setup value when cleanup succeeds', () => {
    const cleanups = createCleanupList();
    let caught = false;
    try {
      cleanups.releaseAfterFailure(undefined);
    } catch (error) {
      caught = true;
      assert.equal(error, undefined);
    }
    assert.equal(caught, true);
  });

  it('releases the listener and pauses a session whose start committed then threw', () => {
    const calls: string[] = [];
    const setupError = new Error('start observer');
    const removeError = new Error('remove');
    const pauseError = new Error('pause observer');
    let status: GameSessionStatus = 'idle';
    const session = {
      get status() { return status; },
      getRenderFrame: () => ({ revision: 0 }),
      addCommitListener: () => ({ remove: () => {
        calls.push('remove');
        throw removeError;
      } }),
      start: () => { status = 'running'; throw setupError; },
      pause: () => { calls.push('pause'); status = 'paused'; throw pauseError; },
    };
    assert.throws(() => bindGameSession(session as never, () => {}), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [setupError, removeError, pauseError]);
      return true;
    });
    assert.equal(status, 'paused');
    assert.deepEqual(calls, ['remove', 'pause']);
  });

  it('pauses even if removal fails and ignores late commits after cleanup', () => {
    let commit: ((frame: never) => void) | undefined;
    let pauses = 0;
    const frames: number[] = [];
    const removeError = new Error('remove');
    const session = {
      status: 'running',
      getRenderFrame: () => ({ revision: 0 }),
      addCommitListener: (listener: (frame: never) => void) => {
        commit = listener;
        return { remove: () => { throw removeError; } };
      },
      start: () => {},
      pause: () => { pauses += 1; },
    };
    const cleanup = bindGameSession(session as never, (frame) => { frames.push(frame.revision); });
    assert.throws(cleanup, (error: unknown) => error === removeError);
    commit?.({ revision: 1 } as never);
    cleanup();
    assert.equal(pauses, 1);
    assert.deepEqual(frames, [0]);
  });

  for (const failRemoval of [false, true]) {
    it(`disables late AppState and status callbacks before cleanup (throw=${failRemoval})`, () => {
      let change: (state: string) => void = () => {};
      let statusChanged: (status: GameSessionStatus) => void = () => {};
      let status: GameSessionStatus = 'running';
      let pauses = 0;
      let resumes = 0;
      const source: AppLifecycleSource = {
        currentState: 'background',
        addEventListener: (_event, listener) => {
          change = listener;
          return { remove: () => {
            change('active');
            if (failRemoval) throw new Error('remove');
          } };
        },
      };
      const cleanup = bindAppLifecycle(source, {
        getStatus: () => status,
        pause: () => { status = 'paused'; pauses += 1; },
        resume: () => { status = 'running'; resumes += 1; },
        addStatusListener: (listener) => {
          statusChanged = listener;
          return { remove: () => {} };
        },
      });
      if (failRemoval) assert.throws(cleanup, /remove/);
      else cleanup();
      change('active');
      change('background');
      status = 'running';
      statusChanged('running');
      cleanup();
      assert.equal(resumes, 0);
      assert.equal(pauses, 1);
    });
  }

  for (const viaStatus of [false, true]) {
    it(`retains ownership of a pause that commits before throwing (status event=${viaStatus})`, () => {
      let change: (state: string) => void = () => {};
      let statusChanged: (status: GameSessionStatus) => void = () => {};
      let status: GameSessionStatus = viaStatus ? 'paused' : 'running';
      let resumes = 0;
      const pauseError = new Error('pause observer');
      const cleanup = bindAppLifecycle({
        currentState: viaStatus ? 'background' : 'active',
        addEventListener: (_event, listener) => {
          change = listener;
          return { remove: () => {} };
        },
      }, {
        getStatus: () => status,
        pause: () => { status = 'paused'; throw pauseError; },
        resume: () => { status = 'running'; resumes += 1; },
        addStatusListener: (listener) => {
          statusChanged = listener;
          return { remove: () => {} };
        },
      });
      assert.throws(() => {
        if (viaStatus) {
          status = 'running';
          statusChanged('running');
        } else change('background');
      }, (error: unknown) => error === pauseError);
      change('active');
      assert.equal(resumes, 1);
      cleanup();
    });
  }

  it('preserves failed AppState setup and cleanup errors and disables escaped callbacks', () => {
    let statusChanged: (status: GameSessionStatus) => void = () => {};
    let status: GameSessionStatus = 'paused';
    let pauses = 0;
    const setupError = new Error('register');
    assert.throws(() => bindAppLifecycle({
      currentState: 'background',
      addEventListener: () => { throw setupError; },
    }, {
      getStatus: () => status,
      pause: () => { pauses += 1; },
      resume: () => {},
      addStatusListener: (listener) => {
        statusChanged = listener;
        return { remove: () => { throw undefined; } };
      },
    }), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [setupError, undefined]);
      return true;
    });
    status = 'running';
    statusChanged('running');
    assert.equal(pauses, 0);
  });
});

describe('binding cleanup with the session runtime', () => {
  function createSession() {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(defineGame({
      viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
      input: {},
      initialScene: 'play',
      scenes: {
        play: defineScene({
          actions: [],
          create: () => ({ count: 0 }),
          update: ({ state }) => ({ count: state.count + 1 }),
          snapshot: ({ state }) => state,
        }),
      },
    }), { frameDriver: driver });
    return { session, driver };
  }

  it('cancels scheduled simulation when a running status observer rejects binding setup', () => {
    const { session, driver } = createSession();
    const failure = new Error('status observer');
    const subscription = session.addStatusListener((status) => {
      if (status === 'running') throw failure;
    });
    assert.throws(() => bindGameSession(session, () => {}), (error: unknown) => error === failure);
    assert.equal(session.status, 'paused');
    assert.equal(driver.pendingCount, 0);
    subscription.remove();
    session.dispose();
  });

  it('leaves an already running borrowed session alone if initial presentation fails', () => {
    const { session, driver } = createSession();
    session.start();
    assert.throws(() => bindGameSession(session, () => { throw new Error('present'); }), /present/);
    assert.equal(session.status, 'running');
    assert.equal(driver.pendingCount, 1);
    session.dispose();
  });

  it('resumes a lifecycle pause after the session reports an observer failure', () => {
    const { session, driver } = createSession();
    session.start();
    let change: (state: string) => void = () => {};
    const cleanup = bindAppLifecycle({
      currentState: 'active',
      addEventListener: (_event, listener) => {
        change = listener;
        return { remove: () => {} };
      },
    }, {
      getStatus: () => session.status,
      pause: () => session.pause(),
      resume: () => session.start(),
      addStatusListener: (listener) => session.addStatusListener(listener),
    });
    const failure = new Error('paused observer');
    const subscription = session.addStatusListener((status) => {
      if (status === 'paused') throw failure;
    });
    assert.throws(() => change('background'), (error: unknown) => error === failure);
    assert.equal(session.status, 'paused');
    assert.equal(driver.pendingCount, 0);
    change('active');
    assert.equal(session.status, 'running');
    assert.equal(driver.pendingCount, 1);
    cleanup();
    subscription.remove();
    session.dispose();
  });
});
