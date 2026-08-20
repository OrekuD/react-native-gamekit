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
 * native handles, React elements (`$$typeof`), cycles, accessors,
 * non-enumerable properties, and non-finite numbers. Errors are reported
 * with `Event "<name>" payload invalid at <path>`.
 *
 * The clone is frozen deeply so callers cannot mutate the staged envelope.
 */
export function cloneAndValidatePayload(
  payload: unknown,
  eventName: string,
  basePath = 'payload',
): unknown {
  let nodeCount = 0;
  // Ancestry set — only the current recursion stack, not the entire visited graph.
  // Shared acyclic references are allowed; true cycles are rejected.
  const ancestry = new WeakSet<object>();

  const fail = (path: string, reason: string): never => {
    throw new GameEventError(`Event "${eventName}" payload invalid at ${path}: ${reason}`);
  };

  const isPlainRecord = (value: object): boolean => {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const isReactElement = (value: object): boolean => {
    // Use descriptor to avoid invoking a getter for $$typeof.
    const desc = Object.getOwnPropertyDescriptor(value, '$$typeof' as unknown as string);
    if (desc !== undefined) {
      return true;
    }
    // Also check prototype chain via `in` without invoking getter? `in` can invoke proxy traps but not getters.
    // For safety, also check `Object.prototype.hasOwnProperty` on the object and its prototype chain via `in`.
    // If the object has a getter for $$typeof on its prototype, `in` will not invoke it, but `'$$typeof' in value` will still
    // check presence without invoking. We use `in` as a fallback that does not execute the getter.
    return '$$typeof' in (value as Record<string, unknown>);
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
      fail(path, `unsupported payload type "${type}"`);
    }

    const obj = value as object;
    if (ancestry.has(obj)) {
      fail(path, 'cycle detected in payload');
    }
    ancestry.add(obj);

    // Use try/finally to ensure ancestry is cleaned even when we throw.
    try {
      // Promise / thenable check without invoking getter if possible.
      // Use descriptor for `then` to avoid executing a getter.
      const thenDesc = Object.getOwnPropertyDescriptor(obj as Record<string, unknown>, 'then' as unknown as string);
      const thenValue = thenDesc ? thenDesc.value : (obj as Record<string, unknown>).then;
      if (typeof thenValue === 'function') {
        const isThenable =
          obj instanceof Promise || (!Array.isArray(obj) && !isPlainRecord(obj));
        if (isThenable) {
          fail(path, 'promise/thenable is not a supported payload type');
        }
        // Plain records with a `then` function are rejected as a function
        // value when that property is cloned, so no top-level failure here.
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

        // Use descriptors to avoid invoking getters and to detect sparse holes.
        const descs = Object.getOwnPropertyDescriptors(arr);
        // Sparse check: every index < length must have an own descriptor.
        for (let index = 0; index < arr.length; index += 1) {
          const key = String(index);
          if (!(key in descs)) {
            fail(`${path}[${index}]`, 'sparse array holes are not supported');
          }
          const d = descs[key]!;
          if (d.get !== undefined || d.set !== undefined) {
            fail(`${path}[${index}]`, 'accessor property is not supported');
          }
          if (d.enumerable === false) {
            fail(`${path}[${index}]`, 'non-enumerable property is not supported');
          }
        }

        // Clone indices via descriptors to avoid getter invocation.
        const cloned: unknown[] = new Array(arr.length);
        for (let index = 0; index < arr.length; index += 1) {
          const key = String(index);
          const d = descs[key]!;
          cloned[index] = clone(d.value, `${path}[${index}]`, depth + 1);
        }

        // Check for non-index own properties (including symbols).
        for (const key of Reflect.ownKeys(descs) as (string | symbol)[]) {
          if (typeof key === 'symbol') {
            fail(`${path}[Symbol(${String(key).slice(7, -1)})]`, 'symbol-keyed property is not supported');
          }
          const k = key as string;
          if (k === 'length') {
            continue;
          }
          // Indices already handled.
          if (/^(0|[1-9]\d*)$/.test(k)) {
            const idx = Number(k);
            if (idx < arr.length && String(idx) === k) {
              continue;
            }
          }
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
            fail(`${path}.${k}`, 'unsafe prototype key is not supported');
          }
          const d = descs[k]!;
          if (d.get !== undefined || d.set !== undefined) {
            fail(`${path}.${k}`, 'accessor property is not supported');
          }
          if (d.enumerable === false) {
            fail(`${path}.${k}`, 'non-enumerable property is not supported');
          }
          fail(`${path}.${k}`, 'array extra property is not a supported payload member');
        }

        Object.freeze(cloned);
        return cloned;
      }

      // Plain record
      if (!isPlainRecord(obj)) {
        fail(path, 'only plain records and arrays are supported (class instance, Map, Set, Date, etc. are rejected)');
      }
      const proto = Object.getPrototypeOf(obj);

      const descs = Object.getOwnPropertyDescriptors(obj);
      // Check for symbol keys and unsafe keys, and validate descriptors.
      for (const key of Reflect.ownKeys(descs) as (string | symbol)[]) {
        if (typeof key === 'symbol') {
          fail(`${path}[Symbol(${String(key).slice(7, -1)})]`, 'symbol-keyed property is not supported');
        }
        const k = key as string;
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
          fail(`${path}.${k}`, 'unsafe prototype key is not supported');
        }
        const d = descs[k]!;
        if (d.get !== undefined || d.set !== undefined) {
          fail(`${path}.${k}`, 'accessor property is not supported');
        }
        if (d.enumerable === false) {
          fail(`${path}.${k}`, 'non-enumerable property is not supported');
        }
      }

      const cloned: Record<string, unknown> = proto === null ? Object.create(null) : {};
      for (const key of Object.keys(descs)) {
        // `Object.keys` already filters to enumerable string keys, but we have already validated
        // via `getOwnPropertyDescriptors` that all own keys are enumerable data properties.
        // Use descriptor value without invoking getter (we already checked it's a data descriptor).
        const d = descs[key]!;
        cloned[key] = clone(d.value, `${path}.${key}`, depth + 1);
      }
      Object.freeze(cloned);
      return cloned;
    } finally {
      ancestry.delete(obj);
    }
  };

  const result = clone(payload, basePath, 0);
  return result;
}

export const PAYLOAD_LIMITS = {
  MAX_PAYLOAD_NODES,
  MAX_PAYLOAD_DEPTH,
  MAX_PAYLOAD_STRING_LENGTH,
  MAX_PAYLOAD_ARRAY_LENGTH,
} as const;
