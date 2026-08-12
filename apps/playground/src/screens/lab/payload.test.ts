import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';
import { brickBreakerDefinition } from '../brick-breaker/brickBreakerGame.ts';

/**
 * Offline representative-payload measurement.
 *
 * The hot path never serializes snapshots; payload size is estimated offline
 * so the commit channel budget can be reasoned about without adding cost to
 * the running session.
 */
describe('offline payload estimates (T1)', () => {
  it('measures the serialized brick breaker play frame', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(brickBreakerDefinition, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);
    // Enter play and let a few updates run so the frame is representative.
    driver.fireNext(10);
    if (session.scene === 'ready') {
      session.input.begin('primary', 1, { x: 160, y: 90 });
    }
    for (let index = 0; index < 30; index += 1) {
      driver.fireNext((index + 1) * 10);
    }
    const frame = session.getRenderFrame();
    const bytes = JSON.stringify(frame).length;
    const playFramesPerSecond = 60;
    const crossingBytesPerSecond = bytes * playFramesPerSecond;
    // Report for the handoff record.
    console.log(
      `offline payload: ${bytes} bytes/frame, ${crossingBytesPerSecond} bytes/s at 60 Hz commits`,
    );
    assert.ok(bytes > 100, 'the play frame carries bricks, ball, paddle, score');
    assert.ok(bytes < 50_000, 'the play frame stays well under channel budgets');
  });
});
