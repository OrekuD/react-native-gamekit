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
 * - Nodes become trusted only after the entire traversal succeeds. A
 *   completed child can point back to an unfinished ancestor through a
 *   cycle, so even completed children remain untrusted on failure.
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
 * Own accessors are rejected without invocation: their future results and
 * setter side effects cannot be secured by Object.freeze.
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

export function createDeepFreeze(): DeepFreezer {
  const trusted = new WeakSet<object>();

  return function deepFreeze<T>(value: T, context?: SnapshotFreezeContext): DeepReadonly<T> {
    // The common unchanged-root path needs no traversal allocations.
    if (typeof value === 'object' && value !== null && trusted.has(value)) {
      return value as DeepReadonly<T>;
    }
    const path: (string | number | symbol)[] = [];
    const reject = (node: unknown): never => {
      throw new SnapshotDomainError(formatPath(path), describeUnsupported(node), context?.scene);
    };
    const visiting = new Set<object>();
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
      const array = Array.isArray(node);
      if (!array && !isPlainRecord(node)) {
        reject(node);
      }
      visiting.add(node);
      // Walk owned keys once. Sparse-array holes and inherited properties
      // are not snapshot data; array length must never set the work bound.
      for (const key of Reflect.ownKeys(node)) {
        if (array && key === 'length') {
          continue;
        }
        path.push(array && typeof key === 'string' && isArrayIndexKey(key) ? Number(key) : key);
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (descriptor && !('value' in descriptor)) {
          // Freezing an accessor does not freeze the values it can produce
          // or prevent its setter from changing state outside the snapshot.
          throw new SnapshotDomainError(
            formatPath(path),
            'accessor properties are not supported; project their values into data properties',
            context?.scene,
          );
        }
        freeze((node as Record<PropertyKey, unknown>)[key]);
        path.pop();
      }
      Object.freeze(node);
    };
    freeze(value);
    // Publication is all-or-nothing, including trust. A partially frozen
    // cycle from a failed traversal must be validated again on the next call.
    for (const node of visiting) {
      trusted.add(node);
    }
    return value as DeepReadonly<T>;
  };
}
