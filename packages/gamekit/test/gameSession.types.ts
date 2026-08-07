import {
  createGameSession,
  defineGame,
  defineScene,
  type InputFrame,
  type RenderFrame,
} from '../src/index.ts';

const game = defineGame({
  viewport: {
    logicalSize: { width: 320, height: 180 },
    scale: 'fit',
    overflow: 'letterbox',
  },
  assets: [],
  input: {
    boost: { type: 'button' },
  },
  scenes: {
    play: defineScene({
      actions: ['boost'],
      create: () => ({ x: 0 }),
      update: ({ state, input }) => ({
        x: state.x + (input.button('boost').held ? 2 : 1),
      }),
      snapshot: ({ state }) => ({ x: state.x }),
    }),
  },
  initialScene: 'play',
});

const session = createGameSession(game);
session.input.press('boost');
// @ts-expect-error input action names are inferred from the game definition
session.input.press('missing');

const frame = session.getRenderFrame();
frame satisfies RenderFrame<{ readonly x: number }>;
frame.current.x satisfies number;
// @ts-expect-error render frames are readonly
frame.alpha = 0;

declare const inputFrame: InputFrame<'boost'>;
inputFrame.button('boost').held satisfies boolean;
// @ts-expect-error input frame action names are constrained
inputFrame.button('missing');
// @ts-expect-error sampled button state is readonly
inputFrame.button('boost').held = false;

defineScene({
  actions: ['boost'],
  create: () => ({}),
  update: ({ state, input }) => {
    // @ts-expect-error scene input is constrained to its declared actions
    input.button('missing');
    return state;
  },
  snapshot: () => null,
});

const undeclaredActionScene = defineScene({
  actions: ['fire'],
  create: () => ({}),
  update: ({ state }) => state,
  snapshot: () => null,
});

// @ts-expect-error every scene action must also exist in the game input map
defineGame({
  viewport: game.viewport,
  assets: [],
  input: { boost: { type: 'button' } },
  scenes: { play: undeclaredActionScene },
  initialScene: 'play',
});

declare const nestedFrame: RenderFrame<{ position: { x: number } }>;
// @ts-expect-error renderer snapshots are deeply readonly
nestedFrame.current.position.x = 2;

defineGame({
  viewport: game.viewport,
  assets: [],
  input: {
    // @ts-expect-error Task 2 only supports button actions
    move: { type: 'axis2d' },
  },
  scenes: game.scenes,
  initialScene: 'play',
});
