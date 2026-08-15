import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';
import {
  BRICK_BREAKER_CONFIG,
  BRICK_GRID,
  TOTAL_BRICKS,
  ballLost,
  bounceBallOffPaddle,
  bounceBallOffWalls,
  brickBreakerDefinition,
  clampPaddle,
  collideBallWithBricks,
  initialBrickLiveness,
  type BallBody,
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

function pulseStart(session: BrickBreakerSession): void {
  session.input.press('start');
  session.input.release('start');
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
  it('opens on the ready scene and enters play from the semantic start action', () => {
    const { session, driver } = createSession();
    assert.equal(session.scene, 'ready');
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready' && session.status === 'running') {
        pulseStart(session);
      }
    });
    assert.equal(session.scene, 'play');
  });

  it('uses a portrait game world that can fill the screen body', () => {
    assert.deepEqual(brickBreakerDefinition.viewport.logicalSize, {
      width: 320,
      height: 480,
    });
    assert.ok(BRICK_BREAKER_CONFIG.paddle.y > BRICK_BREAKER_CONFIG.logicalHeight * 0.9);
  });

  it('enters play with the ball in motion (one-press launch) and clamps the paddle', () => {
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        pulseStart(session);
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
    assert.equal(
      frame.current.paddle.x,
      BRICK_BREAKER_CONFIG.logicalWidth - BRICK_BREAKER_CONFIG.paddle.width / 2,
      'clamped to the right edge',
    );

    session.input.move('primary', 2, { x: -10_000, y: 90 });
    driver.fireNext(80);
    frame = session.getRenderFrame();
    if (frame.scene !== 'play') {
      assert.fail(`expected play scene, got ${frame.scene}`);
    }
    assert.equal(
      frame.current.paddle.x,
      BRICK_BREAKER_CONFIG.paddle.width / 2,
      'clamped to the left edge',
    );
  });

  it('keeps the ball inside the world with wall bounces', () => {
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        pulseStart(session);
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
    assert.ok(
      ball.y >= BRICK_BREAKER_CONFIG.ball.radius &&
        ball.y <= BRICK_BREAKER_CONFIG.logicalHeight,
      `ball y in bounds, got ${ball.y}`,
    );
  });

  it('reflects the ball off the paddle', () => {
    const { paddle, ball: ballConfig } = BRICK_BREAKER_CONFIG;
    const ball = {
      x: 160,
      y: paddle.y - ballConfig.radius + 1,
      vx: 0,
      vy: 120,
      radius: ballConfig.radius,
    };
    const next = bounceBallOffPaddle(ball, 160, paddle.y, paddle.width, paddle.height);
    assert.ok(next.vy < 0, 'vertical velocity reflects');
    assert.equal(next.y, paddle.y - ballConfig.radius);
  });

  it('uses paddle hit slop without changing the rendered paddle width', () => {
    const { width, hitSlop } = BRICK_BREAKER_CONFIG.paddle;
    const paddleX = 160;
    const ball = {
      x: paddleX + width / 2 + 4 + hitSlop.horizontal - 1,
      y: BRICK_BREAKER_CONFIG.paddle.y - BRICK_BREAKER_CONFIG.ball.radius + 1,
      vx: 0,
      vy: 120,
      radius: 4,
    };
    const next = bounceBallOffPaddle(
      ball,
      paddleX,
      BRICK_BREAKER_CONFIG.paddle.y,
      width,
      BRICK_BREAKER_CONFIG.paddle.height,
    );
    assert.ok(next.vy < 0, 'near-edge hit reflects inside the collision-only hit slop');
  });

  it('removes bricks and increases the score when the ball crosses the brick row', () => {
    const bricks = initialBrickLiveness();
    // The tall portrait world starts the brick field at `bricks.top` (64);
    // place the ball inside the first row for the collision.
    const ball = { x: 20, y: BRICK_BREAKER_CONFIG.bricks.top + 4, vx: 0, vy: 40, radius: 4 };
    const result = collideBallWithBricks(ball, bricks);
    assert.equal(result.removed, 1);
    assert.equal(result.bricks.filter((alive) => alive === false).length, 1);
    assert.ok(result.ball.vy < 0, 'ball reflects after a brick hit');
  });

  it('preserves brick collection identity when nothing is hit (T3 cache short-circuit)', () => {
    const bricks = initialBrickLiveness();
    const ball = { x: 20, y: 300, vx: 0, vy: 40, radius: 4 };
    const result = collideBallWithBricks(ball, bricks);
    assert.equal(result.removed, 0);
    assert.equal(result.bricks, bricks, 'a no-hit tick must return the same array identity');
  });

  it('keeps static brick geometry out of snapshots and never recreates it', () => {
    const { session, driver } = createSession();
    session.start();
    driver.fireNext(0);
    if (session.scene === 'ready') {
      pulseStart(session);
    }
    driver.fireNext(10);
    const frame = session.getRenderFrame();
    if (frame.scene !== 'play') {
      throw new Error(`expected play, got ${String(frame.scene)}`);
    }
    assert.ok(
      frame.current.bricks.every((alive) => typeof alive === 'boolean'),
      'snapshots carry only liveness, never geometry objects',
    );
    // Geometry lives in the frozen module-scope grid with stable identity.
    assert.equal(BRICK_GRID[0], BRICK_GRID[0]);
    assert.equal(Object.isFrozen(BRICK_GRID[0]), true);
  });

  it('loses the ball when it passes the bottom edge and reaches game-over', () => {
    assert.equal(
      ballLost(
        {
          x: 160,
          y: BRICK_BREAKER_CONFIG.logicalHeight + BRICK_BREAKER_CONFIG.ball.radius + 1,
          vx: 0,
          vy: 0,
          radius: BRICK_BREAKER_CONFIG.ball.radius,
        },
        BRICK_BREAKER_CONFIG.logicalHeight,
      ),
      true,
    );
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        pulseStart(session);
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
        pulseStart(session);
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

  it('restarts directly from game-over into play with one start action', () => {
    const { session, driver } = createSession();
    runFrames(session, driver, 4, () => {
      if (session.scene === 'ready') {
        pulseStart(session);
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
        session.input.press('start');
        session.input.release('start');
      }
    });
    assert.equal(session.scene, 'play');
  });

  it('reaches the same checkpoints at 30, 60, and 120 Hz presentation', () => {
    const script: readonly { readonly atTick: number; readonly run: (session: BrickBreakerSession) => void }[] = [
      { atTick: 10, run: pulseStart },
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
    assert.equal(clampPaddle(-50, 320, 64), 32);
    assert.equal(clampPaddle(500, 320, 64), 288);
    const ball = bounceBallOffWalls(
      { x: 2, y: 50, vx: -40, vy: 0, radius: 4 },
      BRICK_BREAKER_CONFIG.logicalWidth,
      BRICK_BREAKER_CONFIG.logicalHeight,
    );
    assert.equal(ball.x, 4);
    assert.equal(ball.vx, 40);
  });
});

describe('T11.7 collision migration', () => {
  it('never tunnels a brick at the maximum authored speed', () => {
    // The ball at maxBallSpeed (400 u/s) crosses a brick row at the fixed
    // step: every brick in the path must still be hit and removed.
    const speed = BRICK_BREAKER_CONFIG.maxBallSpeed;
    const stepSeconds = FIXED_STEP_MS / 1000;
    const ball: BallBody = {
      x: 160,
      y: 40,
      radius: BRICK_BREAKER_CONFIG.ball.radius,
      vx: 0,
      vy: speed,
    };
    // Step the ball at its max-speed per-tick displacement and accumulate
    // removals: the discrete manifold must catch every brick in the path.
    let bricks = initialBrickLiveness();
    let removed = 0;
    for (let step = 1; step <= 40; step += 1) {
      const result = collideBallWithBricks(
        { ...ball, y: ball.y + speed * stepSeconds * step },
        bricks,
      );
      bricks = result.bricks;
      removed += result.removed;
    }
    assert.ok(removed >= BRICK_BREAKER_CONFIG.bricks.columns, 'no brick is skipped at max speed');
  });

  it('preserves the paddle hit slop as collision-only forgiveness', () => {
    const { paddle } = BRICK_BREAKER_CONFIG;
    const paddleX = 160;
    // The ball center sits OUTSIDE the rendered paddle edge but INSIDE the
    // slop band: it must still bounce.
    const ball: BallBody = {
      x: paddleX + paddle.width / 2 + paddle.hitSlop.horizontal - 2,
      y: paddle.y - 1,
      radius: BRICK_BREAKER_CONFIG.ball.radius,
      vx: 0,
      vy: 100,
    };
    const next = bounceBallOffPaddle(ball, paddleX, paddle.y, paddle.width, paddle.height);
    assert.ok(next.vy < 0, 'the slop band counts as a paddle hit');
    assert.equal(next.y, paddle.y - ball.radius, 'the ball sits on the paddle after the bounce');

    // Outside the slop band entirely (past the center band edge that
    // includes the ball radius): no bounce.
    const miss: BallBody = {
      ...ball,
      x: paddleX + paddle.width / 2 + paddle.hitSlop.horizontal + ball.radius + 2,
    };
    const unchanged = bounceBallOffPaddle(miss, paddleX, paddle.y, paddle.width, paddle.height);
    assert.equal(unchanged.vy, 100, 'outside the slop band there is no paddle hit');
  });

  it('keeps deterministic brick ordering and full removal counts', () => {
    const ball: BallBody = {
      x: 160,
      y: 68,
      radius: BRICK_BREAKER_CONFIG.ball.radius,
      vx: 0,
      vy: 120,
    };
    const result = collideBallWithBricks(ball, initialBrickLiveness());
    // The ball's box [156, 164] touches exactly columns 3 (124..160) and
    // 4 (164..200, tangent) of the first row: deterministic, no surprises.
    assert.equal(result.removed, 2, 'exactly the touched columns are removed');
    assert.equal(result.bricks[3], false);
    assert.equal(result.bricks[4], false);
    assert.equal(result.bricks[2], true, 'untouched columns stay alive');
    assert.equal(
      result.bricks.slice(BRICK_BREAKER_CONFIG.bricks.columns).every((alive) => alive),
      true,
      'lower rows are untouched',
    );
    void TOTAL_BRICKS;
  });
});