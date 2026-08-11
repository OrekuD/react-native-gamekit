import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { defineGame, defineScene } from '../src/index.ts';

const emptyScene = () =>
  defineScene({
    actions: [],
    create: () => ({}),
    update: ({ state }) => ({ ...state }),
    snapshot: () => null,
  });

/**
 * Bootstrap contract for `defineGame`.
 *
 * Task 1 only requires that the supplied definition is preserved and
 * returned: no scheduler, session, asset loading, or runtime behavior is
 * created by this function yet.
 */
describe('defineGame', () => {
  const viewport = {
    logicalSize: { width: 390, height: 844 },
    mode: 'fit',
  } as const;

  it('preserves and returns the supplied definition', () => {
    const definition = {
      viewport,
          input: {},
      scenes: { menu: emptyScene() },
      initialScene: 'menu',
    } as const;

    const game = defineGame(definition);

    assert.equal(game, definition, 'defineGame must return the same object it received');
    assert.deepEqual(game.viewport, viewport);
    assert.equal(game.scenes.menu.kind, 'gamekit.scene');
    assert.equal(game.initialScene, 'menu');
    assert.deepEqual(game.input, {});
  });

  it('supports multiple scenes and any declared scene name as the initial scene', () => {
    const game = defineGame({
      viewport,
      input: { move: { type: 'button' } },
      scenes: { menu: emptyScene(), level1: emptyScene() },
      initialScene: 'level1',
    });

    assert.equal(game.initialScene, 'level1');
    assert.equal(game.scenes.level1?.kind, 'gamekit.scene');
    assert.deepEqual(game.input, { move: { type: 'button' } });
  });
});

describe('defineGame viewport freeze and optional assets (T0)', () => {
  const viewport = {
    logicalSize: { width: 390, height: 844 },
    mode: 'fit',
  } as const;

  it('deep-freezes the viewport config so callers cannot mutate it', () => {
    const definition = {
      viewport,
          input: {},
      scenes: { menu: emptyScene() },
      initialScene: 'menu',
    } as const;
    const game = defineGame(definition);
    assert.equal(Object.isFrozen(game.viewport), true);
    assert.equal(Object.isFrozen(game.viewport.logicalSize), true);
    const mutable = game.viewport as { logicalSize: { width: number }; mode: string };
    assert.throws(() => {
      mutable.logicalSize.width = 999;
    }, TypeError);
    assert.equal(game.viewport.logicalSize.width, 390);
    assert.throws(() => {
      mutable.mode = 'fill';
    }, TypeError);
    assert.equal(game.viewport.mode, 'fit');
  });

  it('accepts a definition without assets until asset loading exists', () => {
    const definition = {
      viewport,
      input: {},
      scenes: { menu: emptyScene() },
      initialScene: 'menu',
    } as const;
    const game = defineGame(definition);
    assert.equal(game, definition);
  });
});
