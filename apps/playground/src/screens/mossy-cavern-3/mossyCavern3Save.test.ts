import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameSaveStore, createMemoryStorageAdapter } from 'rn-gamekit/storage';

import { MOSSY_CAVERN_3_LEVEL } from './mossyCavern3Level.ts';
import {
  createDefaultMossyCavern3Save,
  mossyCavern3SaveSchema,
  normalizeMossyCavern3Save,
} from './mossyCavern3Save.ts';

test('missing slot loads a safe default', async () => {
  const store = createGameSaveStore({
    adapter: createMemoryStorageAdapter(),
    namespace: 'mossy-cavern-3-test',
    schema: mossyCavern3SaveSchema,
  });

  const loaded = await store.load('progress');

  assert.deepEqual(loaded.data, createDefaultMossyCavern3Save());
  store.dispose();
});

test('save round trip preserves only durable progress', async () => {
  const store = createGameSaveStore({
    adapter: createMemoryStorageAdapter(),
    namespace: 'mossy-cavern-3-test',
    schema: mossyCavern3SaveSchema,
  });
  const crystal = MOSSY_CAVERN_3_LEVEL.crystals[0]!;
  const checkpoint = MOSSY_CAVERN_3_LEVEL.checkpoints[0]!;
  const save = {
    activeCheckpointId: checkpoint.id,
    bestCompletionTicks: 812,
    collectedCrystalIds: [crystal.id],
    deaths: 3,
    musicEnabled: false,
  } as const;

  await store.save('progress', save);
  const loaded = await store.load('progress');

  assert.deepEqual(loaded.data, save);
  store.dispose();
});

test('normalizer drops stale ids, duplicates, and malformed scalar values', () => {
  const crystal = MOSSY_CAVERN_3_LEVEL.crystals[0]!;
  const normalized = normalizeMossyCavern3Save({
    activeCheckpointId: 'removed-checkpoint',
    bestCompletionTicks: Number.NaN,
    collectedCrystalIds: ['removed-crystal', crystal.id, crystal.id],
    deaths: -20,
    musicEnabled: 'yes',
  });

  assert.deepEqual(normalized, {
    activeCheckpointId: null,
    bestCompletionTicks: null,
    collectedCrystalIds: [crystal.id],
    deaths: 0,
    musicEnabled: true,
  });
});
