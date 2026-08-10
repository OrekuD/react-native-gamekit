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
function isArrayIndexKey(key: string): boolean {
  'worklet';
  if (key === '0') {
    return true;
  }
  const length = key.length;
  if (length === 0 || length > 10 || key.charCodeAt(0) === 48 /* '0' */) {
    return false; // empty, too long, or a leading-zero string
  }
  const numeric = Number(key);
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 0xffffffff - 1;
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
        // string keys and symbol keys. `for-in` enumerates own string keys
        // (indices first, in ascending order, then extra string keys in
        // insertion order) without materialising a key array, so the
        // trusted-cache fast path stays allocation-free for numeric-only
        // arrays. Dense arrays take a two-op fast discriminator per key
        // (`Number(key) === expected`); sparse or decorated arrays fall
        // through to the full canonical-index check. Symbols are never
        // yielded by `for-in`, so they get their own probe.
        let expectedIndex = 0;
        for (const key in node) {
          if (Number(key) === expectedIndex) {
            expectedIndex += 1;
            continue;
          }
          if (!isArrayIndexKey(key)) {
            freeze((node as Record<PropertyKey, unknown>)[key]);
          }
        }
        const symbols = Object.getOwnPropertySymbols(node);
        for (let index = 0; index < symbols.length; index += 1) {
          freeze((node as Record<PropertyKey, unknown>)[symbols[index]]);
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
