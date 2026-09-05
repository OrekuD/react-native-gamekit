/**
 * GS-SCENE-02 — initial snapshot failure composes losslessly with cleanup.
 *
 * When the initial snapshot throws and the initial disposer also throws,
 * both values must be recoverable from the final error in a stable order
 * (snapshot first, cleanup second), arbitrary thrown values (including
 * `undefined`) must survive, and disposal still runs exactly once.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

function failingInitGame(options: {
  readonly snapshotError: unknown;
  readonly disposeError: unknown;
  readonly disposeCount: { value: number };
}) {
  const scene = defineScene({
    actions: [],
    create: () => ({ count: 0 }),
    update: ({ state }: { state: { readonly count: number } }) => state,
    snapshot: () => {
      throw options.snapshotError;
    },
    dispose: () => {
      options.disposeCount.value += 1;
      throw options.disposeError;
    },
  });
  return defineGame({
    viewport,
    input: {},
    scenes: { main: scene },
    initialScene: 'main',
  });
}

function construct(options: {
  readonly snapshotError: unknown;
  readonly disposeError: unknown;
}): { readonly thrown: unknown; readonly disposeCount: number } {
  const disposeCount = { value: 0 };
  let thrown: unknown;
  try {
    createGameSessionWithDriver(
      failingInitGame({ ...options, disposeCount }),
      { frameDriver: new ManualFrameDriver(), fixedStepMs: 10 },
    );
  } catch (error) {
    thrown = error;
  }
  return { thrown, disposeCount: disposeCount.value };
}

describe('GS-SCENE-02 initialization failure composition', () => {
  it('snapshot and cleanup failures compose in a stable order', () => {
    const snapshotError = new Error('snapshot exploded');
    const disposeError = new Error('dispose exploded');
    const { thrown, disposeCount } = construct({ snapshotError, disposeError });
    assert.ok(thrown instanceof AggregateError, 'both failures are reported');
    assert.deepEqual(
      (thrown as AggregateError).errors,
      [snapshotError, disposeError],
      'snapshot first, cleanup second',
    );
    assert.equal(disposeCount, 1, 'cleanup runs exactly once');
  });

  it('arbitrary thrown values including undefined survive composition', () => {
    const { thrown, disposeCount } = construct({ snapshotError: undefined, disposeError: 42 });
    assert.ok(thrown instanceof AggregateError, 'both failures are reported');
    assert.deepEqual((thrown as AggregateError).errors, [undefined, 42]);
    assert.equal(disposeCount, 1);
  });

  it('a clean cleanup still rethrows the snapshot failure alone', () => {
    const snapshotError = new Error('snapshot exploded');
    const scene = defineScene({
      actions: [],
      create: () => ({ count: 0 }),
      update: ({ state }: { state: { readonly count: number } }) => state,
      snapshot: () => {
        throw snapshotError;
      },
    });
    const game = defineGame({ viewport, input: {}, scenes: { main: scene }, initialScene: 'main' });
    assert.throws(
      () =>
        createGameSessionWithDriver(game, {
          frameDriver: new ManualFrameDriver(),
          fixedStepMs: 10,
        }),
      (error: unknown) => error === snapshotError,
    );
  });
});
