import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'react-native-gamekit/testing';
import {
  ballLost,
  bounceBallOffPaddle,
  bounceBallOffWalls,
  brickBreakerDefinition,
  clampPaddle,
  collideBallWithBricks,
  createBricks,
  TOTAL_BRICKS,
  type BrickBreakerSession,
} from './brickBreakerGame.ts';

const FIXED_STEP_MS = 10;

function createSession(): { readonly session: BrickBreakerSession; readonly driver: ManualFrameDriver } {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(brickBreakerDefinition, {
    frameDriver: driver,
    fixedStepMs: FIXED_STEP_MS,
  });
  return { session, driver };
}

/**
 * Start the session and establish the baseline frame, then fire `frames`
 * more frames at the fixed step, calling `beforeFrame(tick)` between frames.
 */
function runFrames(
  session: BrickBreakerSession,
  driver: ManualFrameDriver,
  frames: number,
  afterFrame: (currentTick: number) => void = () => {},
): void {
  session.start();
  driver.fireNext(0);
  for (let index = 1; index <= frames; index += 1) {
    driver.fireNext(index * FIXED_STEP_MS);
    afterFrame(session.getRenderFrame().tick);
  }
}

/**
 * Fire frames at the fixed step from the current timeline position without
 * restarting the session (for continuation runs).
 */
function continueFrames(
  driver: ManualFrameDriver,
  frames: number,
  afterFrame: (currentTick: number) => void = () => {},
): void {
  for (let index = 0; index < frames; index += 1) {
    driver.fireNext((index + 1) * FIXED_STEP_MS);
    afterFrame(0);
  }
}

describe('Brick Breaker headless gameplay', () => {
  it('opens on the ready scene and enters play on the first press', () => {
    const { session, driver } = createSession();
    assert.equal(session.scene, 'ready');
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready' && session.status === 'running') {
        session.input.begin('primary', 1, { x: 160, y: 90 });
      }
    });
    assert.equal(session.scene, 'play');
  });

  it('enters play with the ball in motion (one-press launch) and clamps the paddle', () => {
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        session.input.begin('primary', 1, { x: 160, y: 90 });
      }
    });
    assert.equal(session.scene, 'play');

    // The press that entered play also launched the ball: it rises off the
    // paddle without any further input.
    let frame = session.getRenderFrame();
    if (frame.scene !== 'play') {
      assert.fail(`expected play scene, got ${frame.scene}`);
    }
    const startY = frame.current.ball.y;
    session.input.begin('primary', 2, { x: 160, y: 90 });
    driver.fireNext(50);
    driver.fireNext(60);
    frame = session.getRenderFrame();
    if (frame.scene !== 'play') {
      assert.fail(`expected play scene, got ${frame.scene}`);
    }
    assert.ok(frame.current.ball.y < startY, 'the ball moves upward after entering play');
    assert.equal(frame.current.prompt, 'Drag to move the paddle');

    // Extremely off-screen pointer positions clamp the paddle into the world.
    session.input.move('primary', 2, { x: 10_000, y: 90 });
    driver.fireNext(70);
    frame = session.getRenderFrame();
    if (frame.scene !== 'play') {
      assert.fail(`expected play scene, got ${frame.scene}`);
    }
    assert.equal(frame.current.paddle.x, 320 - 24, 'clamped to the right edge');

    session.input.move('primary', 2, { x: -10_000, y: 90 });
    driver.fireNext(80);
    frame = session.getRenderFrame();
    if (frame.scene !== 'play') {
      assert.fail(`expected play scene, got ${frame.scene}`);
    }
    assert.equal(frame.current.paddle.x, 24, 'clamped to the left edge');
  });

  it('keeps the ball inside the world with wall bounces', () => {
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        session.input.begin('primary', 1, { x: 160, y: 90 });
      }
    });
    runFrames(session, driver, 1, () => {
      if (session.scene === 'play') {
        session.input.begin('primary', 2, { x: 160, y: 90 });
      }
    });
    for (let index = 0; index < 300; index += 1) {
      const frame = session.getRenderFrame();
      if (frame.scene === 'play') {
        session.input.move('primary', 2, { x: frame.current.ball.x, y: 90 });
      }
      driver.fireNext((index + 1) * FIXED_STEP_MS);
    }
    const frame = session.getRenderFrame();
    if (frame.scene !== 'play') {
      assert.fail(`paddle tracking keeps the ball alive (scene ${frame.scene})`);
    }
    const ball = frame.current.ball;
    assert.ok(ball.x >= 4 && ball.x <= 316, `ball x in bounds, got ${ball.x}`);
    assert.ok(ball.y >= 4 && ball.y <= 180, `ball y in bounds, got ${ball.y}`);
  });

  it('reflects the ball off the paddle', () => {
    const ball = { x: 160, y: 165, vx: 0, vy: 120, radius: 4 };
    const next = bounceBallOffPaddle(ball, 160, 168, 48, 6);
    assert.ok(next.vy < 0, 'vertical velocity reflects');
    assert.equal(next.y, 164);
  });

  it('removes bricks and increases the score when the ball crosses the brick row', () => {
    const bricks = createBricks();
    const ball = { x: 20, y: 24, vx: 0, vy: 40, radius: 4 };
    const result = collideBallWithBricks(ball, bricks);
    assert.equal(result.removed, 1);
    assert.equal(result.bricks.filter((brick) => brick.alive).length, TOTAL_BRICKS - 1);
    assert.ok(result.ball.vy < 0, 'ball reflects after a brick hit');
  });

  it('loses the ball when it passes the bottom edge and reaches game-over', () => {
    assert.equal(ballLost({ x: 160, y: 185, vx: 0, vy: 0, radius: 4 }, 180), true);
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        session.input.begin('primary', 1, { x: 160, y: 90 });
      }
    });
    runFrames(session, driver, 1, () => {
      if (session.scene === 'play') {
        // Move the paddle away from the straight-up ball so it falls through.
        session.input.begin('primary', 2, { x: 300, y: 90 });
      }
    });
    // The ball eventually falls past the bottom edge.
    continueFrames(driver, 2_000);
    assert.equal(session.scene, 'game-over');
  });

  it('wins when every brick is cleared', () => {
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        session.input.begin('primary', 1, { x: 160, y: 90 });
      }
    });
    runFrames(session, driver, 1, () => {
      if (session.scene === 'play') {
        session.input.begin('primary', 2, { x: 160, y: 90 });
      }
    });
    // Track the ball with a lag so paddle deflection keeps the ball sweeping.
    let won = false;
    let score = 0;
    for (let index = 0; index < 15_000 && !won; index += 1) {
      const frame = session.getRenderFrame();
      if (frame.scene === 'game-over') {
        break;
      }
      if (frame.scene === 'play') {
        score = frame.current.score;
        if (frame.current.over?.won === true) {
          won = true;
          score = frame.current.over.score;
          break;
        }
        const offset = 12 * Math.sin(index / 9);
        session.input.move('primary', 2, { x: frame.current.ball.x + offset, y: 90 });
      }
      driver.fireNext((index + 1) * FIXED_STEP_MS);
    }
    assert.equal(won, true, 'every brick cleared within 150s of sim time');
    assert.equal(score, 32);
  });

  it('supports the full ready -> play -> game-over -> ready cycle', () => {
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        session.input.begin('primary', 1, { x: 160, y: 90 });
      }
    });
    assert.equal(session.scene, 'play');
    // Move the paddle away so the straight-up ball falls through.
    runFrames(session, driver, 1, () => {
      if (session.scene === 'play') {
        session.input.begin('primary', 2, { x: 300, y: 90 });
      }
    });
    continueFrames(driver, 2_000);
    assert.equal(session.scene, 'game-over');
    runFrames(session, driver, 4, () => {
      if (session.scene === 'game-over') {
        session.input.begin('primary', 1, { x: 160, y: 90 });
      }
    });
    assert.equal(session.scene, 'ready');
  });

  it('reaches the same checkpoints at 30, 60, and 120 Hz presentation', () => {
    const script: readonly { readonly atTick: number; readonly run: (session: BrickBreakerSession) => void }[] = [
      { atTick: 10, run: (session) => session.input.begin('primary', 1, { x: 160, y: 90 }) },
      { atTick: 30, run: (session) => session.input.begin('primary', 2, { x: 160, y: 90 }) },
      { atTick: 80, run: (session) => session.input.move('primary', 2, { x: 260, y: 90 }) },
      { atTick: 140, run: (session) => session.input.move('primary', 2, { x: 60, y: 90 }) },
      { atTick: 220, run: (session) => session.input.end('primary', 2) },
    ];

    const runAtRate = (presentationHz: number) => {
      const { session, driver } = createSession();
      session.start();
      driver.fireNext(0);
      const wallPerFrame = 1000 / presentationHz;
      const frameCount = Math.round((2_500 / wallPerFrame) + 10);
      let scriptIndex = 0;
      let atCheckpoint = false;
      for (let index = 1; index <= frameCount; index += 1) {
        driver.fireNext(index * wallPerFrame);
        const currentTick = session.getRenderFrame().tick;
        // Input is enqueued between frames, so every presentation rate samples
        // it at the same next tick.
        while (scriptIndex < script.length && script[scriptIndex]?.atTick <= currentTick) {
          script[scriptIndex]?.run(session);
          scriptIndex += 1;
        }
        // Capture the state at the same simulation tick on every rate; the
        // simulation is deterministic per tick even though presentation-rate
        // fractions can shift wall-clock alignment by a tick at transitions.
        if (!atCheckpoint && currentTick >= 250) {
          atCheckpoint = true;
          const frame = session.getRenderFrame();
          return {
            scene: frame.scene,
            tick: frame.tick,
            score: frame.scene === 'play' ? frame.current.score : -1,
            ball: frame.scene === 'play' ? frame.current.ball : null,
            paddle: frame.scene === 'play' ? frame.current.paddle : null,
          };
        }
      }
      const frame = session.getRenderFrame();
      return {
        scene: frame.scene,
        tick: frame.tick,
        score: frame.scene === 'play' ? frame.current.score : -1,
        ball: frame.scene === 'play' ? frame.current.ball : null,
        paddle: frame.scene === 'play' ? frame.current.paddle : null,
      };
    };

    const at30 = runAtRate(30);
    const at60 = runAtRate(60);
    const at120 = runAtRate(120);
    assert.deepEqual(at30, at60);
    assert.deepEqual(at60, at120);
    assert.equal(at60.tick, 250, 'checkpoint captured at the same simulation tick');
  });

  it('clamps paddle and wall-bounce helpers deterministically', () => {
    assert.equal(clampPaddle(-50, 320, 48), 24);
    assert.equal(clampPaddle(500, 320, 48), 296);
    const ball = bounceBallOffWalls({ x: 2, y: 50, vx: -40, vy: 0, radius: 4 }, 320, 180);
    assert.equal(ball.x, 4);
    assert.equal(ball.vx, 40);
  });
});
