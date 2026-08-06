import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { defineGame } from '../src/index.ts';

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
    scale: 'fit',
    overflow: 'letterbox',
  } as const;

  it('preserves and returns the supplied definition', () => {
    const definition = {
      viewport,
      assets: [],
      input: {},
      scenes: { menu: {} },
      initialScene: 'menu',
    } as const;

    const game = defineGame(definition);

    assert.equal(game, definition, 'defineGame must return the same object it received');
    assert.deepEqual(game.viewport, viewport);
    assert.deepEqual(game.scenes, { menu: {} });
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
      input: { move: {} },
      scenes: { menu: { name: 'menu' }, level1: { name: 'level1' } },
      initialScene: 'level1',
    });

    assert.equal(game.initialScene, 'level1');
    assert.equal(game.scenes.level1?.name, 'level1');
    assert.deepEqual(game.assets, [
      { id: 'hero', source: 42 },
      { id: 'theme', source: 'https://example.com/theme.mp3' },
    ]);
    assert.deepEqual(game.input, { move: {} });
  });
});
