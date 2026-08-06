/**
 * Compile-time fixture for the bootstrap `defineGame` contract.
 *
 * This file is type-checked by `pnpm typecheck` and must always compile.
 * Every `@ts-expect-error` below documents a contract violation that the
 * type layer must reject. If any expectation stops erroring, the contract
 * has loosened and this fixture must be updated (or the regression fixed).
 */
import { defineGame, type GameDefinition } from '../src/index.ts';

const viewport = {
  logicalSize: { width: 390, height: 844 },
  scale: 'fit',
  overflow: 'letterbox',
} as const;

// Scene names are inferred: `initialScene` must be one of the `scenes` keys.
const game = defineGame({
  viewport,
  assets: [
    { id: 'local-image', source: 42 },
    { id: 'remote-audio', source: 'https://example.com/theme.mp3' },
  ],
  input: {},
  scenes: { menu: {}, level1: {} },
  initialScene: 'menu',
});

// The result is the full definition, typed with the inferred scene names.
game satisfies GameDefinition<typeof game.scenes, typeof game.input>;
game.initialScene satisfies 'menu' | 'level1';

defineGame({
  viewport,
  assets: [],
  input: {},
  scenes: { menu: {} },
  // @ts-expect-error initialScene must reference an existing scene key
  initialScene: 'missing',
});

defineGame({
  // @ts-expect-error scale must be a declared scale policy
  viewport: { logicalSize: { width: 390, height: 844 }, scale: 'zoom', overflow: 'letterbox' },
  assets: [],
  input: {},
  scenes: { menu: {} },
  initialScene: 'menu',
});

defineGame({
  // @ts-expect-error overflow must be a declared overflow policy
  viewport: { logicalSize: { width: 390, height: 844 }, scale: 'fit', overflow: 'stretch' },
  assets: [],
  input: {},
  scenes: { menu: {} },
  initialScene: 'menu',
});

defineGame({
  // @ts-expect-error logicalSize width must be a number
  viewport: { logicalSize: { width: '390', height: 844 }, scale: 'fit', overflow: 'letterbox' },
  assets: [],
  input: {},
  scenes: { menu: {} },
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
  scenes: { menu: {} },
  initialScene: 'menu',
});

defineGame({
  viewport,
  // @ts-expect-error asset sources must be remote URIs or static require handles
  assets: [{ id: 'hero', source: { uri: 'https://example.com/hero.png' } }],
  input: {},
  scenes: { menu: {} },
  initialScene: 'menu',
});

defineGame({
  viewport,
  assets: [],
  // @ts-expect-error input values must be input actions
  input: { move: 'left' },
  scenes: { menu: {} },
  initialScene: 'menu',
});
