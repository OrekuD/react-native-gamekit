import { GameStorageError, storageError } from './errors';
import type { CreateGameSaveStoreOptions, GameSaveLoadResult, GameSaveStore } from './types';
import { STORAGE_LIMITS } from './types';
import { storageKey, validateNamespace, validateSlot } from './validation';
import { createDefaultData, migratePayload, validateCurrentData } from './schema';
import { cloneAndValidatePlainData, parseEnvelope, serializeEnvelope, STORAGE_ENVELOPE_FORMAT } from './serialization';
import type { StoredGameEnvelope } from './types';

function serializedByteLength(str: string): number {
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') return Buffer.byteLength(str, 'utf8');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  return str.length * 2;
}

export function createGameSaveStore<TData>(options: CreateGameSaveStoreOptions<TData>): GameSaveStore<TData> {
  const schema = options.schema;
  const adapter = options.adapter;
  const namespace = options.namespace;

  validateNamespace(namespace);

  // Per-slot serialized queue: slot -> tail promise. Retained until every accepted operation settles.
  const slotQueues = new Map<string, Promise<void>>();
  // Active operation promises for flush() snapshotting. Each flush gets its own immutable snapshot.
  const active = new Set<Promise<void>>();

  let disposed = false;

  function track<T>(p: Promise<T>): Promise<T> {
    const wrapped = p.finally(() => {
      active.delete(wrapped as unknown as Promise<void>);
    });
    active.add(wrapped as unknown as Promise<void>);
    return wrapped;
  }

  function enqueue<T>(slot: string, op: () => Promise<T>): Promise<T> {
    // Acceptance boundary is the successful public method call; already-accepted ops are never cancelled by later dispose.
    const tail = slotQueues.get(slot) ?? Promise.resolve();
    let resolveTail: () => void = () => {};
    const nextTail = new Promise<void>((res) => {
      resolveTail = res;
    });
    slotQueues.set(slot, nextTail);

    const run = tail
      .catch(() => {
        // Previous failure does not block next; continue
      })
      .then(() => op())
      .finally(() => {
        // Clean only when this tail is still the current tail; otherwise a newer operation has already replaced it.
        if (slotQueues.get(slot) === nextTail) {
          slotQueues.delete(slot);
        }
        resolveTail();
      });

    // Ensure nextTail mirrors run settlement without creating an unhandled rejection.
    run.then(() => {}, () => {});

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

    // F3: measure raw UTF-8 byte length before JSON.parse and reject oversized records.
    const rawBytes = serializedByteLength(raw);
    if (rawBytes > STORAGE_LIMITS.MAX_SERIALIZED_BYTES) {
      throw storageError(`stored record for slot "${slot}" exceeds ${STORAGE_LIMITS.MAX_SERIALIZED_BYTES} bytes (got ${rawBytes})`, 'SIZE_EXCEEDED', {
        operation: 'load',
        namespace,
        slot,
        schemaId: schema.id,
        schemaVersion: schema.version,
        path: 'envelope',
      });
    }

    // Validate loaded bytes as untrusted before migration
    let envelope: StoredGameEnvelope;
    try {
      envelope = parseEnvelope(raw);
    } catch (cause) {
      if (cause instanceof GameStorageError) {
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

    // F3: bounded plain-data validation of the loaded payload BEFORE any migration sees it.
    try {
      cloneAndValidatePlainData(envelope.payload, 'payload');
    } catch (cause) {
      if (cause instanceof GameStorageError) {
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
      throw storageError(`payload validation failed`, 'VALIDATION_FAILED', {
        operation: 'load',
        namespace,
        slot,
        cause,
      });
    }

    // Migrate if needed — each migration receives a deeply frozen engine-owned input and its output is bounded-cloned/frozen.
    let payload: unknown = envelope.payload;
    let fromVersion = envelope.schemaVersion;
    let toVersion = schema.version;
    let migrated = false;
    if (fromVersion !== toVersion) {
      try {
        const result = migratePayload(schema, fromVersion, payload);
        payload = result.data;
        fromVersion = result.fromVersion;
        toVersion = result.toVersion;
        migrated = true;
      } catch (cause) {
        if (cause instanceof GameStorageError) {
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
        throw storageError(`migration failed`, 'MIGRATION_FAILED', {
          operation: 'load',
          namespace,
          slot,
          cause,
        });
      }
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
    return { status: 'stored', data };
  }

  async function saveInternal(slot: string, data: TData): Promise<void> {
    validateSlot(slot);
    // save() already snapshotted and validated outside the queue; this re-validates for safety but is not the acceptance boundary.
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
      // Snapshot the currently tracked operation promises; do not let operations accepted after the call delay this flush.
      const snapshot = Array.from(active);
      if (snapshot.length === 0) return;
      await Promise.allSettled(snapshot);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Do not use generation to suppress already-accepted Promise results.
      // Retain queue/tail ownership until every accepted operation settles; tails clean themselves when still current.
      // New work is rejected at the public boundary above.
    },
  };

  return store;
}
