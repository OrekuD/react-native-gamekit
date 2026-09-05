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
