import { GameStorageError, storageError } from './errors';

const SCHEMA_ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;
const NAMESPACE_RE = /^[a-zA-Z0-9._-]+$/;
const SLOT_RE = /^[a-zA-Z0-9._-]+$/;

export function validateSchemaId(id: string): void {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128 || id.includes('\0')) {
    throw storageError(`schema id must be a non-empty string 1..128 without null bytes`, 'INVALID_SCHEMA_ID', {
      schemaId: String(id),
    });
  }
  if (!SCHEMA_ID_RE.test(id)) {
    throw storageError(`schema id "${id}" must be namespaced (e.g. com.example.game.save)`, 'INVALID_SCHEMA_ID', {
      schemaId: id,
    });
  }
  if (id.startsWith('.') || id.endsWith('.') || id.includes('..')) {
    throw storageError(`schema id "${id}" has invalid dot placement`, 'INVALID_SCHEMA_ID', { schemaId: id });
  }
}

export function validateVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw storageError(`schema version must be a positive safe integer`, 'INVALID_SCHEMA_VERSION', {
      schemaVersion: version,
    });
  }
}

export function validateNamespace(namespace: string): void {
  if (typeof namespace !== 'string' || namespace.length === 0 || namespace.length > 64 || namespace.includes('\0')) {
    throw storageError(`namespace must be a non-empty string 1..64`, 'INVALID_NAMESPACE', { namespace });
  }
  if (!NAMESPACE_RE.test(namespace)) {
    throw storageError(`namespace "${namespace}" contains invalid characters`, 'INVALID_NAMESPACE', { namespace });
  }
}

export function validateSlot(slot: string): void {
  if (typeof slot !== 'string' || slot.length === 0 || slot.length > 64 || slot.includes('\0')) {
    throw storageError(`slot must be a non-empty string 1..64`, 'INVALID_SLOT', { slot });
  }
  if (!SLOT_RE.test(slot)) {
    throw storageError(`slot "${slot}" contains invalid characters`, 'INVALID_SLOT', { slot });
  }
}

export function validateMigrations(
  migrations: Readonly<Record<number, (value: unknown) => unknown>>,
  currentVersion: number,
): void {
  if (migrations === null || typeof migrations !== 'object' || Array.isArray(migrations)) {
    throw new GameStorageError('migrations must be a plain record', { code: 'INVALID_MIGRATION' });
  }
  const proto = Object.getPrototypeOf(migrations);
  if (proto !== Object.prototype && proto !== null) {
    throw new GameStorageError('migrations must be a plain record', { code: 'INVALID_MIGRATION' });
  }
  for (const [rawKey, fn] of Object.entries(migrations)) {
    const n = Number(rawKey);
    if (!Number.isSafeInteger(n) || n < 1 || n >= currentVersion) {
      throw storageError(`migration key "${rawKey}" must be an integer 1..${currentVersion - 1}`, 'INVALID_MIGRATION', {
        path: `migrations.${rawKey}`,
      });
    }
    if (typeof fn !== 'function') {
      throw storageError(`migration ${n} must be a function`, 'INVALID_MIGRATION', { path: `migrations.${n}` });
    }
  }
}

export function storageKey(namespace: string, slot: string): string {
  return `rn-gamekit.storage.${namespace}.${slot}`;
}
