import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineGame, defineScene } from '../src/index';
import { createGameSessionWithDriver } from '../src/testing';
import type { CommitFrame } from '../src/core/session/types';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

interface CounterSnapshot {
  readonly count: number;
}

const createCounterGame = () => {
  return defineGame({
    viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
    input: {},
    scenes: {
      play: defineScene({
        actions: [],
        create: (): { readonly count: number } => ({ count: 0 }),
        update: ({ state }) => ({ count: state.count + 1 }),
        snapshot: ({ state }): CounterSnapshot => ({ count: state.count }),
      }),
    },
    initialScene: 'play',
  });
};

describe('T5: simulation-frequency commit notifications', () => {
  it('at 120 Hz display with 60 Hz steps, notifies at most once per simulation step', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 1000 / 60,
    });
    const notifications: CommitFrame<never>[] = [];
    session.addCommitListener((frame) => notifications.push(frame as never));
    session.start();

    driver.fireNext(0); // initial envelope (baseline callback)
    assert.equal(notifications.length, 1, 'the initial envelope is the first commit');

    // One second of 120 Hz display callbacks -> 60 fixed steps.
    for (let index = 1; index <= 120; index += 1) {
      driver.fireNext((index * 1000) / 120);
    }
    assert.equal(notifications.length, 61, '1 initial + exactly 60 simulation commits');
  });

  it('a zero-step callback produces zero commit notifications', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const notifications: CommitFrame<never>[] = [];
    session.addCommitListener((frame) => notifications.push(frame as never));
    session.start();
    driver.fireNext(0);
    assert.equal(notifications.length, 1);
    const before = session.getRenderFrame();

    driver.fireNext(5); // 5 ms accumulated, no step
    assert.equal(notifications.length, 1, 'zero-step callbacks must not notify');
    assert.equal(session.getRenderFrame().tick, before.tick);
    assert.equal(session.getRenderFrame().current, before.current);
  });

  it('two catch-up steps in one callback notify once with the final adjacent pair', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
      maxCatchUpSteps: 5,
    });
    const notifications: CommitFrame<never>[] = [];
    session.addCommitListener((frame) => notifications.push(frame as never));
    session.start();
    driver.fireNext(0);
    assert.equal(notifications.length, 1);

    driver.fireNext(25); // 25 ms -> two fixed steps in one callback
    assert.equal(notifications.length, 2, 'one notification for the whole callback');
    const frame = notifications[1] as unknown as {
      previous: CounterSnapshot;
      current: CounterSnapshot;
    };
    assert.deepEqual(frame.previous, { count: 1 }, 'the adjacent pair starts at the first step');
    assert.deepEqual(frame.current, { count: 2 }, 'the adjacent pair ends at the final step');
  });

  it('commit revisions are monotonic across transitions and external calls', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const revisions: number[] = [];
    session.addCommitListener((frame) => revisions.push(frame.revision));
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    session.pause();
    session.start();
    driver.fireNext(20);
    session.restartScene();
    driver.fireNext(30);

    for (let index = 1; index < revisions.length; index += 1) {
      assert.ok(revisions[index]! > revisions[index - 1]!, 'revision must be strictly increasing');
    }
  });

  it('a throwing commit listener pauses the session and leaves no scheduled successor', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), { frameDriver: driver });
    session.addCommitListener(() => {
      throw new Error('presentation failed');
    });
    session.start();

    assert.throws(() => driver.fireNext(0), /presentation failed/);
    assert.equal(session.status, 'paused');
    assert.equal(driver.pendingCount, 0);
  });
});
