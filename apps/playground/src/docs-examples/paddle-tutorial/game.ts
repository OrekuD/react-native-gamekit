/**
 * Docs example: "Create your first game" paddle game.
 *
 * This file is the assembled version of the getting-started tutorial
 * (`apps/docs/content/docs/getting-started/create-your-first-game.mdx`),
 * kept in-tree so the docs example is typechecked and behavior-tested
 * against the real library. If the API changes, this test fails first.
 */
import { defineGame, defineScene } from 'rn-gamekit';

const WIDTH = 320;
const HEIGHT = 180;
const PADDLE = { width: 48, height: 10, y: 164 };
const BALL = { radius: 6 };

const playScene = defineScene({
  actions: ['steer'],
  create: () => ({
    paddleX: WIDTH / 2,
    ball: { x: WIDTH / 2, y: HEIGHT / 2, vx: 90, vy: 70 },
  }),
  update: ({ state, input, deltaSeconds }) => {
    const steer = input.pointer('steer');

    // The pointer position is already in logical world coordinates.
    // Clamp the paddle so it can't leave the world.
    const paddleX =
      steer.active && steer.position !== undefined
        ? Math.min(Math.max(steer.position.x, PADDLE.width / 2), WIDTH - PADDLE.width / 2)
        : state.paddleX;

    let { x, y, vx, vy } = state.ball;
    x += vx * deltaSeconds;
    y += vy * deltaSeconds;

    // Bounce off the side walls and the ceiling.
    if (x - BALL.radius <= 0 || x + BALL.radius >= WIDTH) vx = -vx;
    if (y - BALL.radius <= 0) vy = -vy;

    // Bounce off the paddle, only when the ball is on its row.
    const onPaddleRow = y + BALL.radius >= PADDLE.y && y + BALL.radius <= PADDLE.y + PADDLE.height;
    if (onPaddleRow && x >= paddleX - PADDLE.width / 2 && x <= paddleX + PADDLE.width / 2) {
      vy = -Math.abs(vy);
    }

    // Missed: put the ball back in the middle.
    if (y - BALL.radius > HEIGHT) {
      return { paddleX, ball: { x: WIDTH / 2, y: HEIGHT / 2, vx: 90, vy: 70 } };
    }

    return { paddleX, ball: { x, y, vx, vy } };
  },
  snapshot: ({ state }) => ({
    paddle: { x: state.paddleX, y: PADDLE.y, width: PADDLE.width, height: PADDLE.height },
    ball: { x: state.ball.x, y: state.ball.y, radius: BALL.radius },
  }),
});

export const paddleGame = defineGame({
  viewport: {
    logicalSize: { width: WIDTH, height: HEIGHT },
    mode: 'fit',
  },
  input: {
    steer: { type: 'pointer', description: 'Move the paddle' },
  },
  scenes: {
    play: playScene,
  },
  initialScene: 'play',
});
