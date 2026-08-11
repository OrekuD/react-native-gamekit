import assert from 'node:assert/strict';
import { it } from 'node:test';

import { bindGameSession } from '../src/react/bindGameSession.ts';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

it('binds presentation imperatively and pauses without disposing on cleanup', () => {
  const driver = new ManualFrameDriver();
  const definition = defineGame({
    viewport: {
      logicalSize: { width: 320, height: 180 },
      mode: 'fit',
    },
      input: {},
    scenes: {
      play: defineScene({
        actions: [],
        create: () => ({ x: 0 }),
        update: ({ state }) => ({ x: state.x + 1 }),
        snapshot: ({ state }) => ({ x: state.x }),
      }),
    },
    initialScene: 'play',
  });
  const game = createGameSessionWithDriver(definition, {
    frameDriver: driver,
    fixedStepMs: 10,
  });
  const frames: Array<{ scene: string; previous: { x: number }; current: { x: number } }> = [];

  const cleanup = bindGameSession(game, (frame) => frames.push(frame as never));
  assert.equal(game.status, 'running');
  assert.equal(frames.length, 1, 'the renderer receives the initial frame immediately');

  driver.fireNext(0);
  driver.fireNext(10);
  assert.equal(frames.at(-1)?.current.x, 1);

  cleanup();
  cleanup();
  assert.equal(game.status, 'paused');
  assert.notEqual(game.status, 'disposed');
  assert.equal(driver.pendingCount, 0);
});
