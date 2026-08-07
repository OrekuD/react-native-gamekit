import { createGameSession, defineGame, defineScene } from 'react-native-gamekit';

const LOGICAL_WIDTH = 320;
const LOGICAL_HEIGHT = 180;
const BALL_RADIUS = 14;

/** Renderer-specific snapshot consumed by the playground's Skia adapter. */
export interface BootstrapSnapshot {
  readonly ball: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly color: string;
  };
}

/** First functional scene used to prove the complete GameKit runtime path. */
const playScene = defineScene({
  actions: ['boost'],
  create: () => ({ x: 40, direction: 1 }),
  update: ({ state, input, deltaSeconds }) => {
    const speed = input.button('boost').held ? 180 : 70;
    const proposedX = state.x + state.direction * speed * deltaSeconds;
    const minimumX = BALL_RADIUS;
    const maximumX = LOGICAL_WIDTH - BALL_RADIUS;

    if (proposedX >= maximumX) {
      return { x: maximumX, direction: -1 };
    }
    if (proposedX <= minimumX) {
      return { x: minimumX, direction: 1 };
    }
    return { ...state, x: proposedX };
  },
  snapshot: ({ state }): BootstrapSnapshot => ({
    ball: {
      x: state.x,
      y: LOGICAL_HEIGHT / 2,
      radius: BALL_RADIUS,
      color: '#8b5cf6',
    },
  }),
});

/** Static definition retained separately from the live session. */
export const bootstrapDefinition = defineGame({
  viewport: {
    logicalSize: { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT },
    scale: 'fit',
    overflow: 'letterbox',
  },
  assets: [],
  input: {
    boost: {
      type: 'button',
      description: 'Temporarily increase the ball speed',
    },
  },
  scenes: {
    play: playScene,
  },
  initialScene: 'play',
});

/** Root-lifetime live session mounted by the playground GameView. */
export const bootstrapGame = createGameSession(bootstrapDefinition);
