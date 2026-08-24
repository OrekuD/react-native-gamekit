import { GameStorageError, storageError } from './errors';
import type { CreateGameSaveStoreOptions, GameSaveLoadResult, GameSaveStore } from './types';
import { storageKey, validateNamespace, validateSlot } from './validation';
import { createDefaultData, migratePayload, validateCurrentData } from './schema';
import { parseEnvelope, serializeEnvelope, STORAGE_ENVELOPE_FORMAT } from './serialization';
import type { StoredGameEnvelope } from './types';

export function createGameSaveStore<TData>(options: CreateGameSaveStoreOptions<TData>): GameSaveStore<TData> {
  const schema = options.schema;
  const adapter = options.adapter;
  const namespace = options.namespace;

  validateNamespace(namespace);

  // Per-slot serialized queue: slot -> tail promise
  const slotQueues = new Map<string, Promise<void>>();
  // Pending operations for flush()
  let pendingCount = 0;
  let pendingResolve: (() => void) | null = null;

  let disposed = false;
  let generation = 0;

  // Track active pending promises for flush
  const active = new Set<Promise<void>>();

  function assertNotDisposed(operation: string): void {
    if (disposed) {
      throw storageError(`store is disposed`, 'DISPOSED', { operation: operation as never, namespace });
    }
  }

  function track<T>(p: Promise<T>): Promise<T> {
    pendingCount += 1;
    const wrapped = p.finally(() => {
      pendingCount -= 1;
      active.delete(wrapped as unknown as Promise<void>);
      if (pendingCount === 0 && pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r();
      }
    });
    active.add(wrapped as unknown as Promise<void>);
    return wrapped;
  }

  function enqueue<T>(slot: string, op: () => Promise<T>): Promise<T> {
    assertNotDisposed(op.name || 'save');
    const tail = slotQueues.get(slot) ?? Promise.resolve();
    // Create a new tail that waits for previous
    let resolveTail: () => void;
    const nextTail = new Promise<void>((res) => {
      resolveTail = res;
    });
    slotQueues.set(slot, nextTail);

    const capturedGen = generation;
    const run = tail
      .catch(() => {
        // Previous failure does not block next; continue
      })
      .then(async () => {
        if (capturedGen !== generation) {
          throw storageError(`stale operation for slot "${slot}"`, 'DISPOSED', { namespace, slot });
        }
        return op();
      })
      .finally(() => {
        // Release tail if still current; allow next waiter to proceed
        if (slotQueues.get(slot) === nextTail) {
          // If no one else has chained after us, we need to keep tail resolved
          // but we already set nextTail; we resolve it now so next enqueued op can proceed
        }
        resolveTail!();
        // Clean up if queue is empty (no pending after us)
        // We keep map entry as resolved promise to avoid race; GC via flush
      });

    // Ensure nextTail resolves after run settles
    run.then(() => resolveTail!(), () => resolveTail!());

    return track(run);
  }

  async function loadInternal(slot: string): Promise<GameSaveLoadResult<TData>> {
    validateSlot(slot);
    const key = storageKey(namespace, slot);
    let raw: string | undefined;
    try {
      raw = await adapter.read(key);
    } catch (cause) {
      throw storageError(`backend read failed for slot "${slot}"`, 'BACKEND_READ_FAILED', {
        operation: 'load',
        namespace,
        slot,
        cause,
      });
    }
    if (raw === undefined) {
      const data = createDefaultData(schema);
      return { status: 'default', data };
    }
    // Validate loaded bytes as untrusted before migration
    let envelope: StoredGameEnvelope;
    try {
      envelope = parseEnvelope(raw);
    } catch (cause) {
      if (cause instanceof GameStorageError) {
        // Preserve code CORRUPT_ENVELOPE etc.
        throw new GameStorageError((cause as GameStorageError).message, {
          code: (cause as GameStorageError).code,
          operation: 'load',
          namespace,
          slot,
          schemaId: schema.id,
          schemaVersion: schema.version,
          path: (cause as GameStorageError).path,
          cause: (cause as GameStorageError).cause ?? cause,
        });
      }
      throw storageError(`corrupt envelope for slot "${slot}"`, 'CORRUPT_ENVELOPE', {
        operation: 'load',
        namespace,
        slot,
        cause,
      });
    }

    if (envelope.schemaId !== schema.id) {
      throw storageError(`schema id mismatch: expected "${schema.id}" got "${envelope.schemaId}"`, 'SCHEMA_ID_MISMATCH', {
        operation: 'load',
        namespace,
        slot,
        schemaId: schema.id,
        schemaVersion: schema.version,
      });
    }
    if (!Number.isSafeInteger(envelope.schemaVersion) || envelope.schemaVersion < 1) {
      throw storageError(`corrupt envelope: invalid schemaVersion`, 'CORRUPT_ENVELOPE', {
        operation: 'load',
        namespace,
        slot,
        schemaId: schema.id,
      });
    }
    if (envelope.schemaVersion > schema.version) {
      throw storageError(`stored version ${envelope.schemaVersion} is newer than current ${schema.version}`, 'FUTURE_VERSION', {
        operation: 'load',
        namespace,
        slot,
        schemaId: schema.id,
        schemaVersion: schema.version,
      });
    }

    // Migrate if needed
    let payload: unknown = envelope.payload;
    let fromVersion = envelope.schemaVersion;
    let toVersion = schema.version;
    let migrated = false;
    if (fromVersion !== toVersion) {
      const result = migratePayload(schema, fromVersion, payload);
      payload = result.data;
      fromVersion = result.fromVersion;
      toVersion = result.toVersion;
      migrated = true;
    }

    // Final validation — never overwrites stored record on failure
    let data: TData;
    try {
      data = validateCurrentData(schema, payload, 'payload');
    } catch (cause) {
      if (cause instanceof GameStorageError) {
        throw new GameStorageError(cause.message, {
          code: 'VALIDATION_FAILED',
          operation: 'load',
          namespace,
          slot,
          schemaId: schema.id,
          schemaVersion: schema.version,
          path: cause.path,
          cause: cause.cause ?? cause,
        });
      }
      throw storageError(`final validation failed`, 'VALIDATION_FAILED', {
        operation: 'load',
        namespace,
        slot,
        cause,
      });
    }

    if (migrated) {
      return { status: 'migrated', data, fromVersion: envelope.schemaVersion, toVersion };
    }
    // Distinguish stored vs default already handled; this is stored
    return { status: 'stored', data };
  }

  async function saveInternal(slot: string, data: TData): Promise<void> {
    validateSlot(slot);
    // Validate current data through schema (cloned/frozen) before serialization
    const validated = validateCurrentData(schema, data, 'data');
    const envelope: StoredGameEnvelope = {
      format: STORAGE_ENVELOPE_FORMAT,
      schemaId: schema.id,
      schemaVersion: schema.version,
      savedAtMs: Date.now(),
      payload: validated,
    };
    let serialized: string;
    try {
      serialized = serializeEnvelope(envelope);
    } catch (cause) {
      if (cause instanceof GameStorageError) {
        throw new GameStorageError(cause.message, {
          code: cause.code === 'SIZE_EXCEEDED' || cause.code === 'DEPTH_EXCEEDED' ? cause.code : 'SERIALIZATION_FAILED',
          operation: 'save',
          namespace,
          slot,
          schemaId: schema.id,
          schemaVersion: schema.version,
          path: cause.path,
          cause: cause.cause ?? cause,
        });
      }
      throw storageError(`serialization failed for slot "${slot}"`, 'SERIALIZATION_FAILED', {
        operation: 'save',
        namespace,
        slot,
        cause,
      });
    }
    const key = storageKey(namespace, slot);
    try {
      await adapter.write(key, serialized);
    } catch (cause) {
      throw storageError(`backend write failed for slot "${slot}"`, 'BACKEND_WRITE_FAILED', {
        operation: 'save',
        namespace,
        slot,
        cause,
      });
    }
  }

  async function removeInternal(slot: string): Promise<void> {
    validateSlot(slot);
    const key = storageKey(namespace, slot);
    try {
      await adapter.remove(key);
    } catch (cause) {
      throw storageError(`backend remove failed for slot "${slot}"`, 'BACKEND_REMOVE_FAILED', {
        operation: 'remove',
        namespace,
        slot,
        cause,
      });
    }
  }

  const store: GameSaveStore<TData> = {
    get disposed() {
      return disposed;
    },
    load(slot: string): Promise<GameSaveLoadResult<TData>> {
      if (disposed) {
        return Promise.reject(storageError(`store is disposed`, 'DISPOSED', { operation: 'load', namespace, slot }));
      }
      try {
        validateSlot(slot);
      } catch (e) {
        return Promise.reject(e);
      }
      return enqueue(slot, () => loadInternal(slot));
    },
    save(slot: string, data: TData): Promise<void> {
      if (disposed) {
        return Promise.reject(storageError(`store is disposed`, 'DISPOSED', { operation: 'save', namespace, slot }));
      }
      try {
        validateSlot(slot);
      } catch (e) {
        return Promise.reject(e);
      }
      // Snapshot synchronously so caller mutation after save() does not affect stored bytes
      let snapshot: TData;
      try {
        snapshot = validateCurrentData(schema, data, 'data');
      } catch (e) {
        return Promise.reject(e);
      }
      return enqueue(slot, () => saveInternal(slot, snapshot));
    },
    remove(slot: string): Promise<void> {
      if (disposed) {
        return Promise.reject(storageError(`store is disposed`, 'DISPOSED', { operation: 'remove', namespace, slot }));
      }
      try {
        validateSlot(slot);
      } catch (e) {
        return Promise.reject(e);
      }
      return enqueue(slot, () => removeInternal(slot));
    },
    delete(slot: string): Promise<void> {
      return (store as GameSaveStore<TData>).remove(slot);
    },
    async flush(): Promise<void> {
      if (disposed) {
        // Flush after dispose should still wait for accepted ops, then resolve
        // but spec says flush waits for operations accepted before the call
      }
      if (pendingCount === 0) return;
      await new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
      // Do not cancel accepted writes — they continue via their promises.
      // New work is rejected by the disposed flag.
      // Clear queues to allow GC; pending tails will resolve.
      slotQueues.clear();
    },
  };

  return store;
}
