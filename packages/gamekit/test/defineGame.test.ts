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
      assets: [],
      input: {},
      scenes: { menu: emptyScene() },
      initialScene: 'menu',
    } as const;

    const game = defineGame(definition);

    assert.equal(game, definition, 'defineGame must return the same object it received');
    assert.deepEqual(game.viewport, viewport);
    assert.equal(game.scenes.menu.kind, 'gamekit.scene');
    assert.equal(game.initialScene, 'menu');
    assert.deepEqual(game.assets, []);
    assert.deepEqual(game.input, {});
  });

  it('supports multiple scenes and any declared scene name as the initial scene', () => {
    const game = defineGame({
      viewport,
      assets: [
        { id: 'hero', source: 42 },
        { id: 'theme', source: 'https://example.com/theme.mp3' },
      ],
      input: { move: { type: 'button' } },
      scenes: { menu: emptyScene(), level1: emptyScene() },
      initialScene: 'level1',
    });

    assert.equal(game.initialScene, 'level1');
    assert.equal(game.scenes.level1?.kind, 'gamekit.scene');
    assert.deepEqual(game.assets, [
      { id: 'hero', source: 42 },
      { id: 'theme', source: 'https://example.com/theme.mp3' },
    ]);
    assert.deepEqual(game.input, { move: { type: 'button' } });
  });
});
