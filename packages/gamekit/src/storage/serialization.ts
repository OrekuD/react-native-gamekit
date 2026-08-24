import type { GameStorageError } from './errors';
import { storageError } from './errors';
import { STORAGE_LIMITS, type StoredGameEnvelope } from './types';

const ENVELOPE_FORMAT = 'rn-gamekit.save' as const;

/**
 * Bounded plain-data clone + validation for storage payloads.
 *
 * Mirrors the strictness of event payloads but with storage-sized limits.
 * Rejects: functions, symbols, bigint, non-finite numbers, cycles,
 * sparse holes, accessors, non-enumerable, unsafe prototype keys,
 * array subclasses, class instances, React elements, thenables.
 */
export function cloneAndValidatePlainData(value: unknown, basePath = 'payload'): unknown {
  let nodeCount = 0;
  const ancestry = new WeakSet<object>();

  const fail = (path: string, reason: string, code: GameStorageError['code'] = 'UNSUPPORTED_VALUE'): never => {
    // Depth/size specific codes where useful
    if (reason.includes('maximum depth')) {
      throw storageError(`storage payload invalid at ${path}: ${reason}`, 'DEPTH_EXCEEDED', { path });
    }
    if (reason.includes('maximum payload size') || reason.includes('maximum serialized bytes') || reason.includes('exceeds maximum')) {
      // Let caller turn size failures into SIZE_EXCEEDED where appropriate
      if (reason.includes('nodes') || reason.includes('array') || reason.includes('object fields') || reason.includes('string')) {
        throw storageError(`storage payload invalid at ${path}: ${reason}`, 'SIZE_EXCEEDED', { path });
      }
    }
    throw storageError(`storage payload invalid at ${path}: ${reason}`, code, { path });
  };

  const isPlainRecord = (v: object): boolean => {
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };

  const isReactElement = (v: object): boolean => {
    const desc = Object.getOwnPropertyDescriptor(v as Record<string, unknown>, '$$typeof' as unknown as string);
    if (desc !== undefined) return true;
    return '$$typeof' in (v as Record<string, unknown>);
  };

  const clone = (val: unknown, path: string, depth: number): unknown => {
    if (depth > STORAGE_LIMITS.MAX_DEPTH) {
      fail(path, `exceeds maximum depth of ${STORAGE_LIMITS.MAX_DEPTH}`);
    }
    nodeCount += 1;
    if (nodeCount > STORAGE_LIMITS.MAX_NODES) {
      fail(path, `exceeds maximum payload size of ${STORAGE_LIMITS.MAX_NODES} nodes`);
    }

    if (val === null) return null;
    const t = typeof val;
    if (t === 'string') {
      const s = val as string;
      if (s.length > STORAGE_LIMITS.MAX_STRING_LENGTH) {
        fail(path, `string exceeds maximum length of ${STORAGE_LIMITS.MAX_STRING_LENGTH}`);
      }
      return s;
    }
    if (t === 'boolean') return val;
    if (t === 'number') {
      const n = val as number;
      if (!Number.isFinite(n)) fail(path, 'number must be finite');
      return n;
    }
    if (t === 'bigint') fail(path, 'bigint is not a supported storage type');
    if (t === 'symbol') fail(path, 'symbol is not a supported storage type');
    if (t === 'function') fail(path, 'function is not a supported storage type');
    if (t === 'undefined') fail(path, 'undefined is not a supported storage type (use null)');
    if (t !== 'object') fail(path, `unsupported storage type "${t}"`);

    const obj = val as object;
    if (ancestry.has(obj)) fail(path, 'cycle detected in payload');
    ancestry.add(obj);
    try {
      const thenDesc = Object.getOwnPropertyDescriptor(obj as Record<string, unknown>, 'then' as unknown as string);
      const thenValue = thenDesc ? thenDesc.value : (obj as Record<string, unknown>).then;
      if (typeof thenValue === 'function') {
        const isThenable = obj instanceof Promise || (!Array.isArray(obj) && !isPlainRecord(obj));
        if (isThenable) fail(path, 'promise/thenable is not a supported storage type');
      }
      if (isReactElement(obj)) fail(path, 'React element is not a supported storage type');

      if (Array.isArray(obj)) {
        const arr = obj as unknown[];
        if (Object.getPrototypeOf(arr) !== Array.prototype) fail(path, 'array subclass is not a supported storage type');
        if (arr.length > STORAGE_LIMITS.MAX_ARRAY_LENGTH) fail(path, `array exceeds maximum length of ${STORAGE_LIMITS.MAX_ARRAY_LENGTH}`);
        const descs = Object.getOwnPropertyDescriptors(arr);
        for (let i = 0; i < arr.length; i += 1) {
          const key = String(i);
          if (!(key in descs)) fail(`${path}[${i}]`, 'sparse array holes are not supported');
          const d = descs[key]!;
          if (d.get !== undefined || d.set !== undefined) fail(`${path}[${i}]`, 'accessor property is not supported');
          if (d.enumerable === false) fail(`${path}[${i}]`, 'non-enumerable property is not supported');
        }
        const cloned: unknown[] = new Array(arr.length);
        for (let i = 0; i < arr.length; i += 1) {
          const key = String(i);
          const d = descs[key]!;
          cloned[i] = clone(d.value, `${path}[${i}]`, depth + 1);
        }
        for (const key of Reflect.ownKeys(descs) as (string | symbol)[]) {
          if (typeof key === 'symbol') fail(`${path}[Symbol(${String(key).slice(7, -1)})]`, 'symbol-keyed property is not supported');
          const k = key as string;
          if (k === 'length') continue;
          if (/^(0|[1-9]\d*)$/.test(k)) {
            const idx = Number(k);
            if (idx < arr.length && String(idx) === k) continue;
          }
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') fail(`${path}.${k}`, 'unsafe prototype key is not supported');
          const d = descs[k]!;
          if (d.get !== undefined || d.set !== undefined) fail(`${path}.${k}`, 'accessor property is not supported');
          if (d.enumerable === false) fail(`${path}.${k}`, 'non-enumerable property is not supported');
          fail(`${path}.${k}`, 'array extra property is not a supported storage member');
        }
        Object.freeze(cloned);
        return cloned;
      }

      if (!isPlainRecord(obj)) fail(path, 'only plain records and arrays are supported (class instance, Map, Set, Date, etc. are rejected)');

      const proto = Object.getPrototypeOf(obj);
      const descs = Object.getOwnPropertyDescriptors(obj);
      const keys = Object.keys(descs);
      if (keys.length > STORAGE_LIMITS.MAX_OBJECT_FIELDS) {
        fail(path, `object exceeds maximum field count of ${STORAGE_LIMITS.MAX_OBJECT_FIELDS}`);
      }
      for (const key of Reflect.ownKeys(descs) as (string | symbol)[]) {
        if (typeof key === 'symbol') fail(`${path}[Symbol(${String(key).slice(7, -1)})]`, 'symbol-keyed property is not supported');
        const k = key as string;
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') fail(`${path}.${k}`, 'unsafe prototype key is not supported');
        const d = descs[k]!;
        if (d.get !== undefined || d.set !== undefined) fail(`${path}.${k}`, 'accessor property is not supported');
        if (d.enumerable === false) fail(`${path}.${k}`, 'non-enumerable property is not supported');
      }
      const cloned: Record<string, unknown> = proto === null ? Object.create(null) : {};
      for (const key of keys) {
        const d = descs[key]!;
        cloned[key] = clone(d.value, `${path}.${key}`, depth + 1);
      }
      Object.freeze(cloned);
      return cloned;
    } finally {
      ancestry.delete(obj);
    }
  };

  const result = clone(value, basePath, 0);
  return result;
}

function serializedByteLength(str: string): number {
  // Use Buffer if available (Node), otherwise TextEncoder
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(str, 'utf8');
  }
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  // Fallback: approximate as UTF-16 length * ~2
  return str.length * 2;
}

export function serializeEnvelope(envelope: StoredGameEnvelope): string {
  // Validate payload plain-data first
  cloneAndValidatePlainData(envelope.payload, 'payload');
  // Envelope itself is plain, but we validate its shape before stringify
  if (envelope.format !== ENVELOPE_FORMAT) {
    throw storageError(`envelope format must be "${ENVELOPE_FORMAT}"`, 'CORRUPT_ENVELOPE', { path: 'format' });
  }
  const json = JSON.stringify(envelope);
  const bytes = serializedByteLength(json);
  if (bytes > STORAGE_LIMITS.MAX_SERIALIZED_BYTES) {
    throw storageError(`serialized envelope exceeds ${STORAGE_LIMITS.MAX_SERIALIZED_BYTES} bytes (got ${bytes})`, 'SIZE_EXCEEDED', {
      path: 'envelope',
    });
  }
  return json;
}

export function parseEnvelope(raw: string): StoredGameEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw storageError(`corrupt envelope: JSON parse failed`, 'CORRUPT_ENVELOPE', { cause });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw storageError(`corrupt envelope: expected object`, 'CORRUPT_ENVELOPE');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== ENVELOPE_FORMAT) {
    throw storageError(`corrupt envelope: expected format "${ENVELOPE_FORMAT}"`, 'CORRUPT_ENVELOPE', {
      path: 'format',
    });
  }
  if (typeof obj.schemaId !== 'string') {
    throw storageError(`corrupt envelope: schemaId must be string`, 'CORRUPT_ENVELOPE', { path: 'schemaId' });
  }
  if (!Number.isSafeInteger(obj.schemaVersion)) {
    throw storageError(`corrupt envelope: schemaVersion must be integer`, 'CORRUPT_ENVELOPE', {
      path: 'schemaVersion',
    });
  }
  if (typeof obj.savedAtMs !== 'number' || !Number.isFinite(obj.savedAtMs)) {
    throw storageError(`corrupt envelope: savedAtMs must be finite number`, 'CORRUPT_ENVELOPE', {
      path: 'savedAtMs',
    });
  }
  if (!('payload' in obj)) {
    throw storageError(`corrupt envelope: missing payload`, 'CORRUPT_ENVELOPE', { path: 'payload' });
  }
  return obj as unknown as StoredGameEnvelope;
}

export const STORAGE_ENVELOPE_FORMAT = ENVELOPE_FORMAT;
