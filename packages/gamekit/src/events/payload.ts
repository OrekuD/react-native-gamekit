import { GameEventError } from './errors';

const MAX_PAYLOAD_NODES = 512;
const MAX_PAYLOAD_DEPTH = 10;
const MAX_PAYLOAD_STRING_LENGTH = 4096;
const MAX_PAYLOAD_ARRAY_LENGTH = 256;

/**
 * Validate, clone, and deeply freeze a payload.
 *
 * Accepted: finite numbers, strings, booleans, `null`, `undefined` (as an
 * optional property value), arrays, and plain records (`Object.prototype`
 * or `Object.create(null)`). Rejected: functions, symbols, bigints,
 * promises/thenables, sparse arrays, class instances, unsafe prototypes,
 * native handles, React elements (`$$typeof`), cycles, and non-finite
 * numbers. Errors are reported with `Event "<name>" payload invalid at
 * <path>`.
 *
 * The clone is frozen deeply so callers cannot mutate the staged envelope.
 */
export function cloneAndValidatePayload(
  payload: unknown,
  eventName: string,
  basePath = 'payload',
): unknown {
  const seen = new WeakSet<object>();
  let nodeCount = 0;

  const fail = (path: string, reason: string): never => {
    throw new GameEventError(`Event "${eventName}" payload invalid at ${path}: ${reason}`);
  };

  const isPlainRecord = (value: object): boolean => {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const isReactElement = (value: object): boolean => {
    return '$$typeof' in value;
  };

  const clone = (value: unknown, path: string, depth: number): unknown => {
    if (depth > MAX_PAYLOAD_DEPTH) {
      fail(path, `exceeds maximum depth of ${MAX_PAYLOAD_DEPTH}`);
    }
    nodeCount += 1;
    if (nodeCount > MAX_PAYLOAD_NODES) {
      fail(path, `exceeds maximum payload size of ${MAX_PAYLOAD_NODES} nodes`);
    }

    if (value === null || value === undefined) {
      return value;
    }
    const type = typeof value;
    if (type === 'string') {
      const str = value as string;
      if (str.length > MAX_PAYLOAD_STRING_LENGTH) {
        fail(path, `string exceeds maximum length of ${MAX_PAYLOAD_STRING_LENGTH}`);
      }
      return str;
    }
    if (type === 'boolean') {
      return value;
    }
    if (type === 'number') {
      const num = value as number;
      if (!Number.isFinite(num)) {
        fail(path, 'number must be finite');
      }
      return num;
    }
    if (type === 'bigint') {
      fail(path, 'bigint is not a supported payload type');
    }
    if (type === 'symbol') {
      fail(path, 'symbol is not a supported payload type');
    }
    if (type === 'function') {
      fail(path, 'function is not a supported payload type');
    }
    if (type !== 'object') {
      // Should be unreachable (numbers/strings/booleans handled), but keep
      // the guard for future JS types.
      fail(path, `unsupported payload type "${type}"`);
    }

    const obj = value as object;
    if (seen.has(obj)) {
      fail(path, 'cycle detected in payload');
    }
    seen.add(obj);

    // Promise / thenable
    if (typeof (obj as Record<string, unknown>).then === 'function') {
      // Reject any thenable — the spec says promises. A plain record with a
      // `then` function field would be caught by the function-value branch
      // for its property, but a top-level Promise or a thenable wrapper
      // must be rejected even before recursing.
      const isThenable =
        obj instanceof Promise ||
        // Detect `{ then: () => {} }` shaped thenables without invoking
        // the property getter (which freezes PATH diagnostics).
        (typeof (obj as { then?: unknown }).then === 'function' &&
          !Array.isArray(obj) &&
          !isPlainRecord(obj));
      if (isThenable) {
        fail(path, 'promise/thenable is not a supported payload type');
      }
    }

    if (isReactElement(obj)) {
      fail(path, 'React element is not a supported payload type');
    }

    if (Array.isArray(obj)) {
      const arr = obj as unknown[];
      if (Object.getPrototypeOf(arr) !== Array.prototype) {
        fail(path, 'array subclass is not a supported payload type');
      }
      if (arr.length > MAX_PAYLOAD_ARRAY_LENGTH) {
        fail(path, `array exceeds maximum length of ${MAX_PAYLOAD_ARRAY_LENGTH}`);
      }
      // Sparse array: a hole has no own property for that index.
      for (let index = 0; index < arr.length; index += 1) {
        if (!(index in arr)) {
          fail(`${path}[${index}]`, 'sparse array holes are not supported');
        }
      }
      const cloned: unknown[] = new Array(arr.length);
      for (let index = 0; index < arr.length; index += 1) {
        cloned[index] = clone(arr[index], `${path}[${index}]`, depth + 1);
      }
      // Check non-index own keys (string and symbol) — arrays may carry
      // extra properties.
      const names = Object.getOwnPropertyNames(arr);
      for (const key of names) {
        if (key === 'length') {
          continue;
        }
        if (/^(0|[1-9]\d*)$/.test(key)) {
          const idx = Number(key);
          if (idx < arr.length && String(idx) === key) {
            continue;
          }
        }
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          fail(`${path}.${key}`, 'unsafe prototype key is not supported');
        }
        fail(`${path}.${key}`, 'array extra property is not a supported payload member');
      }
      const symbols = Object.getOwnPropertySymbols(arr);
      if (symbols.length > 0) {
        fail(`${path}[Symbol]`, 'symbol-keyed property is not supported');
      }
      Object.freeze(cloned);
      return cloned;
    }

    // Plain record
    if (!isPlainRecord(obj)) {
      fail(path, 'only plain records and arrays are supported (class instance, Map, Set, Date, etc. are rejected)');
    }
    const proto = Object.getPrototypeOf(obj);
    // Unsafe prototype check: Object.prototype is allowed; null is allowed;
    // anything else already failed.

    const record = obj as Record<string, unknown>;
    const symbols = Object.getOwnPropertySymbols(record);
    if (symbols.length > 0) {
      fail(`${path}[Symbol]`, 'symbol-keyed property is not supported');
    }
    const cloned: Record<string, unknown> = proto === null ? Object.create(null) : {};
    for (const key of Object.keys(record)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        fail(`${path}.${key}`, 'unsafe prototype key is not supported');
      }
      const valueAtKey = record[key];
      // Detect function values inside records (the `typeof` check above handled
      // top-level functions, but record values need the same guard).
      // `clone` will fail for functions, but we keep the path precise.
      cloned[key] = clone(valueAtKey, `${path}.${key}`, depth + 1);
    }
    Object.freeze(cloned);
    return cloned;
  };

  const result = clone(payload, basePath, 0);
  // Top-level primitives are already validated; freeze is a no-op for them.
  if (typeof result === 'object' && result !== null) {
    // The recursive clone already froze every object/array it created; the
    // top-level container is frozen, but we need to ensure the payload
    // itself is frozen (already is for objects/arrays). Primitives need no freeze.
  }
  return result;
}

export const PAYLOAD_LIMITS = {
  MAX_PAYLOAD_NODES,
  MAX_PAYLOAD_DEPTH,
  MAX_PAYLOAD_STRING_LENGTH,
  MAX_PAYLOAD_ARRAY_LENGTH,
} as const;
