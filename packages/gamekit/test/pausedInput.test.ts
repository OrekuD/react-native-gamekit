/**
 * RED (T10.4): the paused-input boundary.
 *
 * Input received while paused must be rejected before it enters the
 * simulation queue (no accepted-input increments, no mutations, no replay
 * after resume). Pausing cancels active pointer ownership; a finger held
 * across the pause boundary cannot reacquire, and a fresh begin after
 * resume acquires normally.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineGame, defineScene } from '../src/index';
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
      create: () => ({ x: 0, shots: 0 }),
      update: ({ state, input }) => {
        const steer = input.pointer('steer');
        const fire = input.button('fire');
        return {
          x: steer.active && steer.position !== undefined ? steer.position.x : state.x,
          shots: state.shots + (fire.pressed ? 1 : 0),
        };
      },
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

function tick(
  session: ReturnType<typeof createSession>['session'],
  driver: ManualFrameDriver,
  atMs: number,
): void {
  session.start();
  driver.fireNext(atMs);
}

describe('paused-input boundary', () => {
  it('rejects button presses while paused and never replays them', () => {
    const { session, driver } = createSession();
    tick(session, driver, 0);
    const before = session.getRenderFrame().current.shots;

    session.pause();
    const acceptedBefore = session.input.acceptedCount;
    session.input.press('fire');
    session.input.release('fire');
    assert.equal(session.input.acceptedCount, acceptedBefore, 'rejected input is not counted');

    session.start();
    driver.fireNext(1_000);
    driver.fireNext(1_000 + FIXED_STEP_MS);
    assert.equal(
      session.getRenderFrame().current.shots,
      before,
      'no queued press survives into the resumed simulation',
    );
    session.dispose();
  });

  it('rejects pointer begin, move, and end while paused', () => {
    const { session, driver } = createSession();
    tick(session, driver, 0);

    session.pause();
    const acceptedBefore = session.input.acceptedCount;
    session.input.begin('steer', 1, { x: 100, y: 90 });
    session.input.move('steer', 1, { x: 200, y: 90 });
    session.input.end('steer', 1);
    assert.equal(session.input.acceptedCount, acceptedBefore, 'no paused pointer event is accepted');

    session.start();
    driver.fireNext(1_000);
    const frame = session.getRenderFrame().current;
    assert.equal(frame.x, 0, 'the paused pointer never reached a scene update');
    session.dispose();
  });

  it('cancels an active pointer when the pause begins', () => {
    const { session, driver } = createSession();
    tick(session, driver, 0);
    session.input.begin('steer', 1, { x: 100, y: 90 });
    driver.fireNext(FIXED_STEP_MS);
    assert.equal(session.getRenderFrame().current.x, 100, 'the pointer was live before the pause');

    session.pause();
    session.start();
    // A late move from the pre-pause finger must be dropped: ownership was
    // cancelled and moves without an owner never mutate.
    session.input.move('steer', 1, { x: 300, y: 90 });
    driver.fireNext(1_000);
    assert.equal(session.getRenderFrame().current.x, 100, 'the held finger cannot reacquire control');
    session.dispose();
  });

  it('requires a fresh begin after resume to acquire the pointer', () => {
    const { session, driver } = createSession();
    tick(session, driver, 0);
    session.input.begin('steer', 1, { x: 100, y: 90 });
    driver.fireNext(FIXED_STEP_MS);

    session.pause();
    session.start();
    driver.fireNext(1_000);
    assert.equal(session.getRenderFrame().current.x, 100, 'stale ownership stays cancelled');

    session.input.begin('steer', 2, { x: 240, y: 90 });
    driver.fireNext(1_000 + FIXED_STEP_MS);
    assert.equal(session.getRenderFrame().current.x, 240, 'a fresh post-resume begin acquires normally');
    session.dispose();
  });

  it('does not retain button edges across the pause boundary', () => {
    const { session, driver } = createSession();
    tick(session, driver, 0);
    session.input.press('fire');
    driver.fireNext(FIXED_STEP_MS);
    const shotsBeforePause = session.getRenderFrame().current.shots;

    session.pause();
    session.start();
    driver.fireNext(1_000);
    driver.fireNext(1_000 + FIXED_STEP_MS);
    assert.equal(
      session.getRenderFrame().current.shots,
      shotsBeforePause,
      'the held edge was consumed before the pause and not replayed',
    );
    session.dispose();
  });

  it('keeps normal running input fully intact', () => {
    const { session, driver } = createSession();
    tick(session, driver, 0);
    session.input.begin('steer', 1, { x: 80, y: 90 });
    driver.fireNext(FIXED_STEP_MS);
    session.input.move('steer', 1, { x: 160, y: 90 });
    driver.fireNext(2 * FIXED_STEP_MS);
    session.input.end('steer', 1);
    driver.fireNext(3 * FIXED_STEP_MS);

    assert.equal(session.getRenderFrame().current.x, 160, 'running input behaves as before');
    session.dispose();
  });
});
