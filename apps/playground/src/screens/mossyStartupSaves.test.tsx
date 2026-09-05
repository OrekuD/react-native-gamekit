/**
 * T20G-R2 — content-side saves must never overwrite the hydrated durable
 * projection. The shell's async factory seeds the session (and publishes the
 * slot's `startupSave` metadata) from the validated record BEFORE the ready
 * slot mounts content; these mounted tests prove a gameplay event that fires
 * BEFORE the content-side load resolves persists from the hydrated baseline,
 * and that the late load can never regress it.
 *
 * Mounted through the real content components; React Native, safe area,
 * GameKit React controls, audio, and haptics are mocked as inert hosts.
 * The storage module is wrapped (not replaced): the real store contract —
 * validation, envelope serialization, queueing — is exercised, with the
 * adapter's reads gated so the test controls when the content-side load
 * resolves relative to the gameplay events.
 */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

import type * as RealStorage from 'rn-gamekit/storage';

// The Mossy content modules use Metro's static require convention for image
// and audio handles. Under the tsx CJS loader a bare require resolves asset
// bytes as JS, so register inert handlers for the binary extensions before
// any content module loads.
for (const extension of ['.png', '.wav'] as const) {
  (Module as unknown as {
    _extensions: Record<string, (module: { exports: unknown }, filename: string) => void>;
  })._extensions[extension] = (module) => {
    module.exports = 42;
  };
}

function host(tag: string) {
  const C = ({ children, ...props }: Record<string, unknown>): unknown =>
    createElement(tag, props as never, children as never);
  (C as { displayName?: string }).displayName = tag;
  return C;
}

const audioStub = {
  dispose: () => {},
  pause: () => {},
  play: () => Promise.resolve(),
  playMusic: () => Promise.resolve(),
  resume: () => {},
  setMuted: () => {},
  setVolume: () => {},
};
const hapticsStub = {
  dispose: () => {},
  play: () => {},
  setMuted: () => {},
  setPaused: () => {},
};

// Controllable storage: reads block on `readGate`; writes are captured.
// Note the real store queues per-slot operations, so a save fired while the
// load is gated lands only after the gate releases — exactly the production
// ordering the review contract describes.
let readGate: Promise<void> | null = null;
const writes = new Map<string, string>();
const writeLog: { readonly key: string; readonly value: string }[] = [];
const controllableAdapter = {
  read: async (key: string): Promise<string | undefined> => {
    readCount += 1;
    if (readGate !== null) await readGate;
    return writes.get(key);
  },
  write: async (key: string, value: string): Promise<void> => {
    writes.set(key, value);
    writeLog.push({ key, value });
  },
  remove: async (key: string): Promise<void> => {
    writes.delete(key);
  },
};

let storeCreations = 0;
let readCount = 0;
let realStorage: typeof RealStorage;
let MossyCavernContent: (typeof import('./mossy-cavern/MossyCavernContent'))['default'];
let MossyCavern2Content: (typeof import('./mossy-cavern-2/MossyCavern2Content'))['default'];
let MossyCavern3Content: (typeof import('./mossy-cavern-3/MossyCavern3Content'))['default'];
let crystalId: string;
let checkpointId: string;
let secondCheckpointId: string;

before(async () => {
  mock.module('react-native', {
    namedExports: {
      View: host('view'),
      Text: host('text'),
      Pressable: host('pressable'),
      Image: host('image'),
      ActivityIndicator: host('activity-indicator'),
      StyleSheet: {
        create: (styles: Record<string, unknown>) => styles,
        absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
        flatten: (style: unknown) => style,
      },
    },
  });
  mock.module('react-native-safe-area-context', {
    namedExports: {
      useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
      SafeAreaProvider: host('safe-area-provider'),
      SafeAreaView: host('safe-area-view'),
    },
  });
  mock.module('rn-gamekit/react', {
    namedExports: {
      GameButton: host('game-button'),
      GameButtonPad: host('game-button-pad'),
      GameView: host('game-view'),
      GamePointerInput: host('pointer-input'),
      useGameAssets: () => ({ status: 'ready', assets: {} }),
      useGameLifecycleSource: () => undefined,
    },
  });
  mock.module('rn-gamekit/audio', {
    namedExports: { createGameAudio: async () => audioStub },
  });
  mock.module('rn-gamekit/haptics', {
    namedExports: { createGameHaptics: () => hapticsStub },
  });

  realStorage = await import('rn-gamekit/storage');
  mock.module('rn-gamekit/storage', {
    namedExports: {
      ...realStorage,
      createGameSaveStore: (options: Parameters<typeof realStorage.createGameSaveStore>[0]) => {
        storeCreations += 1;
        return realStorage.createGameSaveStore({ ...options, adapter: controllableAdapter });
      },
      createGameStorageAdapter: () => controllableAdapter,
      createMemoryStorageAdapter: () => controllableAdapter,
    },
  });

  MossyCavernContent = (await import('./mossy-cavern/MossyCavernContent.tsx')).default;
  MossyCavern2Content = (await import('./mossy-cavern-2/MossyCavern2Content.tsx')).default;
  MossyCavern3Content = (await import('./mossy-cavern-3/MossyCavern3Content.tsx')).default;
  // Saves carry AUTHORED crystal ids only (the schema normalizes unknown ids
  // away), so the fixtures use a real level id.
  const level = (await import('./mossy-cavern-3/mossyCavern3Level.ts')).MOSSY_CAVERN_3_LEVEL;
  crystalId = level.crystals[0]!.id;
  checkpointId = level.checkpoints[0]!.id;
  secondCheckpointId = level.checkpoints[1]!.id;
});

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Seed an existing stored record for one Mossy namespace by writing a real
 * envelope through a real store (the same serialization the loaders see).
 */
async function seedStoredRecord(namespace: string, slot: string, payload: unknown): Promise<void> {
  const schemaId = { 'mossy-cavern': 'com.oreku.mossy-cavern.save', 'playground': 'mossy-cavern-2-profile', 'mossy-cavern-3': 'mossy-cavern-3.progress' }[namespace]!;
  const envelope = {
    format: 'rn-gamekit.save',
    schemaId,
    schemaVersion: namespace === 'mossy-cavern-3' ? 2 : 1,
    savedAtMs: 1_700_000_000_000,
    payload,
  };
  writes.set(`rn-gamekit.storage.${namespace}.${slot}`, JSON.stringify(envelope));
}

function payloadsFor(fragment: string): Record<string, unknown>[] {
  return writeLog
    .filter((entry) => entry.key.includes(fragment))
    .map((entry) => (JSON.parse(entry.value) as { payload?: Record<string, unknown> }).payload ?? {});
}
function lastPayload(fragment: string): Record<string, unknown> | undefined {
  const payloads = payloadsFor(fragment);
  return payloads[payloads.length - 1];
}

function stubSession(frame: { current: Record<string, unknown> }): {
  readonly session: never;
  readonly frame: { current: Record<string, unknown> };
  readonly fire: (name: string, payload: Record<string, unknown>) => void;
} {
  const listeners = new Map<string, ((event: { readonly payload: unknown }) => void)[]>();
  const statusListeners: ((status: string) => void)[] = [];
  const commitListeners: (() => void)[] = [];
  const session = {
    status: 'running',
    getRenderFrame: () => ({ scene: 'play', current: frame.current, tick: 0 }),
    restartScene: () => {},
    pause: () => {},
    start: () => {},
    addGameEventListener: (name: string, callback: (event: { readonly payload: unknown }) => void) => {
      const existing = listeners.get(name) ?? [];
      existing.push(callback);
      listeners.set(name, existing);
      return { remove: () => {} };
    },
    addStatusListener: (callback: (status: string) => void) => {
      statusListeners.push(callback);
      return { remove: () => {} };
    },
    addCommitListener: (callback: () => void) => {
      commitListeners.push(callback);
      return { remove: () => {} };
    },
  };
  return {
    session: session as never,
    frame,
    fire: (name, payload) => {
      for (const callback of listeners.get(name) ?? []) callback({ payload });
      for (const callback of commitListeners) callback();
    },
  };
}

describe('T20G-R2 content-side saves keep the hydrated durable baseline', () => {
  it('Mossy Cavern 2: a relic event before the load resolves persists hydrated best times and counters', async () => {
    const hydrated = {
      bestTimeMs: 82_400,
      checkpointsReached: 2,
      completedRuns: 3,
      hapticsMuted: true,
      muted: true,
      relicsRecovered: 12,
    };
    const releaseGate = armGate();
    const { session, fire } = stubSession({ current: { checkpointIndex: 1, relicCount: 0, status: 'exploring' } });

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(MossyCavern2Content as never, {
          game: session,
          onExit: () => {},
          onOpenGame: () => {},
          startupSave: hydrated,
        } as never),
      );
    });

    // Gameplay persists BEFORE the content-side load resolves; the store
    // queues the save behind the gated load, exactly as in production.
    fire('relic-collected', { collected: 1, id: 'dew-relic' });
    assert.equal(payloadsFor('playground').length, 0, 'the save waits behind the gated load');

    // The late load resolves; the queued early save must carry the HYDRATED
    // baseline plus the event delta — never default-derived data.
    releaseGate();
    await settle();
    const firstSave = payloadsFor('playground')[0];
    assert.ok(firstSave !== undefined, 'the early event persisted');
    assert.equal(firstSave.relicsRecovered, 13, 'the event delta applies');
    assert.equal(firstSave.bestTimeMs, 82_400, 'hydrated best time survives');
    assert.equal(firstSave.muted, true, 'hydrated mute survives');
    assert.equal(firstSave.hapticsMuted, true, 'hydrated haptics mute survives');
    assert.equal(firstSave.checkpointsReached, 2, 'hydrated counter survives');
    assert.equal(firstSave.completedRuns, 3, 'hydrated counter survives');
    assert.equal(payloadsFor('playground').length, 1, 'no regressed rewrite after the late load');

    renderer!.unmount();
    await settle();
  });

  it('Mossy Cavern 3: a crystal event before the load resolves persists hydrated deaths, best ticks, and music preference', async () => {
    const hydrated = {
      activeCheckpointId: checkpointId,
      bestCompletionTicks: 900,
      collectedCrystalIds: [] as string[],
      deaths: 7,
      musicEnabled: false,
    };
    const releaseGate = armGate();
    const { session, fire } = stubSession({
      current: {
        activeCheckpointId: checkpointId,
        collectedCrystalIds: [crystalId],
        crystalCount: 1,
        deaths: 7,
        phase: 'playing',
      },
    });

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(MossyCavern3Content as never, {
          game: session,
          onExit: () => {},
          onOpenGame: () => {},
          startupSave: hydrated,
        } as never),
      );
    });

    fire('crystal-collected', { id: crystalId });
    releaseGate();
    await settle();
    const saves = payloadsFor('mossy-cavern-3');
    assert.equal(saves.length, 1, 'exactly one save so far');
    const firstSave = saves[0]!;
    assert.deepEqual(firstSave.collectedCrystalIds, [crystalId], 'the event delta applies');
    assert.equal(firstSave.bestCompletionTicks, 900, 'hydrated best ticks survive');
    assert.equal(firstSave.musicEnabled, false, 'hydrated music preference survives');
    assert.equal(firstSave.deaths, 7, 'hydrated death counter survives');

    // A later event still derives from the un-regressed baseline. The save
    // projects the SNAPSHOT's checkpoint (content-side contract), so the
    // id here is the snapshot's — the assertion proves the baseline survived.
    fire('checkpoint-activated', { deaths: 7, id: secondCheckpointId });
    await settle();
    const secondSave = lastPayload('mossy-cavern-3');
    assert.equal(secondSave?.bestCompletionTicks, 900, 'no regression after the late load');
    assert.equal(secondSave?.musicEnabled, false, 'no regression after the late load');
    assert.equal(secondSave?.activeCheckpointId, checkpointId, 'the save projects the snapshot');

    renderer!.unmount();
    await settle();
  });

  it('Mossy Cavern 1 recovery path: a pre-load checkpoint merges into the seeded record (T20G-RR2)', async () => {
    const releaseGate = armGate();
    await seedStoredRecord('mossy-cavern', 'profile', {
      checkpointIndex: 2,
      score: 1_240,
      crystals: 5,
      falls: 3,
      bestTimeSeconds: 412,
    });
    const { session, fire } = stubSession({
      current: {
        checkpointIndex: 0,
        checkpoints: [],
        crystals: 0,
        elapsed: 0,
        falls: 0,
        health: 3,
        score: 0,
        bestTimeSeconds: 0,
      },
    });

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(MossyCavernContent as never, {
          game: session,
          onExit: () => {},
          onOpenGame: () => {},
          // no startupSave: recovery path
        } as never),
      );
    });

    // A checkpoint save pre-load: this-run projection (fresh session).
    fire('checkpoint', {
      save: { checkpointIndex: 0, score: 100, crystals: 1, falls: 0, bestTimeSeconds: 0 },
    });
    releaseGate();
    await settle();

    const saved = lastPayload('mossy-cavern');
    assert.ok(saved !== undefined, 'the buffered save persisted');
    assert.equal(saved.bestTimeSeconds, 412, 'the stored all-time best survives');
    assert.equal(saved.checkpointIndex, 0, 'this-run checkpoint applies');
    assert.equal(saved.score, 100, 'this-run score applies');
    renderer!.unmount();
    await settle();
  });

  it('Mossy Cavern 2 recovery path: a pre-load relic merges into the seeded profile (T20G-RR2)', async () => {
    const releaseGate = armGate();
    await seedStoredRecord('playground', 'profile', {
      bestTimeMs: 82_400,
      checkpointsReached: 2,
      completedRuns: 3,
      hapticsMuted: false,
      muted: false,
      relicsRecovered: 12,
    });
    const { session, fire } = stubSession({ current: { checkpointIndex: 0, relicCount: 0, status: 'exploring' } });

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(MossyCavern2Content as never, {
          game: session,
          onExit: () => {},
          onOpenGame: () => {},
          // no startupSave: recovery path
        } as never),
      );
    });

    fire('relic-collected', { collected: 1, id: 'dew-relic' });
    releaseGate();
    await settle();

    const saved = lastPayload('playground');
    assert.ok(saved !== undefined, 'the buffered save persisted');
    assert.equal(saved.relicsRecovered, 13, 'the event delta applies to the loaded baseline');
    assert.equal(saved.bestTimeMs, 82_400, 'stored best time survives');
    assert.equal(saved.checkpointsReached, 2, 'stored counter survives');
    assert.equal(saved.completedRuns, 3, 'stored counter survives');
    renderer!.unmount();
    await settle();
  });

  it('Mossy Cavern 3 recovery path: pre-load events merge into the seeded chronicle (T20G-RR2)', async () => {
    const releaseGate = armGate();
    const storedCrystal = (await import('./mossy-cavern-3/mossyCavern3Level.ts')).MOSSY_CAVERN_3_LEVEL.crystals[1]!.id;
    await seedStoredRecord('mossy-cavern-3', 'progress', {
      activeCheckpointId: checkpointId,
      bestCompletionTicks: 900,
      collectedCrystalIds: [storedCrystal],
      deaths: 7,
      musicEnabled: false,
    });
    const { session, frame, fire } = stubSession({
      current: {
        activeCheckpointId: null,
        collectedCrystalIds: [crystalId],
        crystalCount: 1,
        deaths: 0,
        phase: 'playing',
      },
    });

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(MossyCavern3Content as never, {
          game: session,
          onExit: () => {},
          onOpenGame: () => {},
          // no startupSave: recovery path
        } as never),
      );
    });

    fire('crystal-collected', { id: crystalId });
    frame.current = { ...frame.current, elapsedTicks: 500, phase: 'won' };
    fire('level-completed', { ticks: 500 });
    releaseGate();
    await settle();

    const saved = lastPayload('mossy-cavern-3');
    assert.ok(saved !== undefined, 'the buffered save persisted');
    assert.equal(saved.bestCompletionTicks, 500, 'min-merge picks the faster completion');
    assert.equal(saved.musicEnabled, false, 'stored music preference survives');
    assert.equal(saved.deaths, 7, 'stored cumulative deaths survive the fresh session');
    const collected = saved.collectedCrystalIds as string[];
    assert.deepEqual([...collected].sort(), [...new Set([storedCrystal, crystalId])].sort(), 'collections union');
    renderer!.unmount();
    await settle();
  });

  it('hydrated projection is a stable effect dependency: rerenders recreate no store and detach no listeners (T20G-RR3)', async () => {
    const hydrated = {
      bestTimeMs: 82_400,
      checkpointsReached: 2,
      completedRuns: 3,
      hapticsMuted: true,
      muted: true,
      relicsRecovered: 12,
    };
    const { session, fire, detachCount } = stubSessionWithDetachCounting();
    const hydratedStartup = { ...hydrated };

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(MossyCavern2Content as never, {
          game: session,
          onExit: () => {},
          onOpenGame: () => {},
          startupSave: hydratedStartup,
        } as never),
      );
    });
    fire('relic-collected', { collected: 1, id: 'dew-relic' });
    await settle();
    const storesAfterMount = storeCreations;
    const readsAfterMount = readCount;

    // Unrelated rerenders: new prop identities for callbacks, same slot data.
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        renderer!.update(
          createElement(MossyCavern2Content as never, {
            game: session,
            onExit: () => {},
            onOpenGame: () => {},
            startupSave: hydratedStartup,
          } as never),
        );
      });
    }
    fire('checkpoint', { index: 1 });
    await settle();

    assert.equal(storeCreations, storesAfterMount, 'rerenders recreate no store');
    assert.equal(readCount, readsAfterMount, 'rerenders re-read no journal');
    assert.equal(detachCount(), 0, 'no listener detaches while mounted');
    const finalPayload = lastPayload('playground');
    assert.equal(finalPayload?.checkpointsReached, 2, 'post-load events still persist correctly');
    renderer!.unmount();
    await settle();
    assert.ok(detachCount() > 0, 'unmount detaches the listeners exactly once per effect');
  });
});

/** Stub session whose listener subscriptions record detach counts (RR3). */
function stubSessionWithDetachCounting(): {
  readonly session: never;
  readonly fire: (name: string, payload: Record<string, unknown>) => void;
  readonly detachCount: () => number;
} {
  let detaches = 0;
  const listeners = new Map<string, ((event: { readonly payload: unknown }) => void)[]>();
  const commitListeners: (() => void)[] = [];
  const session = {
    status: 'running',
    getRenderFrame: () => ({ scene: 'play', current: { checkpointIndex: 1, relicCount: 0, status: 'exploring' }, tick: 0 }),
    restartScene: () => {},
    pause: () => {},
    start: () => {},
    addGameEventListener: (name: string, callback: (event: { readonly payload: unknown }) => void) => {
      const existing = listeners.get(name) ?? [];
      existing.push(callback);
      listeners.set(name, existing);
      return { remove: () => {
        detaches += 1;
      } };
    },
    addStatusListener: () => ({ remove: () => {
      detaches += 1;
    } }),
    addCommitListener: (callback: () => void) => {
      commitListeners.push(callback);
      return { remove: () => {
        detaches += 1;
      } };
    },
  };
  return {
    session: session as never,
    fire: (name, payload) => {
      for (const callback of listeners.get(name) ?? []) callback({ payload });
      for (const callback of commitListeners) callback();
    },
    detachCount: () => detaches,
  };
}

/**
 * Arm the read gate: the next adapter read blocks until `releaseGate()`.
 * Tests call this BEFORE mounting so the content-side load is guaranteed to
 * still be pending when the gameplay event fires.
 */
function armGate(): () => void {
  writes.clear();
  writeLog.length = 0;
  let release: () => void;
  readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    readGate = null;
    release();
  };
}
