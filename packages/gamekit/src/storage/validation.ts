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
  // GS-STORAGE-01: length-prefixed tuple — dots, slashes, and colons
  // inside names can never collide across pairs. Format-versioned so
  // future schemes route without guessing.
  return `rn-gamekit.storage/v2/${namespace.length}:${namespace}/${slot.length}:${slot}`;
}

/**
 * Recovery/compatibility policy (GS-STORAGE-01, preview release):
 *
 * - Writes go to v2 keys only. Reads try v2, then fall back to the legacy
 *   dotted key, so pre-upgrade records load without any rewrite.
 * - The first v2 save for a slot lazily migrates it; no blanket rewrite
 *   ever runs, and legacy records are never deleted after an ambiguous
 *   read (a legacy key cannot identify which pair wrote it).
 * - `remove` deletes both the v2 and legacy keys. Under v1, colliding
 *   pairs already shared one record (shared fate on delete); v2 converges
 *   to independence as each pair saves. A pair that never saves under v2
 *   keeps reading its legacy record until it does.
 * - A legacy collision (`('game.a','b')` vs `('game','a.b')`) cannot be
 *   disambiguated from the key alone: both pairs read the same heritage
 *   record, exactly as v1 behaved. New writes never collide.
 */
export function legacyStorageKey(namespace: string, slot: string): string {
  return `rn-gamekit.storage.${namespace}.${slot}`;
}
