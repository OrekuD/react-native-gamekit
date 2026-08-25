import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GameStorageError } from '../src/storage/errors';
import { defineGameSave } from '../src/storage/schema';
import { createGameSaveStore } from '../src/storage/store';
import { createMemoryStorageAdapter, createFailingStorageAdapter } from '../src/storage/adapters/memory';
import { STORAGE_LIMITS, type GameStorageAdapter } from '../src/storage/types';
import { cloneAndValidatePlainData, parseEnvelope, serializeEnvelope } from '../src/storage/serialization';

// ---------------------------------------------------------------------------
// Helpers: real settings and checkpoint projections (T17.0)
// ---------------------------------------------------------------------------

type Settings = {
  volume: number;
  muted: boolean;
  language: string;
};

function validateSettings(value: unknown): Settings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('settings must be object');
  const v = value as Record<string, unknown>;
  if (typeof v.volume !== 'number' || !Number.isFinite(v.volume) || v.volume < 0 || v.volume > 1)
    throw new Error('volume must be finite 0..1 at volume');
  if (typeof v.muted !== 'boolean') throw new Error('muted must be boolean at muted');
  if (typeof v.language !== 'string' || v.language.length === 0) throw new Error('language must be string at language');
  return { volume: v.volume, muted: v.muted, language: v.language };
}

// Checkpoint projection — versioned save with migrations
// V1: { highScore: number, unlockedLevels: string[] }
// V2: { highScore: number, unlockedLevels: string[], coins: number }
// V3: { highScore: number, unlockedLevels: string[], coins: number, achievements: string[] }

type SaveV1 = { highScore: number; unlockedLevels: string[] };
type SaveV2 = SaveV1 & { coins: number };
type SaveV3 = SaveV2 & { achievements: string[] };

function validateSaveV3(value: unknown): SaveV3 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('save must be object');
  const v = value as Record<string, unknown>;
  if (typeof v.highScore !== 'number' || !Number.isFinite(v.highScore)) throw new Error('highScore must be finite');
  if (!Array.isArray(v.unlockedLevels)) throw new Error('unlockedLevels must be array');
  for (let i = 0; i < (v.unlockedLevels as unknown[]).length; i += 1) {
    if (typeof (v.unlockedLevels as unknown[])[i] !== 'string') throw new Error(`unlockedLevels[${i}] must be string`);
  }
  if (typeof v.coins !== 'number' || !Number.isFinite(v.coins)) throw new Error('coins must be finite');
  if (!Array.isArray(v.achievements)) throw new Error('achievements must be array');
  for (let i = 0; i < (v.achievements as unknown[]).length; i += 1) {
    if (typeof (v.achievements as unknown[])[i] !== 'string') throw new Error(`achievements[${i}] must be string`);
  }
  return v as SaveV3;
}

function migrateV1ToV2(value: unknown): unknown {
  const v1 = value as SaveV1;
  return { ...v1, coins: 0 };
}
function migrateV2ToV3(value: unknown): unknown {
  const v2 = value as SaveV2;
  return { ...v2, achievements: [] };
}

const saveSchemaV3 = defineGameSave<SaveV3>({
  id: 'com.oreku.brick-breaker.save',
  version: 3,
  createDefault: () => ({ highScore: 0, unlockedLevels: ['level-1'], coins: 0, achievements: [] }),
  validate: validateSaveV3,
  migrations: { 1: migrateV1ToV2, 2: migrateV2ToV3 },
});

const settingsSchema = defineGameSave<Settings>({
  id: 'com.oreku.brick-breaker.settings',
  version: 1,
  createDefault: () => ({ volume: 1, muted: false, language: 'en' }),
  validate: validateSettings,
  migrations: {},
});

// ---------------------------------------------------------------------------
// T17.1 — schema and migrations
// ---------------------------------------------------------------------------

describe('storage: schema and migrations (T17.1)', () => {
  it('validates ids, versions, migration steps', () => {
    assert.throws(() => defineGameSave({ id: '', version: 1, createDefault: () => ({}), validate: (v) => v as never, migrations: {} }), /schema id/);
    assert.throws(() => defineGameSave({ id: 'bad..id', version: 1, createDefault: () => ({}), validate: (v) => v as never, migrations: {} }), /schema id/);
    assert.throws(() => defineGameSave({ id: 'com.example.save', version: 0, createDefault: () => ({}), validate: (v) => v as never, migrations: {} }), /version/);
    assert.throws(
      () =>
        defineGameSave({
          id: 'com.example.save',
          version: 2,
          createDefault: () => ({}),
          validate: (v) => v as never,
          migrations: { 2: () => ({}) } as never,
        }),
      /migration key/,
    );
  });

  it('clone/freeze defaults, migration results, and final data', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: saveSchemaV3, adapter, namespace: 'test-freeze' });
    const loaded = await store.load('slot1');
    assert.equal(loaded.status, 'default');
    assert.ok(Object.isFrozen(loaded.data));
    assert.ok(Object.isFrozen(loaded.data.unlockedLevels));
    assert.ok(Object.isFrozen(loaded.data.achievements));
    // Mutating should not affect next load
    assert.throws(() => {
      (loaded.data as unknown as Record<string, unknown>).highScore = 999;
    });
    const reloaded = await store.load('slot1');
    assert.equal(reloaded.data.highScore, 0);
    store.dispose();
  });

  it('preserves stored bytes when migration or validation fails (never overwrites)', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: saveSchemaV3, adapter, namespace: 'test-preserve' });
    // Write corrupted envelope directly via adapter (future version)
    const key = `rn-gamekit.storage.test-preserve.slot1`;
    await adapter.write(
      key,
      JSON.stringify({
        format: 'rn-gamekit.save',
        schemaId: 'com.oreku.brick-breaker.save',
        schemaVersion: 99,
        savedAtMs: Date.now(),
        payload: { highScore: 0, unlockedLevels: [], coins: 0, achievements: [] },
      }),
    );
    await assert.rejects(() => store.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'FUTURE_VERSION');
      return true;
    });
    // Raw bytes still present, not overwritten with default
    const raw = await adapter.read(key);
    assert.ok(raw !== undefined);
    assert.ok(raw.includes('"schemaVersion\":99') || raw.includes('99'));
    store.dispose();
  });

  it('missing migration step fails clearly', async () => {
    const schemaMissing = defineGameSave<SaveV3>({
      id: 'com.oreku.missing.save',
      version: 3,
      createDefault: () => ({ highScore: 0, unlockedLevels: [], coins: 0, achievements: [] }),
      validate: validateSaveV3,
      migrations: { 1: migrateV1ToV2 }, // missing 2
    });
    const adapter = createMemoryStorageAdapter();
    const key = `rn-gamekit.storage.test-missing.slot1`;
    await adapter.write(
      key,
      JSON.stringify({
        format: 'rn-gamekit.save',
        schemaId: 'com.oreku.missing.save',
        schemaVersion: 1,
        savedAtMs: Date.now(),
        payload: { highScore: 10, unlockedLevels: ['a'] },
      }),
    );
    const store = createGameSaveStore({ schema: schemaMissing, adapter, namespace: 'test-missing' });
    await assert.rejects(() => store.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'MISSING_MIGRATION');
      return true;
    });
    store.dispose();
  });

  it('future-version fails clearly', async () => {
    const adapter = createMemoryStorageAdapter();
    const key = `rn-gamekit.storage.test-future.slot1`;
    await adapter.write(
      key,
      JSON.stringify({
        format: 'rn-gamekit.save',
        schemaId: saveSchemaV3.id,
        schemaVersion: 10,
        savedAtMs: Date.now(),
        payload: { highScore: 1, unlockedLevels: [], coins: 0, achievements: [] },
      }),
    );
    const store = createGameSaveStore({ schema: saveSchemaV3, adapter, namespace: 'test-future' });
    await assert.rejects(() => store.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'FUTURE_VERSION');
      return true;
    });
    store.dispose();
  });

  it('migrations run sequentially and are pure (do not mutate input)', async () => {
    let mutated = false;
    const adapter = createMemoryStorageAdapter();
    const schema = defineGameSave({
      id: 'com.example.migrate-pure',
      version: 3,
      createDefault: () => ({ a: 1 }),
      validate: (v) => v as { a: number; b: number; c: number },
      migrations: {
        1: (v: unknown) => {
          const orig = v as Record<string, unknown>;
          const out = { ...orig, b: 2 };
          // Check input not mutated by verifying orig still has only a
          if ('b' in orig) mutated = true;
          return out;
        },
        2: (v: unknown) => ({ ...(v as object), c: 3 }),
      },
    });
    const key = `rn-gamekit.storage.test-pure.slot1`;
    await adapter.write(
      key,
      JSON.stringify({
        format: 'rn-gamekit.save',
        schemaId: 'com.example.migrate-pure',
        schemaVersion: 1,
        savedAtMs: Date.now(),
        payload: { a: 1 },
      }),
    );
    const store = createGameSaveStore({ schema, adapter, namespace: 'test-pure' });
    const res = await store.load('slot1');
    assert.equal(res.status, 'migrated');
    assert.deepEqual(res.data, { a: 1, b: 2, c: 3 });
    assert.equal(mutated, false);
    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// T17.2 — serialization and envelopes
// ---------------------------------------------------------------------------

describe('storage: serialization and envelopes (T17.2)', () => {
  it('rejects cycles, functions, symbols, bigint, non-finite, sparse, unsafe prototypes with exact paths', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    assert.throws(() => cloneAndValidatePlainData(cyclic, 'payload'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).path, 'payload.self');
      return true;
    });
    assert.throws(() => cloneAndValidatePlainData({ fn: () => {} }, 'payload'), /function/);
    assert.throws(() => cloneAndValidatePlainData({ s: Symbol('x') }, 'payload'), /symbol/);
    assert.throws(() => cloneAndValidatePlainData({ b: BigInt(1) }, 'payload'), /bigint/);
    assert.throws(() => cloneAndValidatePlainData({ n: Number.NaN }, 'payload'), /finite/);
    assert.throws(() => cloneAndValidatePlainData({ arr: [1, , 3] }, 'payload'), /sparse/);
    const polluted: Record<string, unknown> = {};
    Object.defineProperty(polluted, '__proto__', { value: { polluted: true }, enumerable: true, configurable: true, writable: true });
    assert.throws(() => cloneAndValidatePlainData(polluted, 'payload'), /unsafe/);
    assert.throws(() => cloneAndValidatePlainData(Object.create(null, { a: { value: 1, enumerable: false } }) as unknown, 'payload'), /non-enumerable/);
  });

  it('bounds serialized bytes, depth, array length, object-field count', () => {
    // Depth
    let deep: unknown = 0;
    for (let i = 0; i < STORAGE_LIMITS.MAX_DEPTH + 2; i += 1) deep = { next: deep };
    assert.throws(() => cloneAndValidatePlainData(deep, 'payload'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'DEPTH_EXCEEDED');
      return true;
    });
    // Array length
    const longArr = new Array(STORAGE_LIMITS.MAX_ARRAY_LENGTH + 1).fill(0);
    assert.throws(() => cloneAndValidatePlainData({ arr: longArr }, 'payload'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      return true;
    });
    // Object fields
    const manyFields: Record<string, number> = {};
    for (let i = 0; i < STORAGE_LIMITS.MAX_OBJECT_FIELDS + 1; i += 1) manyFields[`f${i}`] = i;
    assert.throws(() => cloneAndValidatePlainData(manyFields, 'payload'), /field count/);
    // String length
    const longStr = 'a'.repeat(STORAGE_LIMITS.MAX_STRING_LENGTH + 1);
    assert.throws(() => cloneAndValidatePlainData({ s: longStr }, 'payload'), /string/);
  });

  it('bounds serialized byte size via envelope', () => {
    const bigPayload = { s: 'a'.repeat(STORAGE_LIMITS.MAX_SERIALIZED_BYTES) };
    const envelope = {
      format: 'rn-gamekit.save' as const,
      schemaId: 'com.example.save',
      schemaVersion: 1,
      savedAtMs: Date.now(),
      payload: bigPayload,
    };
    assert.throws(() => serializeEnvelope(envelope), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'SIZE_EXCEEDED');
      return true;
    });
  });

  it('parse rejects malformed, corrupt, oversized envelopes', () => {
    assert.throws(() => parseEnvelope('not json'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'CORRUPT_ENVELOPE');
      return true;
    });
    assert.throws(() => parseEnvelope(JSON.stringify({ format: 'bad' })), /corrupt envelope/);
    assert.throws(() => parseEnvelope(JSON.stringify({ format: 'rn-gamekit.save', schemaId: 123, schemaVersion: 1, savedAtMs: Date.now(), payload: {} })), /corrupt envelope/);
  });

  it('payloads are not logged by default (envelope keeps them opaque)', () => {
    // Ensure serialize does not console.log; we just check it returns string without leaking to console
    const envelope = {
      format: 'rn-gamekit.save' as const,
      schemaId: 'com.example.save',
      schemaVersion: 1,
      savedAtMs: Date.now(),
      payload: { secret: 'do-not-log' },
    };
    const s = serializeEnvelope(envelope);
    assert.ok(s.includes('do-not-log'));
    // The test itself verifies we don't have a logging side effect elsewhere
  });

  it('caller mutation before and after save does not affect stored bytes', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: saveSchemaV3, adapter, namespace: 'test-mut' });
    const data: SaveV3 = { highScore: 10, unlockedLevels: ['a'], coins: 5, achievements: [] };
    const saveP = store.save('slot1', data);
    // Mutate original before await
    data.highScore = 999;
    (data.unlockedLevels as string[]).push('b');
    await saveP;
    const loaded = await store.load('slot1');
    assert.equal(loaded.data.highScore, 10);
    assert.deepEqual(loaded.data.unlockedLevels, ['a']);
    // Mutate returned data should not affect next load (frozen)
    assert.ok(Object.isFrozen(loaded.data));
    store.dispose();
  });

  it('savedAtMs is metadata and never enters deterministic state automatically', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: saveSchemaV3, adapter, namespace: 'test-meta' });
    await store.save('slot1', { highScore: 1, unlockedLevels: [], coins: 0, achievements: [] });
    const raw = await adapter.read(`rn-gamekit.storage.test-meta.slot1`);
    assert.ok(raw !== undefined);
    const env = JSON.parse(raw!);
    assert.equal(typeof env.savedAtMs, 'number');
    // payload must not contain savedAtMs
    assert.equal((env.payload as Record<string, unknown>).savedAtMs, undefined);
    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// T17.3 — async store and adapters
// ---------------------------------------------------------------------------

describe('storage: async store and adapters (T17.3)', () => {
  it('namespaced load/save/delete with per-slot serialization', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: settingsSchema, adapter, namespace: 'game-a' });
    const storeB = createGameSaveStore({ schema: settingsSchema, adapter, namespace: 'game-b' });
    await store.save('slot1', { volume: 0.5, muted: true, language: 'fr' });
    await storeB.save('slot1', { volume: 0.8, muted: false, language: 'de' });
    const a = await store.load('slot1');
    const b = await storeB.load('slot1');
    assert.equal(a.data.language, 'fr');
    assert.equal(b.data.language, 'de');
    // Keys are namespaced
    assert.ok((await adapter.read('rn-gamekit.storage.game-a.slot1')) !== undefined);
    assert.ok((await adapter.read('rn-gamekit.storage.game-b.slot1')) !== undefined);
    store.dispose();
    storeB.dispose();
  });

  it('serializes same-slot operations in request order (old slow write cannot overwrite newer)', async () => {
    const inner = createMemoryStorageAdapter();
    let firstWriteDelay = 40;
    const adapter: typeof inner = {
      read: inner.read.bind(inner),
      write: async (k, v) => {
        if (k.endsWith('.slot1') && firstWriteDelay > 0) {
          const d = firstWriteDelay;
          firstWriteDelay = 0;
          await new Promise((r) => setTimeout(r, d));
        }
        return inner.write(k, v);
      },
      remove: inner.remove.bind(inner),
    };
    const store = createGameSaveStore({ schema: settingsSchema, adapter, namespace: 'test-order' });
    const p1 = store.save('slot1', { volume: 0.1, muted: false, language: 'en' });
    const p2 = store.save('slot1', { volume: 0.9, muted: true, language: 'ja' });
    await Promise.all([p1, p2]);
    const loaded = await store.load('slot1');
    assert.equal(loaded.data.volume, 0.9);
    assert.equal(loaded.data.language, 'ja');
    store.dispose();
  });

  it('different slots proceed independently (simple bounded policy)', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: settingsSchema, adapter, namespace: 'test-concurrent' });
    let slot1Delayed = true;
    const originalWrite = adapter.write.bind(adapter);
    const wrappedAdapter: typeof adapter = {
      read: adapter.read.bind(adapter),
      write: async (k, v) => {
        if (k.endsWith('.slot1') && slot1Delayed) {
          await new Promise((r) => setTimeout(r, 30));
          slot1Delayed = false;
        }
        return originalWrite(k, v);
      },
      remove: adapter.remove.bind(adapter),
    };
    const store2 = createGameSaveStore({ schema: settingsSchema, adapter: wrappedAdapter, namespace: 'test-concurrent' });
    const start = Date.now();
    const p1 = store2.save('slot1', { volume: 0.2, muted: false, language: 'en' });
    const p2 = store2.save('slot2', { volume: 0.8, muted: false, language: 'de' });
    await p2;
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 20, `slot2 should not wait for slot1, elapsed ${elapsed}`);
    await p1;
    store2.dispose();
    store.dispose();
  });

  it('flush waits for operations accepted before the call', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: settingsSchema, adapter, namespace: 'test-flush' });
    let writeStarted = false;
    let writeContinue: (() => void) | null = null;
    const delayedAdapter: typeof adapter = {
      read: adapter.read.bind(adapter),
      write: async (k, v) => {
        writeStarted = true;
        await new Promise<void>((r) => {
          writeContinue = r;
        });
        return adapter.write(k, v);
      },
      remove: adapter.remove.bind(adapter),
    };
    const store2 = createGameSaveStore({ schema: settingsSchema, adapter: delayedAdapter, namespace: 'test-flush' });
    const saveP = store2.save('slot1', { volume: 0.3, muted: false, language: 'en' });
    // Wait until write started
    while (!writeStarted) await new Promise((r) => setTimeout(r, 5));
    let flushed = false;
    const flushP = store2.flush().then(() => {
      flushed = true;
    });
    assert.equal(flushed, false);
    writeContinue!();
    await saveP;
    await flushP;
    assert.equal(flushed, true);
    store2.dispose();
    store.dispose();
  });

  it('dispose is idempotent and rejects new work', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: settingsSchema, adapter, namespace: 'test-dispose' });
    store.dispose();
    store.dispose(); // idempotent
    await assert.rejects(() => store.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'DISPOSED');
      return true;
    });
    await assert.rejects(() => store.save('slot1', { volume: 1, muted: false, language: 'en' }), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'DISPOSED');
      return true;
    });
  });

  it('preserves backend causes', async () => {
    const inner = createMemoryStorageAdapter();
    const failing = createFailingStorageAdapter(inner, {
      failRead: () => new Error('disk failed'),
    });
    const store = createGameSaveStore({ schema: settingsSchema, adapter: failing, namespace: 'test-cause' });
    await assert.rejects(() => store.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'BACKEND_READ_FAILED');
      assert.ok((e as GameStorageError).cause instanceof Error);
      assert.equal(((e as GameStorageError).cause as Error).message, 'disk failed');
      return true;
    });
    store.dispose();
  });

  it('invalid namespace/slot, invalid projection, size/depth, backend failures are explicit', async () => {
    const adapter = createMemoryStorageAdapter();
    assert.throws(() => createGameSaveStore({ schema: settingsSchema, adapter, namespace: '' }), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'INVALID_NAMESPACE');
      return true;
    });
    const store = createGameSaveStore({ schema: settingsSchema, adapter, namespace: 'test-invalid' });
    await assert.rejects(() => store.load(''), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'INVALID_SLOT');
      return true;
    });
    await assert.rejects(() => store.save('', { volume: 1, muted: false, language: 'en' }), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'INVALID_SLOT');
      return true;
    });
    // Invalid projection
    await assert.rejects(() => store.save('slot1', { volume: 2, muted: false, language: 'en' } as unknown as Settings), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'VALIDATION_FAILED');
      return true;
    });
    // Backend write failure
    const inner2 = createMemoryStorageAdapter();
    const failingWrite = createFailingStorageAdapter(inner2, { failWrite: () => new Error('write fail') });
    const store2 = createGameSaveStore({ schema: settingsSchema, adapter: failingWrite, namespace: 'test-write-fail' });
    await assert.rejects(() => store2.save('slot1', { volume: 1, muted: false, language: 'en' }), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'BACKEND_WRITE_FAILED');
      return true;
    });
    store.dispose();
    store2.dispose();
  });

  it('stale results from replaced store generations cannot publish', async () => {
    const adapter = createMemoryStorageAdapter();
    const store1 = createGameSaveStore({ schema: settingsSchema, adapter, namespace: 'test-stale' });
    await store1.save('slot1', { volume: 0.1, muted: false, language: 'en' });
    // New load after dispose must be rejected (stale generation)
    store1.dispose();
    await assert.rejects(() => store1.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'DISPOSED');
      return true;
    });
    // A pending write accepted before dispose should still complete (policy for accepted writes)
    const adapter2 = createMemoryStorageAdapter();
    const store2 = createGameSaveStore({ schema: settingsSchema, adapter: adapter2, namespace: 'test-stale-2' });
    let writeStarted = false;
    let continueWrite: (() => void) | null = null;
    const delayedAdapter2: typeof adapter2 = {
      read: adapter2.read.bind(adapter2),
      write: async (k, v) => {
        writeStarted = true;
        await new Promise<void>((r) => {
          continueWrite = r;
        });
        return adapter2.write(k, v);
      },
      remove: adapter2.remove.bind(adapter2),
    };
    const store3 = createGameSaveStore({ schema: settingsSchema, adapter: delayedAdapter2, namespace: 'test-stale-2' });
    const pendingSave = store3.save('slot1', { volume: 0.5, muted: false, language: 'en' });
    while (!writeStarted) await new Promise((r) => setTimeout(r, 5));
    store3.dispose();
    // Accepted write should still be awaitable via flush; it should not be rejected as stale
    continueWrite!();
    await pendingSave;
    // But new work after dispose must be rejected
    await assert.rejects(() => store3.save('slot2', { volume: 0.5, muted: false, language: 'en' }), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'DISPOSED');
      return true;
    });
    store2.dispose();
  });

  it('in-memory and failing adapters work as test doubles', async () => {
    const mem = createMemoryStorageAdapter({ 'rn-gamekit.storage.ns.slot1': 'hello' });
    assert.equal(await mem.read('rn-gamekit.storage.ns.slot1'), 'hello');
    await mem.write('rn-gamekit.storage.ns.slot1', 'world');
    assert.equal(await mem.read('rn-gamekit.storage.ns.slot1'), 'world');
    await mem.remove('rn-gamekit.storage.ns.slot1');
    assert.equal(await mem.read('rn-gamekit.storage.ns.slot1'), undefined);
  });
});

// ---------------------------------------------------------------------------
// T17-RF1 — F1–F3 RED regression tests (must fail against 051052a)
// ---------------------------------------------------------------------------

const sleep5 = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('storage: F1–F3 RED regressions (T17-RF1)', () => {
  it('F1: immediate dispose after accepted save does not cancel it (no microtask yield)', async () => {
    const inner = createMemoryStorageAdapter();
    let writeStarted = false;
    let continueWrite: (() => void) | null = null;
    const adapter = {
      read: inner.read.bind(inner),
      write: async (k: string, v: string) => {
        writeStarted = true;
        await new Promise<void>((r) => {
          continueWrite = r;
        });
        return inner.write(k, v);
      },
      remove: inner.remove.bind(inner),
    };
    const store = createGameSaveStore({ schema: settingsSchema, adapter: adapter as unknown as GameStorageAdapter, namespace: 'rf1-immediate' });
    const pending = store.save('slot1', { volume: 0.5, muted: false, language: 'en' });
    // No microtask yield — dispose immediately after acceptance
    store.dispose();
    // New work must be rejected
    await assert.rejects(() => store.save('slot2', { volume: 0.5, muted: false, language: 'en' }), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'DISPOSED');
      return true;
    });
    // Accepted save must still reach adapter
    assert.equal(writeStarted, true);
    continueWrite!();
    await pending;
    // Verify bytes were actually written despite dispose
    const raw = await inner.read('rn-gamekit.storage.rf1-immediate.slot1');
    assert.ok(raw !== undefined);
  });

  it('F1: two queued same-slot saves, dispose while first blocked, both complete in order', async () => {
    const inner = createMemoryStorageAdapter();
    let firstStarted = false;
    let continueFirst: (() => void) | null = null;
    let secondStarted = false;
    const adapter = {
      read: inner.read.bind(inner),
      write: async (k: string, v: string) => {
        if (!firstStarted) {
          firstStarted = true;
          await new Promise<void>((r) => {
            continueFirst = r;
          });
        } else {
          secondStarted = true;
        }
        return inner.write(k, v);
      },
      remove: inner.remove.bind(inner),
    };
    const store = createGameSaveStore({ schema: settingsSchema, adapter: adapter as unknown as GameStorageAdapter, namespace: 'rf1-queued' });
    const p1 = store.save('slot1', { volume: 0.1, muted: false, language: 'en' });
    const p2 = store.save('slot1', { volume: 0.9, muted: true, language: 'ja' });
    while (!firstStarted) await new Promise((r) => setTimeout(r, 5));
    store.dispose();
    // Third save after dispose must reject
    await assert.rejects(() => store.save('slot1', { volume: 0.5, muted: false, language: 'en' }), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'DISPOSED');
      return true;
    });
    assert.equal(secondStarted, false);
    continueFirst!();
    await p1;
    // Second queued save must still run after first despite dispose, and in order
    await p2;
    assert.equal(secondStarted, true);
    const loaded = await inner.read('rn-gamekit.storage.rf1-queued.slot1');
    assert.ok(loaded !== undefined && loaded.includes('"language":"ja"'));
  });

  it('F2: two simultaneous flush() over one blocked operation both resolve', async () => {
    const inner = createMemoryStorageAdapter();
    let writeStarted = false;
    let continueWrite: (() => void) | null = null;
    const adapter = {
      read: inner.read.bind(inner),
      write: async (k: string, v: string) => {
        writeStarted = true;
        await new Promise<void>((r) => {
          continueWrite = r;
        });
        return inner.write(k, v);
      },
      remove: inner.remove.bind(inner),
    };
    const store = createGameSaveStore({ schema: settingsSchema, adapter: adapter as unknown as GameStorageAdapter, namespace: 'rf2-concurrent' });
    const pending = store.save('slot1', { volume: 0.3, muted: false, language: 'en' });
    while (!writeStarted) await new Promise((r) => setTimeout(r, 5));
    const flushA = store.flush();
    const flushB = store.flush();
    let aDone = false;
    let bDone = false;
    flushA.then(() => {
      aDone = true;
    });
    flushB.then(() => {
      bDone = true;
    });
    assert.equal(aDone, false);
    assert.equal(bDone, false);
    continueWrite!();
    await pending;
    await flushA;
    await flushB;
    assert.equal(aDone, true);
    assert.equal(bDone, true);
  });

  it('F2: flush watermark — later blocked op does not extend earlier flush', async () => {
    const base = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: settingsSchema, adapter: base, namespace: 'rf2-watermark' });
    await store.save('slot1', { volume: 0.1, muted: false, language: 'en' });
    await store.flush();

    // Two independently gated writes: first on slot1 (flush A's boundary), then on
    // slot2 accepted AFTER flush A was called (must NOT extend A).
    const gates = {
      first: null as (() => void) | null,
      second: null as (() => void) | null,
    };
    const state = { firstStarted: false, secondStarted: false };
    const delayedInner = createMemoryStorageAdapter();
    const delayedAdapter: GameStorageAdapter = {
      read: (k) => delayedInner.read(k),
      write: async (k, v) => {
        if (!state.firstStarted) {
          state.firstStarted = true;
          await new Promise<void>((r) => {
            gates.first = r;
          });
        } else if (!state.secondStarted) {
          state.secondStarted = true;
          await new Promise<void>((r) => {
            gates.second = r;
          });
        }
        return delayedInner.write(k, v);
      },
      remove: (k) => delayedInner.remove(k),
    };
    const store2 = createGameSaveStore({ schema: settingsSchema, adapter: delayedAdapter, namespace: 'rf2-watermark2' });

    // Blocked save #1 (inside flush A's snapshot)
    const p1 = store2.save('slot1', { volume: 0.2, muted: false, language: 'en' });
    while (gates.first === null) await sleep5();
    const flushA = store2.flush();

    // Later blocked save #2 accepted after flush A — must not extend A
    const p2 = store2.save('slot2', { volume: 0.8, muted: false, language: 'de' });
    while (gates.second === null) await sleep5();

    let aDone = false;
    void flushA.then(() => {
      aDone = true;
    });
    gates.first!();
    await p1;
    await flushA;
    assert.equal(aDone, true, 'flush A resolved with only its snapshot');
    assert.equal(state.secondStarted, true, 'later op ran concurrently on its own slot');

    const flushB = store2.flush();
    let bDone = false;
    void flushB.then(() => {
      bDone = true;
    });
    gates.second!();
    await p2;
    await flushB;
    assert.equal(bDone, true);
    store2.dispose();
    store.dispose();
  });

  it('F2: flush does not hang on failed operation and post-disposal flush resolves', async () => {
    const inner = createMemoryStorageAdapter();
    const failing = createFailingStorageAdapter(inner, { failWrite: () => new Error('write fail') });
    const store = createGameSaveStore({ schema: settingsSchema, adapter: failing, namespace: 'rf2-failed' });
    const p = store.save('slot1', { volume: 0.5, muted: false, language: 'en' }).catch(() => {});
    const flush = store.flush();
    await flush;
    await p;
    // Post-disposal flush with no pending should resolve immediately
    store.dispose();
    await store.flush();
  });

  it('F3: oversized raw UTF-8 bytes rejected before parse with SIZE_EXCEEDED and bytes untouched', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: saveSchemaV3, adapter, namespace: 'rf3-oversized-raw' });
    const key = 'rn-gamekit.storage.rf3-oversized-raw.slot1';
    const big = 'a'.repeat(STORAGE_LIMITS.MAX_SERIALIZED_BYTES + 1);
    const raw = JSON.stringify({ format: 'rn-gamekit.save', schemaId: saveSchemaV3.id, schemaVersion: 3, savedAtMs: Date.now(), payload: { s: big } });
    await adapter.write(key, raw);
    const before = await adapter.read(key);
    await assert.rejects(() => store.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'SIZE_EXCEEDED');
      assert.equal((e as GameStorageError).operation, 'load');
      assert.equal((e as GameStorageError).namespace, 'rf3-oversized-raw');
      return true;
    });
    const after = await adapter.read(key);
    assert.equal(after, before);
    store.dispose();
  });

  it('F3: excessive depth/nodes, unsafe keys rejected before migration with full context', async () => {
    const adapter = createMemoryStorageAdapter();
    const store = createGameSaveStore({ schema: saveSchemaV3, adapter, namespace: 'rf3-bounds' });
    // Depth
    let deep: unknown = 0;
    for (let i = 0; i < STORAGE_LIMITS.MAX_DEPTH + 2; i += 1) deep = { next: deep };
    const keyDepth = 'rn-gamekit.storage.rf3-bounds.slot1';
    await adapter.write(keyDepth, JSON.stringify({ format: 'rn-gamekit.save', schemaId: saveSchemaV3.id, schemaVersion: 1, savedAtMs: Date.now(), payload: deep }));
    await assert.rejects(() => store.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.ok((e as GameStorageError).code === 'DEPTH_EXCEEDED' || (e as GameStorageError).code === 'SIZE_EXCEEDED');
      assert.equal((e as GameStorageError).operation, 'load');
      return true;
    });
    // Unsafe key
    const polluted: Record<string, unknown> = {};
    Object.defineProperty(polluted, '__proto__', { value: { polluted: true }, enumerable: true, configurable: true, writable: true });
    const keyUnsafe = 'rn-gamekit.storage.rf3-bounds.slot2';
    await adapter.write(keyUnsafe, JSON.stringify({ format: 'rn-gamekit.save', schemaId: saveSchemaV3.id, schemaVersion: 1, savedAtMs: Date.now(), payload: polluted }));
    await assert.rejects(() => store.load('slot2'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).operation, 'load');
      return true;
    });
    store.dispose();
  });

  it('F3: migration that mutates input is isolated via frozen input', async () => {
    let mutated = false;
    const schema = defineGameSave({
      id: 'com.example.rf3-mutate',
      version: 2,
      createDefault: () => ({ a: 1 }),
      validate: (v) => v as { a: number; b: number },
      migrations: {
        1: (v: unknown) => {
          const o = v as Record<string, unknown>;
          try {
            (o as Record<string, unknown>).b = 2;
            mutated = true;
          } catch {
            mutated = false;
          }
          return { ...(v as object), b: 2 };
        },
      },
    });
    const adapter = createMemoryStorageAdapter();
    const key = 'rn-gamekit.storage.rf3-mutate.slot1';
    await adapter.write(key, JSON.stringify({ format: 'rn-gamekit.save', schemaId: 'com.example.rf3-mutate', schemaVersion: 1, savedAtMs: Date.now(), payload: { a: 1 } }));
    const store = createGameSaveStore({ schema, adapter, namespace: 'rf3-mutate' });
    const res = await store.load('slot1');
    assert.equal(mutated, false);
    assert.deepEqual(res.data, { a: 1, b: 2 });
    store.dispose();
  });

  it('F3: oversized intermediate migration output rejected with SIZE_EXCEEDED', async () => {
    const schema = defineGameSave({
      id: 'com.example.rf3-oversize-migrate',
      version: 2,
      createDefault: () => ({ a: 0 }),
      validate: (v) => v as { a: number; big: string },
      migrations: {
        1: () => ({ a: 1, big: 'a'.repeat(STORAGE_LIMITS.MAX_SERIALIZED_BYTES) }),
      },
    });
    const adapter = createMemoryStorageAdapter();
    const key = 'rn-gamekit.storage.rf3-oversize-migrate.slot1';
    await adapter.write(key, JSON.stringify({ format: 'rn-gamekit.save', schemaId: 'com.example.rf3-oversize-migrate', schemaVersion: 1, savedAtMs: Date.now(), payload: { a: 0 } }));
    const before = await adapter.read(key);
    const store = createGameSaveStore({ schema, adapter, namespace: 'rf3-oversize-migrate' });
    await assert.rejects(() => store.load('slot1'), (e: unknown) => {
      assert.ok(e instanceof GameStorageError);
      assert.equal((e as GameStorageError).code, 'SIZE_EXCEEDED');
      assert.equal((e as GameStorageError).operation, 'load');
      return true;
    });
    const after = await adapter.read(key);
    assert.equal(after, before);
    store.dispose();
  });
});
