/**
 * Storage Lab integration — T17-RF3 + T17-SF1/SF2.
 *
 * Mounts the real StorageLabScreen with injected adapters and deterministic
 * session/driver seams. Proves load-before-session, the actual checkpoint
 * event listener writing/flushing, per-slot acceptance ordering through the
 * request-owned stores (real buttons), replacement lifecycle (blocked B
 * reads, exact-once disposal), reopen/resume, failure UI, and that the
 * playground directly owns AsyncStorage.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

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

function findPressHandler(node: any, label: string): (() => void) | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'pressable' && typeof node.props?.onPress === 'function') {
    const leaves: string[] = [];
    collectStrings(node.children ?? [], leaves);
    if (leaves.join(' ').includes(label)) return node.props.onPress as () => void;
  }
  for (const child of node.children ?? []) {
    const found = findPressHandler(child, label);
    if (found) return found;
  }
  return null;
}

/**
 * Accept a button action: invoke onPress WITHOUT awaiting the whole handler —
 * an accepted action may block indefinitely behind a gated write, and the
 * per-slot queue owns its completion. One macrotask lets acceptance settle.
 */
async function press(renderer: ReactTestRenderer, label: string): Promise<void> {
  const handler = findPressHandler(renderer.toJSON(), label);
  assert.ok(handler, `pressable "${label}" not found`);
  await act(async () => {
    void handler!();
    await sleep(1);
  });
}

/** Poll until the rendered tree contains `needle` (default readiness marker). */
async function awaitReady(renderer: ReturnType<typeof create>, needle = 'loaded', budgetMs = 3000): Promise<void> {
  for (let waited = 0; waited < budgetMs; waited += 25) {
    if (findText(renderer, needle)) return;
    await sleep(25);
  }
  assert.ok(findText(renderer, needle), `tree never showed "${needle}": ${haystacks(renderer).slice(0, 300)}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type LabSession = ReturnType<typeof import('./storageLabGame').createStorageLabSession>;
type SessionSeam = (initial: import('./storageLabGame').StorageLabSave) => LabSession;

interface SessionRecord {
  disposed: number;
  unsubscribed: number;
  raw: any;
  driverRef: { current: InstanceType<typeof ManualFrameDriver> | null };
}

function emptyRecord(): SessionRecord {
  return { disposed: 0, unsubscribed: 0, raw: null, driverRef: { current: null } };
}

/**
 * Deterministic, instrumented session factory: exposes the ManualFrameDriver
 * for frame driving and counts dispose()/subscription-removal exactly.
 */
function trackedSession(record: SessionRecord): SessionSeam {
  return (initial) => {
    const driver = new ManualFrameDriver();
    record.driverRef.current = driver;
    const raw: any = createGameSessionWithDriver(createStorageLabDefinition(initial), {
      frameDriver: driver as unknown as import('rn-gamekit/testing').FrameDriver,
    });
    record.raw = raw;
    const tracked: any = {
      get status() {
        return raw.status;
      },
      scene: raw.scene,
      viewport: raw.viewport,
      input: {
        press: (action: string) => raw.input.press(action),
        release: (action: string) => raw.input.release(action),
      },
      start: () => raw.start(),
      pause: () => raw.pause(),
      dispose: () => {
        record.disposed += 1;
        raw.dispose();
      },
      getRenderFrame: () => raw.getRenderFrame(),
      addCommitListener: (fn:never) => {
        const sub = raw.addCommitListener(fn as never);
        return { remove: () => sub.remove() };
      },
      addStatusListener: (fn: never) => {
        const sub = raw.addStatusListener(fn as never);
        return { remove: () => sub.remove() };
      },
      addGameEventListener: (name: never, fn: never) => {
        const sub = raw.addGameEventListener(name as never, fn as never);
        return {
          remove: () => {
            record.unsubscribed += 1;
            sub.remove();
          },
        };
      },
    };
    return tracked as unknown as LabSession;
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

describe('StorageLabScreen integration (T17-RF3 + SF1/SF2)', () => {
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

    const record = emptyRecord();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: trackedSession(record) } as never));
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
    const record = emptyRecord();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: trackedSession(record) } as never));
    });
    await awaitReady(renderer!, 'loaded default');

    const fired = await drive(record.driverRef, () => findText(renderer!, 'checkpoint 0 saved'));
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

    const record = emptyRecord();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: trackedSession(record) } as never));
    });
    await act(async () => {
      await sleep(20);
    });

    // Drive until the REAL listener starts its blocked save.
    await drive(record.driverRef, () => writeStarted, 400);
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
    const record2 = emptyRecord();
    await act(async () => {
      renderer2 = create(createElement(StorageLabScreen as never, { adapter: inner, createSession: trackedSession(record2) } as never));
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

  it('settings changed through the REAL button persist and remount resumes them', async () => {
    const adapter = createMemoryStorageAdapter();
    // Seed ONLY the checkpoint — settings must flow through the real button.
    const saveStore = createGameSaveStore({ schema: storageLabSaveSchema, adapter, namespace: 'storage-lab-save' });
    await saveStore.save('profile-1', { highScore: 10, unlockedLevels: ['level-1', 'level-2'], coins: 20, checkpointIndex: 1 });
    await saveStore.flush();
    saveStore.dispose();

    const record = emptyRecord();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: trackedSession(record) } as never));
    });
    await awaitReady(renderer!, 'vol 1.00');

    await press(renderer!, 'Vol −');
    await act(async () => {
      await sleep(30);
    });
    assert.ok(findText(renderer!, 'vol 0.90'), 'volume lowered via real button');

    // Remount: settings persisted through the request-owned store.
    let renderer2: ReturnType<typeof create> | null = null;
    const record2 = emptyRecord();
    await act(async () => {
      renderer2 = create(createElement(StorageLabScreen as never, { adapter, createSession: trackedSession(record2) } as never));
    });
    await act(async () => {
      await sleep(20);
    });
    assert.ok(findText(renderer2!, 'vol 0.90'), 'remount resumes button-driven settings');
    assert.ok(findText(renderer2!, 'checkpoint 1'), 'resumed checkpoint 1');
    await act(async () => {
      renderer2!.unmount();
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

  it('SF1: Save now and Reset follow checkpoint write in acceptance order (shared queue)', async () => {
    const inner = createMemoryStorageAdapter();
    const ops: string[] = [];
    const gate: { release: (() => void) | null } = { release: null };
    let firstSaveWriteSeen = false;
    const adapter = {
      read: inner.read.bind(inner),
      write: async (k: string, v: string) => {
        if (k.includes('storage-lab-save')) {
          if (!firstSaveWriteSeen) {
            firstSaveWriteSeen = true;
            await new Promise<void>((r) => {
              gate.release = r;
            });
          }
          ops.push(`write:${JSON.parse(v).payload.checkpointIndex}`);
        }
        return inner.write(k, v);
      },
      remove: async (k: string) => {
        ops.push('remove');
        return inner.remove(k);
      },
    } as unknown as import('rn-gamekit/storage').GameStorageAdapter & { read: (k: string) => Promise<string | undefined> };

    const record = emptyRecord();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: trackedSession(record) } as never));
    });
    await act(async () => {
      await sleep(20);
    });

    // Drive across checkpoint 0 — the listener's save blocks on write #1.
    await drive(record.driverRef, () => gate.release !== null, 400);
    assert.ok(gate.release !== null, 'checkpoint write blocked');

    // While the checkpoint write is blocked, accept newer work through the REAL
    // buttons — these MUST join the same request-owned saveStore queue.
    await press(renderer!, 'Save now');
    await press(renderer!, 'Reset');

    // Acceptance order so far: checkpoint(save cp=0) → manual save → reset(remove).
    gate.release!();

    // Wait until all three settle on the shared queue: the reset (remove) must
    // be the final adapter state for the slot.
    const saveKey = 'rn-gamekit.storage.storage-lab-save.profile-1';
    let settled = false;
    for (let i = 0; i < 200 && !settled; i += 1) {
      await sleep(10);
      if ((await inner.read(saveKey)) === undefined) settled = true;
    }
    assert.ok(settled, 'reset (last accepted op) wins the slot');

    // Completion order must equal acceptance order. The manual-save projection
    // may legitimately capture the pre-crossing snapshot (getRenderFrame lag).
    const ordered = ops.filter((o) => o.startsWith('write:') || o === 'remove');
    assert.equal(ordered.length, 3, `three completions (got ${JSON.stringify(ops)})`);
    assert.match(ordered[0]!, /^write:\d+$/, 'first completion is the checkpoint save');
    assert.match(ordered[1]!, /^write:/, 'second completion is the manual save');
    assert.equal(ordered[2], 'remove', 'last completion is the reset');
    await act(async () => {
      renderer!.unmount();
    });
  });

  it('SF1: rapid volume changes serialize on the shared settings store — latest accepted wins', async () => {
    const inner = createMemoryStorageAdapter();
    const volumes: number[] = [];
    let firstGate: (() => void) | null = null;
    const adapter = {
      read: inner.read.bind(inner),
      write: async (k: string, v: string) => {
        if (k.includes('storage-lab-settings')) {
          const payloadVolume = JSON.parse(v).payload.volume;
          if (volumes.length === 0) {
            volumes.push(payloadVolume);
            await new Promise<void>((r) => {
              firstGate = r;
            });
            volumes.push(payloadVolume);
          } else {
            volumes.push(payloadVolume);
          }
        }
        return inner.write(k, v);
      },
      remove: inner.remove.bind(inner),
    } as unknown as import('rn-gamekit/storage').GameStorageAdapter;

    const record = emptyRecord();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter, createSession: trackedSession(record) } as never));
    });
    await awaitReady(renderer!, 'vol 1.00');

    // First press blocks mid-write; second press queues behind it on the SAME store.
    await press(renderer!, 'Vol −'); // 1.00 -> 0.90 (blocked)
    await press(renderer!, 'Vol −'); // 0.90 -> 0.80 (queued)
    firstGate!();

    const verify = createGameSaveStore({ schema: storageLabSettingsSchema, adapter: inner, namespace: 'storage-lab-settings' });
    let latest = 0;
    for (let i = 0; i < 100; i += 1) {
      await sleep(10);
      const res = await verify.load('player');
      latest = res.data.volume;
      if (latest < 0.85) break;
    }
    assert.ok(Math.abs(latest - 0.8) < 1e-9, `latest accepted volume wins (got ${latest})`);
    verify.dispose();
    await act(async () => {
      renderer!.unmount();
    });
  });

  it('SF1: a rejected action does not hang cleanup or later actions', async () => {
    const inner = createMemoryStorageAdapter();
    const failing = {
      read: inner.read.bind(inner),
      write: async (k: string, v: string) => {
        if (k.includes('storage-lab-settings')) throw new Error('disk on fire');
        return inner.write(k, v);
      },
      remove: inner.remove.bind(inner),
    } as unknown as import('rn-gamekit/storage').GameStorageAdapter;

    const record = emptyRecord();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter: failing, createSession: trackedSession(record) } as never));
    });
    await awaitReady(renderer!, 'vol 1.00');

    await press(renderer!, 'Vol +');
    await act(async () => {
      await sleep(20);
    });
    assert.ok(findText(renderer!, 'settings failed'), 'rejection surfaced in status');

    // Later actions through the other store still complete — nothing hangs.
    await press(renderer!, 'Save now');
    await act(async () => {
      await sleep(30);
    });
    assert.ok(findText(renderer!, 'manual save complete'), 'later action completed after rejection');

    await act(async () => {
      renderer!.unmount();
    });
    assert.equal(record.disposed, 1, 'session disposed exactly once despite rejection path');
  });

  it('SF2: A→B replacement with blocked B reads — loading UI, no controls, exact-once disposal', async () => {
    const adapterA = createMemoryStorageAdapter();
    const adapterB = createMemoryStorageAdapter();

    // Block ALL of B's storage reads until the test releases them.
    const bGates: Array<() => void> = [];
    const gatedB = {
      read: async (k: string) => {
        if (k.includes('rn-gamekit.storage.')) {
          await new Promise<void>((r) => {
            bGates.push(r);
          });
        }
        return adapterB.read(k);
      },
      write: adapterB.write.bind(adapterB),
      remove: adapterB.remove.bind(adapterB),
    } as unknown as import('rn-gamekit/storage').GameStorageAdapter;

    const recordA = emptyRecord();
    const recordB = emptyRecord();
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(createElement(StorageLabScreen as never, { adapter: adapterA, createSession: trackedSession(recordA) } as never));
    });
    await awaitReady(renderer!, 'loaded default');

    // Swap WITHOUT unmounting; B's reads stay blocked.
    await act(async () => {
      renderer!.update(createElement(StorageLabScreen as never, { adapter: gatedB, createSession: trackedSession(recordB) } as never));
      // No sleeps here — assert synchronously-committed loading state first.
    });
    await act(async () => {});
    await sleep(10);

    // During the replacement interval the screen is BLOCKING, not interactive.
    assert.ok(findText(renderer!, 'loading saves'), 'blocking loading UI during replacement');
    assert.ok(!findText(renderer!, 'Move right'), 'no gameplay controls mounted while B loads');
    assert.ok(!findText(renderer!, 'Save now'), 'no save control while B loads');
    assert.ok(!haystacks(renderer!).includes('loaded default'), 'A status cleared');

    // A was disposed EXACTLY once by the replacement cleanup, synchronously.
    assert.equal(recordA.disposed, 1, 'A disposed exactly once at swap');
    // No input can reach disposed A — the session contract rejects live commands.
    assert.throws(() => recordA.raw.input.press('right'), /disposed/i, 'input cannot reach disposed A');

    // Release B — only B remains active.
    for (const release of bGates) release();
    await act(async () => {
      await sleep(30);
    });
    assert.ok(findText(renderer!, 'loaded default'), 'only B rendered after release');
    assert.ok(findText(renderer!, 'Move right'), 'B controls mounted');
    assert.equal(recordB.disposed, 0, 'B not disposed while active');
    assert.equal(recordA.disposed, 1, 'A stays at exactly one disposal');

    await act(async () => {
      renderer!.unmount();
    });
    assert.equal(recordB.disposed, 1, 'B disposed exactly once at unmount');
    assert.equal(recordA.disposed, 1, 'A still exactly once');
    assert.equal(recordB.unsubscribed, 1, 'B checkpoint subscription removed exactly once');
  });

  it('playground declares AsyncStorage directly', async () => {
    const fs = await import('node:fs/promises');
    const pkg = JSON.parse(await fs.readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    assert.equal(pkg.dependencies['@react-native-async-storage/async-storage'], '2.1.2');
  });
});
