/**
 * RED (T10.1): observable session status contract.
 *
 * Establishes the idle/running/paused/disposed transition table, listener
 * timing, ordering, removal, re-entrancy, failure, and disposal semantics
 * before the core status publisher exists. Every test drives the real
 * session through the deterministic frame driver.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineGame, defineScene, GameSessionDisposedError, type GameSessionStatus } from '../src/index';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

const FIXED_STEP_MS = 1000 / 60;

const game = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {
    steer: { type: 'pointer', description: 'Move the paddle' },
    fire: { type: 'button' },
  },
  scenes: {
    play: defineScene({
      actions: ['steer', 'fire'],
      create: () => ({ x: 0, ticks: 0 }),
      update: ({ state }) => ({ x: state.x, ticks: state.ticks + 1 }),
      snapshot: ({ state }) => state,
    }),
  },
  initialScene: 'play',
});

function createSession() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(game, { frameDriver: driver });
  return { session, driver };
}

type Events = Array<{ readonly status: GameSessionStatus; readonly observed: GameSessionStatus }>;

function record(session: ReturnType<typeof createSession>['session']): Events {
  const events: Events = [];
  session.addStatusListener((status) => {
    events.push({ status, observed: session.status });
  });
  return events;
}

describe('observable session status', () => {
  it('covers the full transition table with one event per actual transition', () => {
    const { session } = createSession();
    const events = record(session);

    assert.equal(session.status, 'idle');
    session.start();
    assert.equal(session.status, 'running');
    session.pause();
    assert.equal(session.status, 'paused');
    session.start();
    assert.equal(session.status, 'running');
    session.dispose();
    assert.equal(session.status, 'disposed');

    assert.deepEqual(
      events.map((entry) => entry.status),
      ['running', 'paused', 'running', 'disposed'],
    );
  });

  it('treats idempotent commands as silent', () => {
    const { session } = createSession();
    const events = record(session);

    session.start();
    session.start();
    session.pause();
    session.pause();
    session.start();
    session.dispose();
    session.dispose();

    assert.deepEqual(
      events.map((entry) => entry.status),
      ['running', 'paused', 'running', 'disposed'],
      'no-op commands emit nothing and dispose is terminal',
    );
  });

  it('makes the new status authoritative before any listener runs', () => {
    const { session } = createSession();
    const events = record(session);

    session.start();
    for (const entry of events) {
      assert.equal(entry.observed, entry.status, 'listeners observe the committed status');
    }
    assert.deepEqual(events.map((entry) => entry.observed), ['running']);
  });

  it('delivers in registration order and supports idempotent removal', () => {
    const { session } = createSession();
    const calls: string[] = [];
    const first = session.addStatusListener(() => calls.push('first'));
    session.addStatusListener(() => calls.push('second'));
    session.addStatusListener(() => calls.push('third'));

    session.start();
    assert.deepEqual(calls, ['first', 'second', 'third']);

    first.remove();
    first.remove();
    session.pause();
    assert.deepEqual(calls, ['first', 'second', 'third', 'second', 'third']);
  });

  it('delivers from a snapshot: mid-delivery additions wait, removals finish the pass', () => {
    const { session } = createSession();
    const calls: string[] = [];
    let lateAdded = false;
    let cRemoved = false;
    const cHolder: { subscription?: ReturnType<typeof session.addStatusListener> } = {};

    session.addStatusListener(() => {
      calls.push('a');
      // Adding during delivery: this listener must not run in this pass.
      if (!lateAdded) {
        lateAdded = true;
        session.addStatusListener(() => calls.push('late'));
      }
    });
    session.addStatusListener(() => {
      calls.push('b');
      // Removing during delivery: c is in the snapshot, so it still runs now.
      if (!cRemoved) {
        cRemoved = true;
        cHolder.subscription?.remove();
      }
    });
    cHolder.subscription = session.addStatusListener(() => calls.push('c'));

    session.start();
    assert.deepEqual(
      calls,
      ['a', 'b', 'c'],
      'the late listener waits for the next transition; the removed listener finishes this pass',
    );

    session.pause();
    assert.deepEqual(calls, ['a', 'b', 'c', 'a', 'b', 'late']);
  });

  it('queues re-entrant lifecycle commands and delivers complete states', () => {
    const { session } = createSession();
    const events: GameSessionStatus[] = [];
    session.addStatusListener((status) => {
      events.push(status);
      if (status === 'running') {
        // A listener that pauses observes the complete paused state after
        // the current delivery pass, never a half-applied transition.
        session.pause();
      }
    });

    session.start();
    assert.deepEqual(events, ['running', 'paused']);
    assert.equal(session.status, 'paused');

    session.dispose();
    assert.deepEqual(events, ['running', 'paused', 'disposed']);
  });

  it('finishes the delivery pass when a listener throws, then surfaces the error', () => {
    const { session } = createSession();
    const calls: string[] = [];
    const throwing = session.addStatusListener(() => {
      calls.push('throwing');
      throw new Error('listener boom');
    });
    session.addStatusListener(() => calls.push('after'));

    assert.throws(() => session.start(), /listener boom/);
    assert.deepEqual(calls, ['throwing', 'after'], 'the remaining snapshot listeners still run');
    assert.equal(session.status, 'running', 'the transition itself completed');

    // The throwing listener stays registered; every command surfaces the
    // first listener failure, so detach it before pausing.
    throwing.remove();
    session.pause();
    assert.equal(session.status, 'paused');
    assert.deepEqual(calls, ['throwing', 'after', 'after'], 'the surviving listener saw the pause');
    session.dispose();
  });

  it('emits disposed exactly once and releases status listeners', () => {
    const { session } = createSession();
    const events = record(session);

    session.start();
    session.dispose();
    session.dispose();
    assert.deepEqual(events.map((entry) => entry.status), ['running', 'disposed']);

    assert.throws(
      () => session.addStatusListener(() => {}),
      GameSessionDisposedError,
      'subscribing to a disposed session follows the disposed-resource policy',
    );
  });

  it('disposes exactly once even when disposal is requested from a listener', () => {
    const { session } = createSession();
    const events: GameSessionStatus[] = [];
    session.addStatusListener((status) => {
      events.push(status);
      if (status === 'paused') {
        session.dispose();
        session.dispose();
      }
    });

    session.start();
    session.pause();
    assert.deepEqual(events, ['running', 'paused', 'disposed'], 'dispose is terminal and emitted once');
    assert.equal(session.status, 'disposed');
  });

  it('never treats a lifecycle notification as a render commit', () => {
    const { session, driver } = createSession();
    let commits = 0;
    session.addCommitListener(() => {
      commits += 1;
    });

    session.start();
    driver.fireNext(0);
    driver.fireNext(FIXED_STEP_MS);
    const runningCommits = commits;
    assert.ok(runningCommits >= 1, 'frames flow while running');

    session.pause();
    session.start();
    session.pause();
    assert.equal(commits, runningCommits, 'lifecycle transitions publish no frames');
    session.dispose();
  });

  it('keeps commit listeners and status listeners independent', () => {
    const { session, driver } = createSession();
    const statusEvents: GameSessionStatus[] = [];
    session.addStatusListener((status) => statusEvents.push(status));
    const commitEvents: number[] = [];
    session.addCommitListener((frame) => commitEvents.push(frame.revision));

    session.start();
    driver.fireNext(0);
    driver.fireNext(FIXED_STEP_MS);
    const runningCommits = commitEvents.length;
    session.pause();
    assert.throws(() => driver.fireNext(2 * FIXED_STEP_MS), /No frame is pending/);

    assert.deepEqual(statusEvents, ['running', 'paused']);
    assert.ok(runningCommits >= 1, 'commits came only from the running phase');
    assert.equal(driver.pendingCount, 0, 'pause cancels the scheduler');
    session.dispose();
  });
});
