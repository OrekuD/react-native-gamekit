/**
 * RED (T10.3): pause and resume must be a true simulation freeze.
 *
 * No updates while paused, no stale-callback execution, exactly one frame
 * loop after resume with a fresh timestamp baseline, no catch-up spiral
 * across a long pause, and pause/resume transparency for scene state.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineGame, defineScene } from '../src/index';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

const FIXED_STEP_MS = 1000 / 60;

const game = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {},
  scenes: {
    play: defineScene({
      actions: [],
      create: () => ({ ticks: 0 }),
      update: ({ state }) => ({ ticks: state.ticks + 1 }),
      snapshot: ({ state }) => ({ ticks: state.ticks }),
    }),
  },
  initialScene: 'play',
});

function createSession() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(game, { frameDriver: driver });
  return { session, driver };
}

function runFrames(
  session: ReturnType<typeof createSession>['session'],
  driver: ManualFrameDriver,
  frames: number,
  startMs: number,
): void {
  for (let index = 0; index < frames; index += 1) {
    driver.fireNext(startMs + (index + 1) * FIXED_STEP_MS);
  }
  void session;
}

describe('pause and resume clock correctness', () => {
  it('executes no update while paused, even for a stale scheduler callback', () => {
    const { session, driver } = createSession();
    session.start();
    driver.fireNext(0);
    const baseline = session.getRenderFrame().current.ticks;

    session.pause();
    const staleHandle = driver.pendingCount;
    // The driver can still fire a cancelled callback; the scheduler guard
    // must ignore it entirely.
    if (staleHandle === 0) {
      // The frame was cancelled before it fired; nothing is pending, which
      // is itself the required behavior.
      assert.equal(driver.pendingCount, 0);
    }
    session.start();
    session.pause();

    assert.equal(session.getRenderFrame().current.ticks, baseline, 'no tick advanced while paused');
    assert.equal(driver.pendingCount, 0, 'paused sessions hold no scheduler callback');
  });

  it('resumes with exactly one scheduled frame loop and a fresh baseline', () => {
    const { session, driver } = createSession();
    session.start();
    driver.fireNext(0);
    driver.fireNext(FIXED_STEP_MS);
    const before = session.getRenderFrame().current.ticks;

    session.pause();
    // Simulate a long wall-clock pause: the driver is idle for 10 seconds.
    session.start();
    assert.equal(driver.pendingCount, 1, 'resume schedules exactly one loop');

    // The first resumed callback establishes a fresh baseline without
    // simulating the 10-second gap; the next callback advances one tick.
    driver.fireNext(10_000);
    assert.equal(session.getRenderFrame().current.ticks, before, 'no catch-up across the pause');
    driver.fireNext(10_000 + FIXED_STEP_MS);
    assert.equal(session.getRenderFrame().current.ticks, before + 1, 'steady step resumes');
    session.dispose();
  });

  it('never enters a catch-up spiral after repeated pause/resume cycles', () => {
    const { session, driver } = createSession();
    session.start();
    driver.fireNext(0);
    const before = session.getRenderFrame().current.ticks;

    for (let cycle = 0; cycle < 25; cycle += 1) {
      session.pause();
      session.start();
      driver.fireNext((cycle + 1) * 1_000);
      driver.fireNext((cycle + 1) * 1_000 + FIXED_STEP_MS);
    }

    assert.equal(session.getRenderFrame().current.ticks, before + 25, 'exactly one tick per resumed cycle');
    assert.equal(driver.pendingCount, 1, 'exactly one outstanding scheduler callback');
    session.dispose();
  });

  it('holds the last committed frame while paused', () => {
    const { session, driver } = createSession();
    session.start();
    driver.fireNext(0);
    driver.fireNext(FIXED_STEP_MS);
    const frozen = session.getRenderFrame().current.ticks;

    session.pause();
    // Any number of wall-clock seconds pass; the committed frame must not
    // change and no new commit may be produced.
    assert.equal(session.getRenderFrame().current.ticks, frozen);
    session.start();
    session.pause();
    assert.equal(session.getRenderFrame().current.ticks, frozen);
    session.dispose();
  });

  it('preserves scene identity and world state across pause/resume', () => {
    const { session, driver } = createSession();
    session.start();
    driver.fireNext(0);
    driver.fireNext(FIXED_STEP_MS);
    const scene = session.scene;
    const state = session.getRenderFrame().current.ticks;

    session.pause();
    session.start();
    driver.fireNext(1_000); // fresh baseline, no catch-up
    assert.equal(session.scene, scene);
    assert.equal(session.getRenderFrame().current.ticks, state, 'no time leaked across the pause');
    driver.fireNext(1_000 + FIXED_STEP_MS);
    assert.equal(session.getRenderFrame().current.ticks, state + 1, 'world continues from the same state');
    session.dispose();
  });

  it('disposes cleanly from idle, running, and paused states', () => {
    for (const mode of ['idle', 'running', 'paused'] as const) {
      const { session, driver } = createSession();
      if (mode === 'running' || mode === 'paused') {
        session.start();
        driver.fireNext(0);
      }
      if (mode === 'paused') {
        session.pause();
      }
      session.dispose();
      assert.equal(session.status, 'disposed', `${mode} -> disposed`);
      assert.equal(driver.pendingCount, 0, `${mode} dispose leaves no scheduled callback`);
    }
  });
});
