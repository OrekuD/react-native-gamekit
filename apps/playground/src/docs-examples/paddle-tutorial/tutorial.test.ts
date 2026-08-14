import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';
import { paddleGame } from './game.ts';

const STEP_MS = 1000 / 60;
const STEP_S = STEP_MS / 1000;

/**
 * Drive the docs-example session exactly like the other playground tests,
 * with one monotonic timeline per test so timestamps never go backward.
 */
function createHarness() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(paddleGame, { frameDriver: driver });
  let timelineMs = 0;
  const tick = (frames: number): void => {
    for (let index = 0; index < frames; index += 1) {
      timelineMs += STEP_MS;
      driver.fireNext(timelineMs);
    }
  };
  const start = (): void => {
    session.start();
    timelineMs = 0;
    driver.fireNext(0);
  };
  return { session, driver, tick, start };
}

describe('docs example: paddle tutorial game', () => {
  it('moves the ball on the fixed step', () => {
    const { session, start, tick } = createHarness();
    start();
    tick(5);

    const frame = session.getRenderFrame();
    assert.equal(frame.scene, 'play');
    // 5 ticks at 90/70 units per second from the center.
    assert.ok(frame.current.ball.x > 160, `ball moved right, got ${frame.current.ball.x}`);
    assert.ok(frame.current.ball.y > 90, `ball moved down, got ${frame.current.ball.y}`);
  });

  it('steers the paddle through the declared pointer action', () => {
    const { session, start, tick } = createHarness();
    session.input.begin('steer', 1, { x: 280, y: 100 });
    start();
    tick(1);
    assert.equal(session.getRenderFrame().current.paddle.x, 280);

    session.input.move('steer', 1, { x: 100, y: 90 });
    tick(1);
    assert.equal(session.getRenderFrame().current.paddle.x, 100);

    session.input.end('steer', 1);
    tick(1);
    assert.equal(session.getRenderFrame().current.paddle.x, 100);
  });

  it('clamps the paddle inside the world', () => {
    const { session, start, tick } = createHarness();
    session.input.begin('steer', 1, { x: 1000, y: 90 });
    start();
    tick(1);
    // 320 - 48/2 = 296
    assert.equal(session.getRenderFrame().current.paddle.x, 296);
  });

  it('keeps the ball inside the world', () => {
    const { session, start, tick } = createHarness();
    session.input.begin('steer', 1, { x: 296, y: 90 });
    start();
    tick(400);

    const frame = session.getRenderFrame();
    assert.ok(frame.current.ball.x >= 0 && frame.current.ball.x <= 321, `x ${frame.current.ball.x}`);
    assert.ok(frame.current.ball.y >= 0 && frame.current.ball.y <= 181, `y ${frame.current.ball.y}`);
  });

  it('resets the ball to the middle after a miss', () => {
    const { session, start, tick } = createHarness();
    // Park the paddle far right so the ball misses it on the first pass.
    session.input.begin('steer', 1, { x: 296, y: 90 });
    start();
    // Ball starts at y=90 falling at 70/s; it misses the paddle and crosses
    // y>186 at t=96/70 s, which is tick 83 at 60 Hz. That tick returns the
    // ball to the center, so the frame right after it is exactly 160, 90.
    tick(83);

    const frame = session.getRenderFrame();
    assert.equal(frame.current.ball.x, 160);
    assert.equal(frame.current.ball.y, 90);
  });

  it('uses a constant fixed step for movement', () => {
    const { session, start, tick } = createHarness();
    start();
    tick(1);
    const first = session.getRenderFrame().current.ball.x;
    tick(1);
    const second = session.getRenderFrame().current.ball.x;
    // One tick at 90 units/s: exactly 90 * (1/60).
    assert.ok(Math.abs(second - first - 90 * STEP_S) < 1e-9);
  });
});
