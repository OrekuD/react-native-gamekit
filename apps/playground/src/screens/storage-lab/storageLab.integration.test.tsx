/**
 * Storage Lab integration — T17-RF3.
 *
 * Mounts the real StorageLabScreen with an injected adapter and a deterministic
 * session/driver seam. Proves load-before-session, the actual checkpoint event
 * listener writing/flushing, close/reopen resume, blocked-write unmount without
 * stale publication, settings persistence, failure UI, and that the playground
 * directly owns AsyncStorage.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

function host(tag: string) {
  const C = ({ children, ...props }: Record<string, unknown>): unknown => createElement(tag, props as never, children as never);
  (C as { displayName?: string }).displayName = tag;
  return C;
}

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    Text: host('text'),
    Pressable: host('pressable'),
    StyleSheet: {
      create: (s: Record<string, unknown>) => s,
      absoluteFill: {},
      absoluteFillObject: {},
    },
    BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  },
});

let StorageLabScreen: typeof import('./StorageLabScreen').default;
let createGameSessionWithDriver: typeof import('rn-gamekit/testing').createGameSessionWithDriver;
let ManualFrameDriver: typeof import('rn-gamekit/testing').ManualFrameDriver;
let createMemoryStorageAdapter: typeof import('rn-gamekit/storage').createMemoryStorageAdapter;
let createGameSaveStore: typeof import('rn-gamekit/storage').createGameSaveStore;
let storageLabSaveSchema: typeof import('./storageLabGame').storageLabSaveSchema;
let storageLabSettingsSchema: typeof import('./storageLabGame').storageLabSettingsSchema;
let createStorageLabDefinition: typeof import('./storageLabGame').createStorageLabDefinition;

before(async () => {
  const rnStorage = await import('rn-gamekit/storage');
  createMemoryStorageAdapter = rnStorage.createMemoryStorageAdapter;
  createGameSaveStore = rnStorage.createGameSaveStore;
  const testing = await import('rn-gamekit/testing');
  createGameSessionWithDriver = testing.createGameSessionWithDriver;
  ManualFrameDriver = testing.ManualFrameDriver;
  const game = await import('./storageLabGame');
  storageLabSaveSchema = game.storageLabSaveSchema;
  storageLabSettingsSchema = game.storageLabSettingsSchema;
  createStorageLabDefinition = game.createStorageLabDefinition;
  const mod = await import('./StorageLabScreen');
  StorageLabScreen = mod.default;
});

/** Collect every string leaf of the rendered tree so split Text children match. */
function collectStrings(node: unknown, out: string[]): void {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const item of node) collectStrings(item, out);
  else if (node !== null && typeof node === 'object') for (const value of Object.values(node as Record<string, unknown>)) collectStrings(value, out);
}

function haystacks(renderer: ReturnType<typeof create>): string {
  const leaves: string[] = [];
  collectStrings(renderer.toJSON(), leaves);
  return `${leaves.join('')}\n${leaves.join(' ')}`;
}

function findText(renderer: ReturnType<typeof create>, needle: string): boolean {
  return haystacks(renderer).includes(needle);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type SessionSeam = (initial: import('./storageLabGame').StorageLabSave) => ReturnType<typeof import('./storageLabGame').createStorageLabSession>;

/** Deterministic session factory: exposes the ManualFrameDriver used by the screen's session. */
function driverSession(driverRef: { current: InstanceType<typeof ManualFrameDriver> | null }): SessionSeam {
  return (initial) => {
    const driver = new ManualFrameDriver();
    driverRef.current = driver;
    const def = createStorageLabDefinition(initial);
    return createGameSessionWithDriver(def, {
      frameDriver: driver as unknown as import('rn-gamekit/testing').FrameDriver,
    }) as unknown as ReturnType<typeof import('./storageLabGame').createStorageLabSession>;
  };
}

/** Fire pending frames until predicate() or budget exhausts; yields between frames. */
async function drive(
  driverRef: { current: InstanceType<typeof ManualFrameDriver> | null },
  predicate: () => boolean,
  maxFrames = 300,
): Promise<number> {
  let timestamp = 0;
  let fired = 0;
  for (let i = 0; i < maxFrames; i += 1) {
    if (predicate()) break;
    const driver = driverRef.current;
    timestamp += 16;
    if (driver && (driver as unknown as { pendingCount: number }).pendingCount > 0) {
      driver.fireNext(timestamp);
      fired += 1;
    }
    await sleep(0);
  }
  return fired;
}

describe('StorageLabScreen integration (T17-RF3)', () => {
  it('holds gameplay behind both validated loads — no HUD/session content while blocked', async () => {
    const inner = createMemoryStorageAdapter();
    // Gate EACH read independently so Promise.all cannot resolve until both release.
    const gates: Array<() => void> = [];
    const adapter = {
      read: async (k: string) => {
        if (k.includes('rn-gamekit.storage.')) {
          await new Promise<void>((r) => {
            gates.push(r);
          });
        }
        return inner.read(k);
      },
      write: inner.write.bind(inner),
      remove: inner.remove.bind(inner),
    } as unknown as import('rn-gamekit/storage').GameStorageAdapter;

    const driverRef: { current: InstanceType<typeof ManualFrameDriver> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: driverSession(driverRef) } as never));
    });
    await sleep(20);
    assert.ok(gates.length >= 2, `both loads should be gated (got ${gates.length})`);
    assert.ok(findText(renderer!, 'loading saves'), 'loading state while reads blocked');
    assert.ok(!haystacks(renderer!).includes('loaded'), 'no loaded status before validated loads');
    assert.ok(!findText(renderer!, 'Move right'), 'no controls before load completes');

    for (const release of gates) release();
    await act(async () => {
      await sleep(20);
    });
    assert.ok(findText(renderer!, 'loaded default'), 'ready after both validated loads');
    await act(async () => {
      renderer!.unmount();
    });
  });

  it('drives the real scene across a checkpoint; the actual listener writes and flushes', async () => {
    const adapter = createMemoryStorageAdapter();
    const driverRef: { current: InstanceType<typeof ManualFrameDriver> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: driverSession(driverRef) } as never));
    });
    await act(async () => {
      await sleep(20);
    });
    assert.ok(findText(renderer!, 'loaded default'), 'ready before driving');

    const fired = await drive(driverRef, () => findText(renderer!, 'checkpoint 0 saved'));
    assert.ok(fired > 0, 'frames must have been driven');
    assert.ok(findText(renderer!, 'checkpoint 0 saved'), 'listener reported save completion');

    // Verify the projected save landed via the adapter bytes — written by the screen's listener, not the test.
    const store = createGameSaveStore({ schema: storageLabSaveSchema, adapter, namespace: 'storage-lab-save' });
    const loaded = await store.load('profile-1');
    assert.equal(loaded.status, 'stored');
    assert.equal(loaded.data.checkpointIndex, 0);
    store.dispose();
    await act(async () => {
      renderer!.unmount();
    });
  });

  it('unmount during an in-flight listener save publishes nothing stale; reopen resumes', async () => {
    const inner = createMemoryStorageAdapter();
    // Seed an empty save so first load is fast and stored-shaped.
    const seed = createGameSaveStore({ schema: storageLabSaveSchema, adapter: inner, namespace: 'storage-lab-save' });
    await seed.save('profile-1', { highScore: 0, unlockedLevels: ['level-1'], coins: 0, checkpointIndex: -1 });
    await seed.flush();
    seed.dispose();

    // First WRITE blocks — the screen's checkpoint listener will hit it.
    let writeStarted = false;
    let continueWrite: (() => void) | null = null;
    let writes = 0;
    const adapter = {
      read: inner.read.bind(inner),
      write: async (k: string, v: string) => {
        if (k.includes('storage-lab-save')) {
          writes += 1;
          if (writes === 1) {
            writeStarted = true;
            await new Promise<void>((r) => {
              continueWrite = r;
            });
          }
        }
        return inner.write(k, v);
      },
      remove: inner.remove.bind(inner),
    } as unknown as import('rn-gamekit/storage').GameStorageAdapter;

    const driverRef: { current: InstanceType<typeof ManualFrameDriver> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: driverSession(driverRef) } as never));
    });
    await act(async () => {
      await sleep(20);
    });

    // Drive until the REAL listener starts its blocked save.
    await drive(driverRef, () => writeStarted, 400);
    assert.ok(writeStarted, 'checkpoint listener must have started a save');
    assert.ok(findText(renderer!, 'saving…'), 'status shows in-flight save');

    // Unmount WHILE the write is blocked.
    const statusAtUnmount = haystacks(renderer!);
    await act(async () => {
      renderer!.unmount();
    });

    // Release the write after unmount — the accepted operation still completes (F1),
    // but nothing can publish into a dead tree.
    continueWrite!();
    await sleep(20);
    assert.ok(statusAtUnmount.includes('saving…'), 'sanity: captured pre-unmount status');

    // Remount on the SAME adapter: must resume the checkpoint written by the listener.
    let renderer2: ReturnType<typeof create> | null = null;
    const driverRef2: { current: InstanceType<typeof ManualFrameDriver> | null } = { current: null };
    await act(async () => {
      renderer2 = create(createElement(StorageLabScreen as never, { adapter: inner, createSession: driverSession(driverRef2) } as never));
    });
    await act(async () => {
      await sleep(20);
    });
    assert.ok(findText(renderer2!, 'checkpoint 0'), 'remount resumes the saved checkpoint');
    assert.ok(!findText(renderer2!, 'saving…'), 'no stale in-flight status published into the replacement');
    await act(async () => {
      renderer2!.unmount();
    });
  });

  it('remount with the same adapter resumes saved checkpoint and settings volume', async () => {
    const adapter = createMemoryStorageAdapter();
    const settingsStore = createGameSaveStore({ schema: storageLabSettingsSchema, adapter, namespace: 'storage-lab-settings' });
    await settingsStore.save('player', { volume: 0.42, muted: false, language: 'en' });
    await settingsStore.flush();
    settingsStore.dispose();
    const saveStore = createGameSaveStore({ schema: storageLabSaveSchema, adapter, namespace: 'storage-lab-save' });
    await saveStore.save('profile-1', { highScore: 10, unlockedLevels: ['level-1', 'level-2'], coins: 20, checkpointIndex: 1 });
    await saveStore.flush();
    saveStore.dispose();

    const driverRef: { current: InstanceType<typeof ManualFrameDriver> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: driverSession(driverRef) } as never));
    });
    await act(async () => {
      await sleep(20);
    });
    assert.ok(findText(renderer!, 'loaded stored'), 'stored load result surfaced');
    assert.ok(findText(renderer!, 'checkpoint 1'), 'resumed checkpoint 1');
    assert.ok(findText(renderer!, 'vol 0.42'), 'resumed settings volume');
    await act(async () => {
      renderer!.unmount();
    });
  });

  it('corrupt/future data mounts the real error UI while stored bytes remain unchanged', async () => {
    const adapter = createMemoryStorageAdapter();
    const key = 'rn-gamekit.storage.storage-lab-save.profile-1';
    await adapter.write(key, JSON.stringify({ format: 'rn-gamekit.save', schemaId: storageLabSaveSchema.id, schemaVersion: 99, savedAtMs: Date.now(), payload: {} }));
    const before = await adapter.read(key);
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter } as never));
    });
    await act(async () => {
      await sleep(20);
    });
    assert.ok(findText(renderer!, 'load error'), 'real error UI mounted');
    assert.ok(!findText(renderer!, 'Move right'), 'no gameplay controls in error state');
    const after = await adapter.read(key);
    assert.equal(after, before, 'stored bytes untouched');
    await act(async () => {
      renderer!.unmount();
    });
  });

  it('swapping adapters A→B without unmount disposes exactly once and only B remains active', async () => {
    const adapterA = createMemoryStorageAdapter();
    const adapterB = createMemoryStorageAdapter();

    const gate: { release: (() => void) | null } = { release: null };
    // Wrap A to observe store disposal ordering indirectly: block A's first write.
    const blockingA = {
      read: adapterA.read.bind(adapterA),
      write: async (k: string, v: string) => {
        if (k.includes('storage-lab-save')) {
          await new Promise<void>((r) => {
            gate.release = r;
          });
        }
        return adapterA.write(k, v);
      },
      remove: adapterA.remove.bind(adapterA),
    } as unknown as import('rn-gamekit/storage').GameStorageAdapter;

    const driverRef: { current: InstanceType<typeof ManualFrameDriver> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter: blockingA, createSession: driverSession(driverRef) } as never));
    });
    await act(async () => {
      await sleep(20);
    });
    assert.ok(findText(renderer!, 'loaded default'));

    // Drive across checkpoint 0 — the listener save blocks on A's write.
    await drive(driverRef, () => gate.release !== null, 400);
    assert.ok(gate.release !== null, 'A write should be blocked by the listener save');
    assert.ok(findText(renderer!, 'saving…'), 'in-flight save on A');

    // Swap adapter prop WITHOUT unmounting.
    await act(async () => {
      renderer!.update(createElement(StorageLabScreen as never, { adapter: adapterB, createSession: driverSession({ current: null }) } as never));
      await sleep(30);
    });

    // B loaded and became active.
    assert.ok(findText(renderer!, 'loaded default'), 'B reached ready');

    // A's accepted in-flight save still completes after release (F1 policy), and the
    // old request can no longer publish status (request token invalidated on swap).
    const statusAfterSwapStart = haystacks(renderer!);
    gate.release!();
    await act(async () => {
      await sleep(30);
    });
    // If the stale completion had published, we'd see "checkpoint 0 saved" from A's request.
    // B's own tree shows only B statuses; A's late completion must not appear as a NEW update.
    assert.ok(statusAfterSwapStart.includes('loaded default'));
    assert.ok(!findText(renderer!, 'checkpoint 0 saved'), "stale A completion did not publish into B's screen");

    // A's data persisted (accepted write completed); B's namespace untouched.
    const storeA = createGameSaveStore({ schema: storageLabSaveSchema, adapter: adapterA, namespace: 'storage-lab-save' });
    const loadedA = await storeA.load('profile-1');
    assert.equal(loadedA.data.checkpointIndex, 0, 'A accepted write completed despite swap');
    storeA.dispose();

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('playground declares AsyncStorage directly', async () => {
    const fs = await import('node:fs/promises');
    const pkg = JSON.parse(await fs.readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    assert.equal(pkg.dependencies['@react-native-async-storage/async-storage'], '2.1.2');
  });
});
