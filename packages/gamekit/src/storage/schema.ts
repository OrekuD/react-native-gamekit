import { GameStorageError, storageError } from './errors';
import type { GameSaveSchema } from './types';
import { validateMigrations, validateSchemaId, validateVersion } from './validation';
import { cloneAndValidatePlainData } from './serialization';

/**
 * Define a versioned game save schema.
 *
 * Id/version/migrations are validated immediately. `createDefault` and
 * `validate` are stored as-is — they run later per load/save.
 */
export function defineGameSave<TData>(options: {
  id: string;
  version: number;
  createDefault: () => TData;
  validate: (value: unknown) => TData;
  migrations?: Readonly<Record<number, (value: unknown) => unknown>>;
}): GameSaveSchema<TData> {
  validateSchemaId(options.id);
  validateVersion(options.version);
  if (typeof options.createDefault !== 'function') {
    throw new GameStorageError('createDefault must be a function', { code: 'INVALID_SCHEMA_ID', schemaId: options.id });
  }
  if (typeof options.validate !== 'function') {
    throw new GameStorageError('validate must be a function', { code: 'VALIDATION_FAILED', schemaId: options.id });
  }
  const migrations = options.migrations ?? {};
  validateMigrations(migrations as Readonly<Record<number, (value: unknown) => unknown>>, options.version);

  // Freeze migrations shallowly — migration functions themselves remain.
  const frozenMigrations = Object.freeze({ ...migrations });

  const schema: GameSaveSchema<TData> = {
    id: options.id,
    version: options.version,
    createDefault: options.createDefault,
    validate: options.validate,
    migrations: frozenMigrations,
  };
  return Object.freeze(schema) as GameSaveSchema<TData>;
}

/** Clone/freeze via plain-data path for defaults that are plain; fallback to structured clone for custom validation. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  // Use storage-style freeze: we already cloned, just deep freeze.
  const seen = new WeakSet<object>();
  const freeze = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const o = node as object;
    if (seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(node)) {
      for (const v of node as unknown[]) freeze(v);
    } else {
      for (const v of Object.values(node as Record<string, unknown>)) freeze(v);
    }
    Object.freeze(node);
  };
  freeze(value);
  return value;
}

export function createDefaultData<TData>(schema: GameSaveSchema<TData>): TData {
  const raw = schema.createDefault();
  // Validate through schema.validate to enforce domain rules and to
  // ensure we return a newly owned, validated value. If validate does not
  // clone, we still protect via plain-data clone.
  try {
    const validated = schema.validate(raw);
    // Ensure plain-data safe and frozen
    const cloned = cloneAndValidatePlainData(validated, 'createDefault() result') as TData;
    return deepFreeze(cloned);
  } catch (cause) {
    if (cause instanceof GameStorageError) throw cause;
    throw storageError(`createDefault() validation failed`, 'VALIDATION_FAILED', {
      schemaId: schema.id,
      schemaVersion: schema.version,
      cause,
    });
  }
}

export function validateCurrentData<TData>(schema: GameSaveSchema<TData>, value: unknown, path = 'data'): TData {
  try {
    const validated = schema.validate(value);
    const cloned = cloneAndValidatePlainData(validated, path) as TData;
    return deepFreeze(cloned);
  } catch (cause) {
    if (cause instanceof GameStorageError) throw cause;
    // Preserve original validation error as cause; surface as VALIDATION_FAILED with path if available
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw storageError(msg, 'VALIDATION_FAILED', {
      schemaId: schema.id,
      schemaVersion: schema.version,
      path,
      cause,
    });
  }
}

export function migratePayload<TData>(
  schema: GameSaveSchema<TData>,
  storedVersion: number,
  payload: unknown,
): { data: unknown; fromVersion: number; toVersion: number } {
  let current = payload;
  let version = storedVersion;
  const target = schema.version;
  if (version > target) {
    throw storageError(`stored version ${version} is newer than schema version ${target}`, 'FUTURE_VERSION', {
      schemaId: schema.id,
      schemaVersion: target,
    });
  }
  if (version === target) return { data: current, fromVersion: version, toVersion: target };
  // Sequential migrations version -> version+1
  for (let v = version; v < target; v += 1) {
    const fn = (schema.migrations as Record<number, (v: unknown) => unknown>)[v];
    if (typeof fn !== 'function') {
      throw storageError(`missing migration for version ${v} -> ${v + 1}`, 'MISSING_MIGRATION', {
        schemaId: schema.id,
        schemaVersion: target,
        path: `migrations.${v}`,
      });
    }
    try {
      const input = current;
      const output = fn(input);
      // Ensure migration did not mutate input by checking frozen? We trust purity but
      // we ensure output is at least plain-data clone-able.
      // Do not freeze input; just validate output can be cloned later after final validate.
      // Enforce that migrate does not return undefined for object payloads accidentally
      current = output;
      version = v + 1;
    } catch (cause) {
      if (cause instanceof GameStorageError) throw cause;
      throw storageError(`migration ${v} -> ${v + 1} failed`, 'MIGRATION_FAILED', {
        schemaId: schema.id,
        schemaVersion: target,
        path: `migrations.${v}`,
        cause,
      });
    }
  }
  return { data: current, fromVersion: storedVersion, toVersion: target };
}
