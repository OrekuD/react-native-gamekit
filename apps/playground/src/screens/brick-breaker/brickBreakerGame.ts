/**
 * Brick Breaker — the Task 3 reference game.
 *
 * A complete single-player arcade loop built only on the provisional GameKit
 * API: three named scenes, pointer input in logical coordinates, example-local
 * deterministic collision, and no renderer or React coupling in this module.
 *
 * Because Task 3 has no transition payloads, the play scene owns the whole
 * gameplay flow (score, win, bottom-edge loss) and the `game-over` scene is a
 * deliberate result-free screen: it demonstrates that scenes cannot share
 * results until a typed payload design lands.
 */
import {
  collideCircleAabb2D,
  createGameSession,
  defineGame,
  defineScene,
  expandAabb2D,
  intersectsAabbAabb2D,
  type Aabb2D,
  type CommitFrame,
  type GameSession,
  type SceneSnapshot,
} from 'rn-gamekit';

export const BRICK_BREAKER_CONFIG = {
  /** Authored logical world size, resolved onto the surface by Viewport2D. */
  logicalWidth: 320,
  logicalHeight: 480,
  paddle: {
    width: 64,
    height: 8,
    y: 452,
    /** Collision-only forgiveness; the rendered paddle keeps its authored size. */
    hitSlop: { horizontal: 10, vertical: 4 },
  },
  ball: { radius: 4 },
  bricks: {
    columns: 8,
    rows: 4,
    width: 36,
    height: 10,
    gapX: 4,
    gapY: 4,
    top: 64,
  },
  // Straight-up launch: the ball returns to the centered paddle, giving the
  // player a beat to take control after the one-press start.
  launch: { vx: 0, vy: -240 },
  /** Maximum horizontal ball velocity imposed by paddle deflection. */
  maxBallVx: 220,
  /** Paddle deflection per unit of off-center hit position. */
  paddleDeflection: 1.1,
  /** Fractional speed increase applied on every paddle hit, capped. */
  speedUpPerPaddleHit: 0.03,
  /** Absolute speed cap for the speed-up mechanic. */
  maxBallSpeed: 400,
} as const;

export const TOTAL_BRICKS = BRICK_BREAKER_CONFIG.bricks.columns * BRICK_BREAKER_CONFIG.bricks.rows;

/** Immutable brick geometry in its fixed grid position. */
export interface BrickGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Deeply immutable static brick grid, created once at module scope (T8).
 * Geometry never lives in live state or snapshots; only liveness does.
 */
export const BRICK_GRID: readonly BrickGeometry[] = Object.freeze(
  (() => {
    const { columns, rows, width, height, gapX, gapY, top } = BRICK_BREAKER_CONFIG.bricks;
    const grid: BrickGeometry[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        grid.push(
          Object.freeze({
            x: column * (width + gapX),
            y: top + row * (height + gapY),
            width,
            height,
          }),
        );
      }
    }
    return grid;
  })(),
);

/** Per-brick liveness; the only brick data that changes during play. */
export type BrickLiveness = readonly boolean[];

/** Shared frozen all-alive liveness; sessions copy lazily on first hit. */
export const INITIAL_LIVENESS: BrickLiveness = Object.freeze(
  Array.from({ length: TOTAL_BRICKS }, () => true),
);

/** The liveness collection a fresh play scene starts from. */
export function initialBrickLiveness(): BrickLiveness {
  return INITIAL_LIVENESS;
}

/** A ball body with position, velocity, and radius. */
export interface BallBody {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
}



/** Reflect the ball off the left, right, and top walls of the world. */
export function bounceBallOffWalls(ball: BallBody, worldWidth: number, worldHeight: number): BallBody {
  let { x, y, vx, vy } = ball;
  const radius = ball.radius;
  if (x - radius < 0) {
    x = radius;
    vx = Math.abs(vx);
  }
  if (x + radius > worldWidth) {
    x = worldWidth - radius;
    vx = -Math.abs(vx);
  }
  if (y - radius < 0) {
    y = radius;
    vy = Math.abs(vy);
  }
  return { ...ball, x, y, vx, vy };
}

/**
 * Reflect the ball off the paddle when it is descending into the paddle band.
 * Returns the ball unchanged when no reflection applies. Horizontal velocity
 * deflects by the off-center hit position.
 */
export function bounceBallOffPaddle(
  ball: BallBody,
  paddleX: number,
  paddleY: number,
  paddleWidth: number,
  paddleHeight: number,
): BallBody {
  if (ball.vy <= 0) {
    return ball;
  }
  // T11.7: the hit test is the public AABB-AABB predicate over the ball's
  // bounding box and the paddle expanded by the authored collision slop.
  // The rendered paddle keeps its authored size; the slop is collision-only.
  const { hitSlop } = BRICK_BREAKER_CONFIG.paddle;
  const ballBox: Aabb2D = {
    x: ball.x - ball.radius,
    y: ball.y - ball.radius,
    width: ball.radius * 2,
    height: ball.radius * 2,
  };
  const paddleBox: Aabb2D = {
    x: paddleX - paddleWidth / 2,
    y: paddleY,
    width: paddleWidth,
    height: paddleHeight,
  };
  if (!intersectsAabbAabb2D(ballBox, expandAabb2D(paddleBox, { x: hitSlop.horizontal, y: hitSlop.vertical }))) {
    return ball;
  }
  const { paddleDeflection, maxBallVx, speedUpPerPaddleHit, maxBallSpeed } = BRICK_BREAKER_CONFIG;
  const hitRatio = (ball.x - paddleX) / (paddleWidth / 2);
  let vx = Math.max(-maxBallVx, Math.min(maxBallVx, ball.vx + hitRatio * paddleDeflection * 60));
  let vy = -Math.abs(ball.vy);
  if (speedUpPerPaddleHit > 0) {
    const speed = Math.hypot(vx, Math.abs(vy));
    const nextSpeed = Math.min(maxBallSpeed, speed * (1 + speedUpPerPaddleHit));
    const ratio = nextSpeed / speed;
    vx *= ratio;
    vy *= ratio;
  }
  return { ...ball, x: ball.x, y: paddleY - ball.radius, vx, vy };
}

/**
 * Resolve the ball against all alive bricks: remove every overlapped brick
 * and reflect once on the axis of greatest penetration. Returns the next ball
 * body, the next liveness collection, and the number of bricks removed.
 *
 * Liveness is copied lazily on the first hit and the **original collection
 * identity is preserved when nothing is hit** — which is exactly what lets
 * the session's trusted deep-freeze cache short-circuit the subtree (T8).
 */
export function collideBallWithBricks(
  ball: BallBody,
  bricks: BrickLiveness,
): { readonly ball: BallBody; readonly bricks: BrickLiveness; readonly removed: number } {
  let nextBall = ball;
  let nextBricks: BrickLiveness = bricks;
  let mutableBricks: boolean[] | undefined;
  let removed = 0;
  for (let index = 0; index < bricks.length; index += 1) {
    if (!bricks[index]) {
      continue;
    }
    const brick = BRICK_GRID[index]!;
    const hit = collideCircleAabb2D(nextBall, brick);
    if (hit === undefined) {
      continue;
    }
    if (mutableBricks === undefined) {
      mutableBricks = bricks.slice(); // Lazy copy on first hit.
      nextBricks = mutableBricks;
    }
    mutableBricks[index] = false;
    removed += 1;
    // Reflect on the manifold's penetration axis; the reflection rule and
    // the brick removal stay authored in the game (Collision2D reports
    // geometry only).
    if (Math.abs(hit.normal.x) > 0.5) {
      nextBall = { ...nextBall, vx: -nextBall.vx };
    } else {
      nextBall = { ...nextBall, vy: -nextBall.vy };
    }
  }
  return { ball: nextBall, bricks: nextBricks, removed };
}

/** Whether the ball has fallen past the bottom edge of the world. */
export function ballLost(ball: BallBody, worldHeight: number): boolean {
  return ball.y - ball.radius > worldHeight;
}

/** Clamp a paddle center into the authored world. */
export function clampPaddle(paddleX: number, worldWidth: number, paddleWidth: number): number {
  const half = paddleWidth / 2;
  return Math.max(half, Math.min(worldWidth - half, paddleX));
}

/** The paddle center clamped to follow a logical pointer x. */
export function paddleFromPointer(x: number): number {
  return clampPaddle(x, BRICK_BREAKER_CONFIG.logicalWidth, BRICK_BREAKER_CONFIG.paddle.width);
}

export interface ReadyState {
  readonly prompt: string;
}

export interface PlayState {
  readonly paddleX: number;
  readonly ball: BallBody;
  readonly bricks: BrickLiveness;
  readonly score: number;
  /** Present when the game is won; the result flow stays inside this scene. */
  readonly over?: { readonly won: boolean; readonly score: number };
}

export interface GameOverState {
  readonly message: string;
}

export interface ReadySnapshot {
  readonly prompt: string;
}

export interface PlaySnapshot {
  readonly paddle: { readonly x: number };
  readonly ball: { readonly x: number; readonly y: number };
  /** Compact per-brick liveness; static geometry lives in `BRICK_GRID`. */
  readonly bricks: BrickLiveness;
  readonly score: number;
  /** Short HUD prompt for the current play state. */
  readonly prompt: string;
  /** Present when the game is won, carrying the result inside this scene. */
  readonly over?: { readonly won: boolean; readonly score: number };
}

export interface GameOverSnapshot {
  readonly message: string;
}

const createLaunchBall = (paddleX: number): BallBody => {
  const { paddle, ball, launch } = BRICK_BREAKER_CONFIG;
  return {
    x: paddleX,
    y: paddle.y - ball.radius,
    vx: launch.vx,
    vy: launch.vy,
    radius: ball.radius,
  };
};

const createPlayState = (): PlayState => {
  const { logicalWidth } = BRICK_BREAKER_CONFIG;
  // The press that entered play launches the ball: the new scene begins with
  // the ball already in motion (Task 3 transitions carry no payloads, so the
  // launch intent is encoded in the scene's initial state).
  return {
    paddleX: logicalWidth / 2,
    ball: createLaunchBall(logicalWidth / 2),
    bricks: INITIAL_LIVENESS,
    score: 0,
  };
};

const readyScene = defineScene({
  actions: ['start', 'primary'],
  transitions: ['play'],
  create: (): ReadyState => ({ prompt: 'Tap to start' }),
  update: ({ state, input, transition }) => {
    if (input.button('start').pressed || input.pointer('primary').pressed) {
      transition.setScene('play');
    }
    return state;
  },
  snapshot: ({ state }): ReadySnapshot => ({ prompt: state.prompt }),
});

function createPlayScene(loopForPerformanceLab: boolean) {
  return defineScene({
    actions: ['start', 'primary'],
    transitions: ['game-over'],
    create: createPlayState,
    update: ({ state, input, transition, deltaSeconds }) => {
      const pointer = input.pointer('primary');
      const { logicalWidth, logicalHeight, paddle } = BRICK_BREAKER_CONFIG;

      // Won: the result flow stays inside this scene. A press restarts it.
      if (state.over) {
        if (input.button('start').pressed || pointer.pressed) {
          transition.restartScene();
        }
        return state;
      }

      let paddleX = state.paddleX;
      if (pointer.position !== undefined) {
        paddleX = paddleFromPointer(pointer.position.x);
      }

      let ball = state.ball;
      ball = {
        ...ball,
        x: ball.x + ball.vx * deltaSeconds,
        y: ball.y + ball.vy * deltaSeconds,
      };
      ball = bounceBallOffWalls(ball, logicalWidth, logicalHeight);
      ball = bounceBallOffPaddle(ball, paddleX, paddle.y, paddle.width, paddle.height);
      const collision = collideBallWithBricks(ball, state.bricks);
      ball = collision.ball;
      const score = state.score + collision.removed;

      if (ballLost(ball, logicalHeight)) {
        if (loopForPerformanceLab) {
          return {
            ...state,
            paddleX,
            ball: createLaunchBall(paddleX),
            score,
            bricks: collision.bricks,
          };
        }
        // Loss is result-free here: the game-over scene is a generic screen
        // because Task 3 transitions carry no payloads.
        transition.setScene('game-over');
        return { ...state, paddleX, ball, score };
      }
      if (score >= TOTAL_BRICKS) {
        if (loopForPerformanceLab) {
          return {
            ...state,
            paddleX,
            ball: createLaunchBall(paddleX),
            bricks: INITIAL_LIVENESS,
            score: 0,
          };
        }
        return {
          ...state,
          paddleX,
          ball,
          score,
          bricks: collision.bricks,
          over: { won: true, score },
        };
      }
      return { ...state, paddleX, ball, score, bricks: collision.bricks };
    },
    snapshot: ({ state }): PlaySnapshot => ({
      paddle: { x: state.paddleX },
      ball: { x: state.ball.x, y: state.ball.y },
      bricks: state.bricks,
      score: state.score,
      prompt: state.over ? 'You win! Tap to play again' : 'Drag to move the paddle',
      ...(state.over ? { over: state.over } : {}),
    }),
  });
}

const playScene = createPlayScene(false);
const performancePlayScene = createPlayScene(true);

const gameOverScene = defineScene({
  actions: ['start', 'primary'],
  transitions: ['play'],
  create: (): GameOverState => ({ message: 'Game over — tap to play again' }),
  update: ({ state, input, transition }) => {
    if (input.button('start').pressed || input.pointer('primary').pressed) {
      transition.setScene('play');
    }
    return state;
  },
  snapshot: ({ state }): GameOverSnapshot => ({ message: state.message }),
});

/** Static Brick Breaker definition, retained separately from any session. */
export const brickBreakerDefinition = defineGame({
  viewport: {
    logicalSize: {
      width: BRICK_BREAKER_CONFIG.logicalWidth,
      height: BRICK_BREAKER_CONFIG.logicalHeight,
    },
    mode: 'fit',
  },
  input: {
    start: {
      type: 'button',
      description: 'Start or restart the game from the screen body',
    },
    primary: {
      type: 'pointer',
      description: 'Move the paddle and start or restart the game',
    },
  },
  scenes: {
    ready: readyScene,
    play: playScene,
    'game-over': gameOverScene,
  },
  initialScene: 'ready',
});

/**
 * Brick Breaker variant used only by the Performance Lab.
 *
 * It starts directly in play so the benchmark's first native touch is not
 * invalidated by the normal ready-to-play transition. Losses and wins relaunch
 * in place, keeping the renderer, simulation, and input pipeline active for
 * the full measurement window.
 */
export const brickBreakerPerformanceDefinition = defineGame({
  viewport: brickBreakerDefinition.viewport,
  assets: brickBreakerDefinition.assets,
  input: brickBreakerDefinition.input,
  scenes: {
    ready: readyScene,
    play: performancePlayScene,
    'game-over': gameOverScene,
  },
  initialScene: 'play',
});

/**
 * Create a fresh Brick Breaker session owned by the calling screen.
 *
 * Deliberately imperative (not useGameSession): the persistent playground
 * shell owns sessions through its surface controller, which must retire and
 * dispose sessions across game swaps, background/foreground, and the asset
 * readiness boundary. The definition above remains static and shareable.
 */
export function createBrickBreakerSession(): BrickBreakerSession {
  return createGameSession(brickBreakerDefinition);
}

export type BrickBreakerDefinition = typeof brickBreakerDefinition;

export type BrickBreakerRenderFrame = CommitFrame<BrickBreakerDefinition['scenes']>;
export type BrickBreakerSession = GameSession<BrickBreakerDefinition['scenes'], BrickBreakerDefinition['input']>;
export type BrickBreakerSnapshot = SceneSnapshot<BrickBreakerDefinition['scenes'][keyof BrickBreakerDefinition['scenes']]>;
