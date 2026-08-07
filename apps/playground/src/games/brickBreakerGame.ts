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
  createGameSession,
  defineGame,
  defineScene,
  type GameRenderFrame,
  type GameSession,
  type SceneSnapshot,
} from 'react-native-gamekit';

export const BRICK_BREAKER_CONFIG = {
  /** Authored logical world size, resolved onto the surface by Viewport2D. */
  logicalWidth: 320,
  logicalHeight: 180,
  paddle: { width: 48, height: 6, y: 168 },
  ball: { radius: 4 },
  bricks: {
    columns: 8,
    rows: 4,
    width: 36,
    height: 10,
    gapX: 4,
    gapY: 4,
    top: 16,
  },
  // Straight-up launch: the ball returns to the centered paddle, giving the
  // player a beat to take control after the one-press start.
  launch: { vx: 0, vy: -150 },
  /** Maximum horizontal ball velocity imposed by paddle deflection. */
  maxBallVx: 150,
  /** Paddle deflection per unit of off-center hit position. */
  paddleDeflection: 1.1,
  /** Fractional speed increase applied on every paddle hit, capped. */
  speedUpPerPaddleHit: 0.03,
  /** Absolute speed cap for the speed-up mechanic. */
  maxBallSpeed: 340,
} as const;

export const TOTAL_BRICKS = BRICK_BREAKER_CONFIG.bricks.columns * BRICK_BREAKER_CONFIG.bricks.rows;

/** A brick in its fixed grid position with an alive flag. */
export interface Brick {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly alive: boolean;
}

/** A ball body with position, velocity, and radius. */
export interface BallBody {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
}

export function createBricks(): Brick[] {
  const { columns, rows, width, height, gapX, gapY, top } = BRICK_BREAKER_CONFIG.bricks;
  const bricks: Brick[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      bricks.push({
        x: column * (width + gapX),
        y: top + row * (height + gapY),
        width,
        height,
        alive: true,
      });
    }
  }
  return bricks;
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
  const left = paddleX - paddleWidth / 2 - ball.radius;
  const right = paddleX + paddleWidth / 2 + ball.radius;
  if (ball.x < left || ball.x > right) {
    return ball;
  }
  const top = paddleY;
  const bottom = paddleY + paddleHeight;
  if (ball.y + ball.radius < top || ball.y - ball.radius > bottom) {
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

function circleRectOverlap(ball: BallBody, rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): boolean {
  const closestX = Math.max(rect.x, Math.min(ball.x, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(ball.y, rect.y + rect.height));
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  return dx * dx + dy * dy <= ball.radius * ball.radius;
}

/**
 * Resolve the ball against all alive bricks: remove every overlapped brick
 * and reflect once on the axis of greatest penetration. Returns the next ball
 * body, the next brick list, and the number of bricks removed this tick.
 */
export function collideBallWithBricks(
  ball: BallBody,
  bricks: readonly Brick[],
): { readonly ball: BallBody; readonly bricks: Brick[]; readonly removed: number } {
  let nextBall = ball;
  const nextBricks = bricks.map((brick) => brick);
  let removed = 0;
  for (let index = 0; index < nextBricks.length; index += 1) {
    const brick = nextBricks[index];
    if (!brick.alive || !circleRectOverlap(nextBall, brick)) {
      continue;
    }
    nextBricks[index] = { ...brick, alive: false };
    removed += 1;
    const overlapLeft = nextBall.x + nextBall.radius - brick.x;
    const overlapRight = brick.x + brick.width - (nextBall.x - nextBall.radius);
    const overlapTop = nextBall.y + nextBall.radius - brick.y;
    const overlapBottom = brick.y + brick.height - (nextBall.y - nextBall.radius);
    const minimum = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
    if (minimum === overlapLeft || minimum === overlapRight) {
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
  readonly bricks: readonly Brick[];
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
  /** All bricks with stable indices; dead bricks report `alive: false`. */
  readonly bricks: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly alive: boolean;
  }[];
  readonly score: number;
  /** Short HUD prompt for the current play state. */
  readonly prompt: string;
  /** Present when the game is won, carrying the result inside this scene. */
  readonly over?: { readonly won: boolean; readonly score: number };
}

export interface GameOverSnapshot {
  readonly message: string;
}

const createPlayState = (): PlayState => {
  const { logicalWidth, paddle, ball, launch } = BRICK_BREAKER_CONFIG;
  // The press that entered play launches the ball: the new scene begins with
  // the ball already in motion (Task 3 transitions carry no payloads, so the
  // launch intent is encoded in the scene's initial state).
  return {
    paddleX: logicalWidth / 2,
    ball: {
      x: logicalWidth / 2,
      y: paddle.y - ball.radius,
      vx: launch.vx,
      vy: launch.vy,
      radius: ball.radius,
    },
    bricks: createBricks(),
    score: 0,
  };
};

const readyScene = defineScene({
  actions: ['primary'],
  transitions: ['play'],
  create: (): ReadyState => ({ prompt: 'Tap to start' }),
  update: ({ state, input, transition }) => {
    if (input.pointer('primary').pressed) {
      transition.setScene('play');
    }
    return state;
  },
  snapshot: ({ state }): ReadySnapshot => ({ prompt: state.prompt }),
});

const playScene = defineScene({
  actions: ['primary'],
  transitions: ['game-over'],
  create: createPlayState,
  update: ({ state, input, transition, deltaSeconds }) => {
    const pointer = input.pointer('primary');
    const { logicalWidth, logicalHeight, paddle } = BRICK_BREAKER_CONFIG;

    // Won: the result flow stays inside this scene. A press restarts it.
    if (state.over) {
      if (pointer.pressed) {
        transition.restartScene();
      }
      return state;
    }

    let paddleX = state.paddleX;
    if (pointer.position !== undefined) {
      paddleX = paddleFromPointer(pointer.position.x);
    }

    let ball = state.ball;
    ball = { ...ball, x: ball.x + ball.vx * deltaSeconds, y: ball.y + ball.vy * deltaSeconds };
    ball = bounceBallOffWalls(ball, logicalWidth, logicalHeight);
    ball = bounceBallOffPaddle(ball, paddleX, paddle.y, paddle.width, paddle.height);
    const collision = collideBallWithBricks(ball, state.bricks);
    ball = collision.ball;
    const score = state.score + collision.removed;

    if (ballLost(ball, logicalHeight)) {
      // Loss is result-free here: the game-over scene is a generic screen
      // because Task 3 transitions carry no payloads.
      transition.setScene('game-over');
      return { ...state, paddleX, ball, score };
    }
    if (score >= TOTAL_BRICKS) {
      return { ...state, paddleX, ball, score, bricks: collision.bricks, over: { won: true, score } };
    }
    return { ...state, paddleX, ball, score, bricks: collision.bricks };
  },
  snapshot: ({ state }): PlaySnapshot => ({
    paddle: { x: state.paddleX },
    ball: { x: state.ball.x, y: state.ball.y },
    bricks: state.bricks.map(({ x, y, width, height, alive }) => ({ x, y, width, height, alive })),
    score: state.score,
    prompt: state.over ? 'You win! Tap to play again' : 'Drag to move the paddle',
    ...(state.over ? { over: state.over } : {}),
  }),
});

const gameOverScene = defineScene({
  actions: ['primary'],
  transitions: ['ready'],
  create: (): GameOverState => ({ message: 'Game over — tap to play again' }),
  update: ({ state, input, transition }) => {
    if (input.pointer('primary').pressed) {
      transition.setScene('ready');
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
  assets: [],
  input: {
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
 * Create a fresh Brick Breaker session owned by the calling screen.
 *
 * The playground screen owns exactly one session and disposes it on final
 * unmount; the definition above remains static and shareable.
 */
export function createBrickBreakerSession(): BrickBreakerSession {
  return createGameSession(brickBreakerDefinition);
}

export type BrickBreakerDefinition = typeof brickBreakerDefinition;

export type BrickBreakerRenderFrame = GameRenderFrame<BrickBreakerDefinition['scenes']>;
export type BrickBreakerSession = GameSession<BrickBreakerDefinition['scenes'], BrickBreakerDefinition['input']>;
export type BrickBreakerSnapshot = SceneSnapshot<BrickBreakerDefinition['scenes'][keyof BrickBreakerDefinition['scenes']]>;
