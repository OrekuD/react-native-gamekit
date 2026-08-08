/**
 * Compile-time fixture for the bootstrap `defineGame` contract.
 *
 * This file is type-checked by `pnpm typecheck` and must always compile.
 * Every `@ts-expect-error` below documents a contract violation that the
 * type layer must reject. If any expectation stops erroring, the contract
 * has loosened and this fixture must be updated (or the regression fixed).
 */
import { defineGame, defineScene, type GameDefinition } from '../src/index.ts';

const emptyScene = defineScene({
  actions: [],
  create: () => ({}),
  update: ({ state }) => ({ ...state }),
  snapshot: () => null,
});

const viewport = {
  logicalSize: { width: 390, height: 844 },
  mode: 'fit',
} as const;

// Scene names are inferred: `initialScene` must be one of the `scenes` keys.
const game = defineGame({
  viewport,
  assets: [
    { id: 'local-image', source: 42 },
    { id: 'remote-audio', source: 'https://example.com/theme.mp3' },
  ],
  input: {},
  scenes: { menu: emptyScene, level1: emptyScene },
  initialScene: 'menu',
});

// The result is the full definition, typed with the inferred scene names.
game satisfies GameDefinition<typeof game.scenes, typeof game.input>;
game.initialScene satisfies 'menu' | 'level1';

defineGame({
  viewport,
  assets: [],
  input: {},
  scenes: { menu: emptyScene },
  // @ts-expect-error initialScene must reference an existing scene key
  initialScene: 'missing',
});

defineGame({
  // @ts-expect-error mode must be a declared viewport mode
  viewport: { logicalSize: { width: 390, height: 844 }, mode: 'zoom' },
  assets: [],
  input: {},
  scenes: { menu: emptyScene },
  initialScene: 'menu',
});

defineGame({
  // @ts-expect-error the Task 2 scale/overflow pair is replaced by mode
  viewport: { logicalSize: { width: 390, height: 844 }, scale: 'fit', overflow: 'letterbox' },
  assets: [],
  input: {},
  scenes: { menu: emptyScene },
  initialScene: 'menu',
});

defineGame({
  // @ts-expect-error logicalSize width must be a number
  viewport: { logicalSize: { width: '390', height: 844 }, mode: 'fit' },
  assets: [],
  input: {},
  scenes: { menu: emptyScene },
  initialScene: 'menu',
});

defineGame({
  viewport,
  assets: [],
  input: {},
  // @ts-expect-error scenes values must be scene definitions
  scenes: { menu: 42 },
  initialScene: 'menu',
});

defineGame({
  viewport,
  // @ts-expect-error assets entries must be asset descriptors
  assets: [{ id: 'hero' }],
  input: {},
  scenes: { menu: emptyScene },
  initialScene: 'menu',
});

defineGame({
  viewport,
  // @ts-expect-error asset sources must be remote URIs or static require handles
  assets: [{ id: 'hero', source: { uri: 'https://example.com/hero.png' } }],
  input: {},
  scenes: { menu: emptyScene },
  initialScene: 'menu',
});

defineGame({
  viewport,
  assets: [],
  // @ts-expect-error input values must be input actions
  input: { move: 'left' },
  scenes: { menu: emptyScene },
  initialScene: 'menu',
});

const undeclaredTransitionScene = defineScene({
  actions: [],
  transitions: ['missing-scene'],
  create: () => ({}),
  update: ({ state }) => state,
  snapshot: () => null,
});

// @ts-expect-error every declared transition target must be a declared scene
defineGame({
  viewport,
  assets: [],
  input: {},
  scenes: { menu: undeclaredTransitionScene },
  initialScene: 'menu',
});

defineGame({
  viewport,
  assets: [],
  input: { primary: { type: 'pointer' } },
  scenes: {
    menu: defineScene({
      actions: ['primary'],
      transitions: ['level1'],
      create: () => ({}),
      update: ({ state, input, transition }) => {
        if (input.pointer('primary').pressed) {
          transition.setScene('level1');
        }
        // @ts-expect-error scene transitions are restricted to declared targets
        transition.setScene('menu');
        return state;
      },
      snapshot: () => null,
    }),
    level1: defineScene({
      actions: [],
      create: () => ({}),
      update: ({ state }) => state,
      snapshot: () => null,
    }),
  },
  initialScene: 'menu',
});

// T0: `assets` is optional until asset loading exists.
defineGame({
  viewport,
  input: {},
  scenes: { menu: emptyScene },
  initialScene: 'menu',
});
