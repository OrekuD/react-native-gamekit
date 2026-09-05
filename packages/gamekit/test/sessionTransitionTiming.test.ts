/**
 * GS-SESSION-01 — external transition timing contract.
 *
 * While running, a queued `setScene` commits at the next frame-driver
 * callback — even when no fixed step is due — without advancing simulation
 * tick or time, and the target scene's update first runs at the next due
 * fixed step. At 120 Hz display with a 60 Hz simulation the transition may
 * publish on a zero-step callback; it never runs a target update early and
 * never discards timing debt.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const FIXED_STEP_MS = 1000 / 60;

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

function transitionGame(log: string[], updates: { a: number; b: number }) {
  const makeScene = (name: 'a' | 'b') =>
    defineScene({
      actions: [],
      create: () => {
        log.push(`${name}:create`);
        return { count: 0 };
      },
      update: ({ state }: { state: { readonly count: number } }) => {
        updates[name] += 1;
        return { count: state.count + 1 };
      },
      snapshot: ({ state }: { state: { readonly count: number } }) => ({ count: state.count }),
      dispose: () => {
        log.push(`${name}:dispose`);
      },
    });
  return defineGame({
    viewport,
    input: {},
    scenes: { a: makeScene('a'), b: makeScene('b') },
    initialScene: 'a',
  });
}

function harness() {
  const log: string[] = [];
  const updates = { a: 0, b: 0 };
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(transitionGame(log, updates), {
    frameDriver: driver,
    fixedStepMs: FIXED_STEP_MS,
  });
  session.start();
  return { session, driver, log, updates };
}

describe('GS-SESSION-01 external transition timing', () => {
  it('a queued transition publishes on the next driver callback without advancing tick or updating the target', () => {
    const { session, driver, log, updates } = harness();
    driver.fireNext(0);
    driver.fireNext(8);
    assert.equal(session.getRenderFrame().tick, 0);

    session.setScene('b');
    assert.equal(session.scene, 'a', 'queued, not yet applied');

    // 8 ms of new debt: the accumulator (8 + 8 = 16) stays below the
    // 16.667 ms step, so no fixed step is due on this callback.
    driver.fireNext(16);
    assert.equal(session.scene, 'b', 'the transition publishes at the next callback');
    assert.deepEqual(log, ['a:create', 'b:create', 'a:dispose']);
    assert.equal(session.getRenderFrame().tick, 0, 'simulation tick does not advance');
    assert.equal(updates.b, 0, 'the target scene has not updated yet');
    const frame = session.getRenderFrame();
    assert.equal(frame.scene, 'b');
    assert.deepEqual(frame.current, { count: 0 }, 'the fresh target snapshot publishes');

    // 17 ms of new debt reaches the boundary: the target updates once.
    driver.fireNext(33);
    assert.equal(session.getRenderFrame().tick, 1, 'timing debt is preserved, not discarded');
    assert.equal(updates.b, 1, 'the target update runs at the next due fixed step');
    assert.deepEqual(session.getRenderFrame().current, { count: 1 });
    session.dispose();
  });

  it('pausing before the pending transition fires resolves it at the pause boundary', () => {
    const { session, driver, log, updates } = harness();
    driver.fireNext(0);
    driver.fireNext(8);
    session.setScene('b');

    session.pause();
    assert.equal(session.scene, 'b', 'pause resolves the pending transition');
    assert.equal(session.getRenderFrame().tick, 0, 'no tick advance at the pause boundary');
    assert.equal(updates.b, 0, 'no target update at the pause boundary');

    // A later start() must never commit a stale transition on an
    // unexpected frame.
    session.start();
    driver.fireNext(33);
    assert.deepEqual(
      log.filter((entry) => entry === 'b:create'),
      ['b:create'],
      'no second target creation after restart',
    );
    assert.equal(session.scene, 'b');
    assert.equal(session.getRenderFrame().tick, 0);
    assert.equal(updates.b, 0);

    driver.fireNext(50);
    assert.equal(session.getRenderFrame().tick, 1);
    assert.equal(updates.b, 1);
    session.dispose();
  });
});
