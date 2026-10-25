import assert from 'node:assert/strict';
import { it } from 'node:test';

import { SnapshotDomainError, defineGame, defineScene } from '../src/index';
import { createGameSessionWithDriver, ManualFrameDriver } from '../src/testing';

it('exports the snapshot error thrown by the public session boundary', () => {
  const game = defineGame({
    viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
    input: {},
    scenes: {
      play: defineScene({
        actions: [],
        create: () => ({}),
        update: ({ state }) => state,
        snapshot: () => ({ invalid: new Map() }),
      }),
    },
    initialScene: 'play',
  });

  assert.throws(
    () => createGameSessionWithDriver(game, { frameDriver: new ManualFrameDriver() }),
    (error: unknown) =>
      error instanceof SnapshotDomainError && error.path === 'invalid' && error.scene === 'play',
  );
});
