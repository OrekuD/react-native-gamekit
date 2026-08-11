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

export interface DeepFreezer {
  <T>(value: T): DeepReadonly<T>;
}

export function createDeepFreeze(): DeepFreezer {  const trusted = new WeakSet<object>();

  return function deepFreeze<T>(value: T): DeepReadonly<T> {
    if (typeof value !== 'object' || value === null) {
      return value as DeepReadonly<T>;
    }
    const visiting = new WeakSet<object>();
    const freeze = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) {
        return;
      }
      if (trusted.has(node) || visiting.has(node)) {
        return;
      }
      visiting.add(node);
      if (Array.isArray(node)) {
        // Index fast path: avoids materialising an index-key array per array.
        for (let index = 0; index < node.length; index += 1) {
          freeze(node[index]);
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
            freeze((node as unknown as Record<PropertyKey, unknown>)[name]);
          }
        }
        const symbols = Object.getOwnPropertySymbols(node);
        for (let index = 0; index < symbols.length; index += 1) {
          const symbol = symbols[index];
          if (symbol !== undefined) {
            freeze((node as unknown as Record<PropertyKey, unknown>)[symbol]);
          }
        }
      } else {
        for (const key of Reflect.ownKeys(node)) {
          freeze((node as Record<PropertyKey, unknown>)[key]);
        }
      }
      Object.freeze(node);
      trusted.add(node);
    };
    freeze(value as object);
    return value as DeepReadonly<T>;
  };
}
