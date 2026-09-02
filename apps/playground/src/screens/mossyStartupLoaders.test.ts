/**
 * T20G-R3 — the one-shot hydration loaders must dispose the store they
 * create, and must never construct one for an already-aborted prepare
 * signal. Every shell retry/open allocates a fresh short-lived store; the
 * loaders model the same lifecycle discipline content components use.
 *
 * The storage module is wrapped (not replaced) so the real store contract
 * — envelope serialization, validation, and the public `disposed` flag —
 * is exercised; the test only instruments creation and disposal counts.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';

import type * as RealStorage from 'rn-gamekit/storage';

// The Mossy data modules use Metro's static require convention for image
// handles; node tests stub it so the modules import headlessly.
(globalThis as { require?: (id: string) => number }).require = () => 42;

const controllableAdapter = {
  read: async (key: string): Promise<string | undefined> => {
    if (failReads) throw new Error('storage read failed');
    return storage.get(key);
  },
  write: async (key: string, value: string): Promise<void> => {
    storage.set(key, value);
  },
  remove: async (key: string): Promise<void> => {
    storage.delete(key);
  },
};

let failReads = false;
const storage = new Map<string, string>();
const created: { readonly disposed: boolean }[] = [];

let loadMossyCavernSave: typeof import('./mossy-cavern/mossyCavernData.ts')['loadMossyCavernSave'];
let loadMossyCavern2Profile: typeof import('./mossy-cavern-2/mossyCavern2Save.ts')['loadMossyCavern2Profile'];
let loadMossyCavern3Save: typeof import('./mossy-cavern-3/mossyCavern3Save.ts')['loadMossyCavern3Save'];
let mossyCavernSaveSchema: NonNullable<Parameters<typeof realStorage.createGameSaveStore>[0]['schema']>;
let mossyCavern2ProfileSchema: NonNullable<Parameters<typeof realStorage.createGameSaveStore>[0]['schema']>;
let mossyCavern3SaveSchema: NonNullable<Parameters<typeof realStorage.createGameSaveStore>[0]['schema']>;
let realStorage: typeof RealStorage;

async function seedStoredSave(
  namespace: string,
  slot: string,
  schema: Parameters<typeof realStorage.createGameSaveStore>[0]['schema'],
  data: unknown,
): Promise<void> {
  const seed = realStorage.createGameSaveStore({ adapter: controllableAdapter, namespace, schema });
  try {
    await seed.save(slot, data);
    await seed.flush();
  } finally {
    seed.dispose();
  }
}

describe('T20G-R3 one-shot hydration loader store lifecycle', () => {
  before(async () => {
    // Instrument (never replace) the real storage module: creation is
    // counted, disposal is observed through the store's public `disposed`
    // flag, and the adapter is controllable for failure/seed scenarios.
    realStorage = await import('rn-gamekit/storage');
    mock.module('rn-gamekit/storage', {
      namedExports: {
        ...realStorage,
        createGameSaveStore: (
          options: Parameters<typeof realStorage.createGameSaveStore>[0],
        ) => {
          const store = realStorage.createGameSaveStore({ ...options, adapter: controllableAdapter });
          created.push(store);
          return store;
        },
        createGameStorageAdapter: () => controllableAdapter,
      },
    });
    ({
      loadMossyCavernSave,
      mossyCavernSaveSchema,
    } = await import('./mossy-cavern/mossyCavernData.ts'));
    ({ loadMossyCavern2Profile, mossyCavern2ProfileSchema } = await import(
      './mossy-cavern-2/mossyCavern2Save.ts'
    ));
    ({ loadMossyCavern3Save, mossyCavern3SaveSchema } = await import(
      './mossy-cavern-3/mossyCavern3Save.ts'
    ));
    const mossySave = {
      bestTimeSeconds: 412,
      checkpointIndex: 2,
      crystals: 5,
      falls: 3,
      score: 1_240,
    };
    await seedStoredSave('mossy-cavern', 'profile', mossyCavernSaveSchema, mossySave);
    await seedStoredSave('playground', 'profile', mossyCavern2ProfileSchema, {
      bestTimeMs: 82_400,
      checkpointsReached: 2,
      completedRuns: 3,
      hapticsMuted: true,
      muted: true,
      relicsRecovered: 12,
    });
    await seedStoredSave('mossy-cavern-3', 'progress', mossyCavern3SaveSchema, {
      activeCheckpointId: null,
      bestCompletionTicks: 900,
      collectedCrystalIds: [],
      deaths: 7,
      musicEnabled: false,
    });
  });

  it('each Mossy loader returns its stored record and disposes its store', async () => {
    const beforeCount = created.length;

    const mc1 = await loadMossyCavernSave();
    assert.ok(mc1 !== undefined, 'the seeded MC1 save loads');
    assert.equal(mc1.score, 1_240);

    const mc2 = await loadMossyCavern2Profile();
    assert.ok(mc2 !== undefined, 'the seeded MC2 profile loads');
    assert.equal(mc2.bestTimeMs, 82_400);

    const mc3 = await loadMossyCavern3Save();
    assert.ok(mc3 !== undefined, 'the seeded MC3 save loads');
    assert.equal(mc3.deaths, 7);
    assert.equal(mc3.musicEnabled, false);

    assert.equal(created.length, beforeCount + 3, 'one store per loader call');
    for (const store of created) {
      assert.equal(store.disposed, true, 'every one-shot loader store is disposed');
    }
  });

  it('a loader still disposes its store when the read fails, and fails open', async () => {
    const beforeCount = created.length;
    failReads = true;
    try {
      assert.equal(await loadMossyCavern2Profile(), undefined, 'fail-open on read failure');
    } finally {
      failReads = false;
    }
    assert.equal(created.length, beforeCount + 1);
    assert.equal(created[created.length - 1]!.disposed, true);
  });

  it('an already-aborted signal never constructs a store', async () => {
    const beforeCount = created.length;
    const controller = new AbortController();
    controller.abort();
    assert.equal(await loadMossyCavernSave(controller.signal), undefined);
    assert.equal(await loadMossyCavern2Profile(controller.signal), undefined);
    assert.equal(await loadMossyCavern3Save(controller.signal), undefined);
    assert.equal(created.length, beforeCount, 'no store allocation for a dead prepare');
  });

  it('an abort racing the load still yields undefined and one disposed store', async () => {
    const beforeCount = created.length;
    const controller = new AbortController();
    const pending = loadMossyCavernSave(controller.signal);
    controller.abort();
    assert.equal(await pending, undefined);
    assert.equal(created.length, beforeCount + 1);
    assert.equal(created[created.length - 1]!.disposed, true);
  });
});
