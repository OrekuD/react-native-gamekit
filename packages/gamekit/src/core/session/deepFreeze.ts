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

export interface DeepFreezer {
  <T>(value: T): DeepReadonly<T>;
}

export function createDeepFreeze(): DeepFreezer {
  const trusted = new WeakSet<object>();

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
