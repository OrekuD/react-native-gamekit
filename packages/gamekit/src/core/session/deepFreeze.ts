/**
 * Trusted deep-freeze cache (T3).
 *
 * Each session owns one freezer. A subtree that has been completely frozen
 * once is recorded in a `WeakSet` and never re-traversed: structurally
 * shared snapshot subtrees (the common case: unchanged bricks, entities,
 * or config objects reused by reference across ticks) are walked exactly
 * once for the lifetime of the session.
 *
 * Correctness rules:
 * - A node is promoted into the trusted set **only after** its whole
 *   subtree finished freezing. A child getter that throws mid-traversal
 *   leaves every ancestor untrusted, so a later snapshot re-walks it.
 * - Cycle detection uses a separate per-traversal `visiting` set, never the
 *   trusted set, so cycles freeze exactly once without infinite recursion.
 * - `Object.isFrozen` is never used as a skip test: an externally
 *   shallow-frozen object can contain mutable children and must still be
 *   recursed into.
 * - Freezing is never dev-only: the public API promise of deeply immutable
 *   snapshots holds in every build.
 */

import type { DeepReadonly } from './types';

/**
 * Supported snapshot domain (GS-SCENE-03): plain records
 * (`Object.prototype` or `null` prototype), arrays, and scalar values.
 * Everything else — functions, symbols, bigints, and class instances
 * (Map, Set, Date, typed arrays, custom classes, …) — is rejected at the
 * publication boundary because freezing cannot secure it (`Object.freeze`
 * on a Map does not freeze its entries; a frozen function stays callable).
 */
export class SnapshotDomainError extends Error {
  /** Dot/bracket path from the snapshot root to the offending value. */
  readonly path: string;
  /** The scene whose snapshot was rejected, when the session supplied it. */
  readonly scene?: string;
  constructor(path: string, detail: string, scene?: string) {
    super(
      `Unsupported snapshot value at ${path}: ${detail}${
        scene === undefined ? '' : ` (scene "${scene}")`
      }. Snapshots must contain only plain records, arrays, and scalar values.`,
    );
    this.name = 'SnapshotDomainError';
    this.path = path;
    if (scene !== undefined) {
      this.scene = scene;
    }
  }
}

/** Context the session attaches so rejections name the offending scene. */
export interface SnapshotFreezeContext {
  readonly scene?: string;
  readonly tick?: number;
}

/** Whether a string is a canonical array index (`0 <= i < 2^32 - 1`). */
/** Decimal digit count of a non-negative integer (0 <= value < 1e11). */
function digitLength(value: number): number {
  'worklet';
  if (value < 10) {
    return 1;
  }
  if (value < 100) {
    return 2;
  }
  if (value < 1_000) {
    return 3;
  }
  if (value < 10_000) {
    return 4;
  }
  if (value < 100_000) {
    return 5;
  }
  if (value < 1_000_000) {
    return 6;
  }
  if (value < 10_000_000) {
    return 7;
  }
  if (value < 100_000_000) {
    return 8;
  }
  if (value < 1_000_000_000) {
    return 9;
  }
  return 10;
}

function isArrayIndexKey(key: string): boolean {
  'worklet';
  // A canonical array index is the exact decimal form of an integer in
  // [0, 2^32 - 2]; numeric-looking strings such as '1e0', '01', or
  // '4294967295' are ordinary properties, not indices. The check is
  // allocation-free: a digit scan plus the leading-zero rule.
  const length = key.length;
  if (length === 0 || length > 10) {
    return false;
  }
  if (length > 1 && key.charCodeAt(0) === 48 /* '0' */) {
    return false;
  }
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    const code = key.charCodeAt(index);
    if (code < 48 /* '0' */ || code > 57 /* '9' */) {
      return false;
    }
    value = value * 10 + (code - 48);
  }
  return value <= 0xffffffff - 1;
}

/** Whether a value is a plain record (`Object.prototype` or `null` prototype). */
function isPlainRecord(node: object): boolean {
  const prototype = Object.getPrototypeOf(node);
  return prototype === Object.prototype || prototype === null;
}

/** Name an unsupported value for an actionable rejection message. */
function describeUnsupported(node: unknown): string {
  if (typeof node === 'function') {
    return 'functions are not part of the snapshot domain';
  }
  if (typeof node === 'symbol') {
    return 'symbols are not part of the snapshot domain';
  }
  if (typeof node === 'bigint') {
    return 'bigints are not part of the snapshot domain';
  }
  const name =
    typeof node === 'object' && node !== null
      ? (node as { constructor?: { name?: unknown } }).constructor?.name
      : undefined;
  const label = typeof name === 'string' && name !== '' ? `${name} instances` : 'class instances';
  return `${label} are not part of the snapshot domain (only plain records and arrays are supported)`;
}

/** Format a key-path segment stack as `a.b[0]` (root renders `<root>`). */
function formatPath(path: readonly (string | number | symbol)[]): string {
  if (path.length === 0) {
    return '<root>';
  }
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (typeof segment === 'symbol') {
      out += `[${String(segment)}]`;
    } else if (out === '') {
      out = segment;
    } else {
      out += `.${segment}`;
    }
  }
  return out;
}

export interface DeepFreezer {
  <T>(value: T, context?: SnapshotFreezeContext): DeepReadonly<T>;
}

export function createDeepFreeze(): DeepFreezer {  const trusted = new WeakSet<object>();

  return function deepFreeze<T>(value: T, context?: SnapshotFreezeContext): DeepReadonly<T> {
    // Key path from the snapshot root, maintained as a segment stack and
    // formatted only when a rejection needs it. try/finally is unnecessary:
    // a throw abandons the traversal, and the stack is per call.
    const path: (string | number | symbol)[] = [];
    const reject = (node: unknown): never => {
      throw new SnapshotDomainError(formatPath(path), describeUnsupported(node), context?.scene);
    };
    if (typeof value !== 'object' || value === null) {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        reject(value);
      }
      return value as DeepReadonly<T>;
    }
    const visiting = new WeakSet<object>();
    const freeze = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) {
        if (typeof node === 'function' || typeof node === 'symbol' || typeof node === 'bigint') {
          reject(node);
        }
        return;
      }
      if (trusted.has(node) || visiting.has(node)) {
        return;
      }
      visiting.add(node);
      if (Array.isArray(node)) {
        // Index fast path: avoids materialising an index-key array per array.
        for (let index = 0; index < node.length; index += 1) {
          path.push(index);
          freeze(node[index]);
          path.pop();
        }
        // F5: legal JavaScript arrays may also carry values on non-index
        // string keys and symbol keys. Only own keys are reachable snapshot
        // values, so the scan uses getOwnPropertyNames (own string keys,
        // enumerable and non-enumerable, no inherited keys) plus
        // getOwnPropertySymbols — `for-in` was rejected because it yields
        // inherited enumerable keys and skips non-enumerable own keys. The
        // name array allocation is the documented cost of full correctness;
        // canonical indices and `length` are skipped with an arithmetic
        // check, and every remaining own value is frozen before the array is
        // promoted into the trusted set.
        const names = Object.getOwnPropertyNames(node);
        // getOwnPropertyNames yields canonical indices first, in ascending
        // order, then 'length', then any extra string keys in insertion
        // order — so a dense array's indices take one Number() compare each
        // and only extras reach the canonical-form check.
        let expectedIndex = 0;
        for (let index = 0; index < names.length; index += 1) {
          const name = names[index];
          if (name === undefined || name === 'length') {
            continue;
          }
          // Fast discriminator: a canonical ascending index must match the
          // expected value AND carry its exact decimal length — '01', '1e0',
          // or '4294967295' cannot pass the length guard and fall through
          // to the canonical check.
          if (Number(name) === expectedIndex && name.length === digitLength(expectedIndex)) {
            expectedIndex += 1;
            continue;
          }
          if (!isArrayIndexKey(name)) {
            path.push(name);
            freeze((node as unknown as Record<PropertyKey, unknown>)[name]);
            path.pop();
          }
        }
        const symbols = Object.getOwnPropertySymbols(node);
        for (let index = 0; index < symbols.length; index += 1) {
          const symbol = symbols[index];
          if (symbol !== undefined) {
            path.push(symbol);
            freeze((node as unknown as Record<PropertyKey, unknown>)[symbol]);
            path.pop();
          }
        }
      } else if (isPlainRecord(node)) {
        for (const key of Reflect.ownKeys(node)) {
          path.push(key);
          freeze((node as Record<PropertyKey, unknown>)[key]);
          path.pop();
        }
      } else {
        reject(node);
      }
      Object.freeze(node);
      trusted.add(node);
    };
    freeze(value as object);
    return value as DeepReadonly<T>;
  };
}
