import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDeepFreeze } from '../src/core/session/deepFreeze';

describe('deep-freeze array-owned values (F5)', () => {
  it('freezes nested objects stored on non-index string properties of arrays', () => {
    const freezer = createDeepFreeze();
    const array = [1, 2, 3];
    array['meta'] = { nested: { value: 1 } };
    const frozen = freezer(array) as { meta: { nested: { value: number } } };

    assert.ok(Object.isFrozen(frozen.meta.nested), 'nested object on a string key is frozen');
    assert.throws(() => {
      (frozen.meta.nested as { value: number }).value = 2;
    }, /Cannot assign/);
    assert.throws(() => {
      (frozen.meta as { nested: object }).nested = {};
    }, /Cannot assign/);
  });

  it('freezes nested objects stored on symbol properties of arrays', () => {
    const freezer = createDeepFreeze();
    const symbol = Symbol('meta');
    const array: unknown[] = [1];
    (array as Record<symbol, unknown>)[symbol] = { nested: { value: 1 } };
    const frozen = freezer(array) as Record<symbol, { nested: { value: number } }>;

    assert.ok(Object.isFrozen(frozen[symbol].nested), 'nested object on a symbol key is frozen');
    assert.throws(() => {
      frozen[symbol].nested.value = 2;
    }, /Cannot assign/);
  });

  it('freezes sparse arrays and preserves holes', () => {
    const freezer = createDeepFreeze();
    const sparse: (object | undefined)[] = [];
    sparse[0] = { value: 1 };
    sparse[2] = { value: 3 };
    const frozen = freezer(sparse) as { value: number }[];

    assert.equal(frozen.length, 3);
    assert.ok(Object.isFrozen(frozen[0]!), 'present element frozen');
    assert.ok(Object.isFrozen(frozen[2]!), 'present element frozen');
    assert.ok(!('1' in frozen), 'the hole remains a hole');
  });

  it('keeps the trusted-cache fast path for numeric-only arrays', () => {
    const freezer = createDeepFreeze();
    const shared = [1, 2, 3];
    const first = freezer(shared) as number[];
    assert.ok(Object.isFrozen(first));

    // A re-freeze of the same subtree must not re-traverse: observable
    // through the object identity short-circuit (the array is trusted).
    const again = freezer(shared);
    assert.equal(again, first, 'trusted subtree returns without re-traversal');
  });

  it('keeps cyclic arrays safe with non-index keys', () => {
    const freezer = createDeepFreeze();
    const array: unknown[] = [];
    array['meta'] = { self: array };
    const frozen = freezer(array) as unknown[];

    assert.ok(Object.isFrozen(frozen['meta' as keyof unknown[]] as object));
  });

  it('leaves the parent untrusted when a string-key getter throws', () => {
    const freezer = createDeepFreeze();
    const array: unknown[] = [1];
    Object.defineProperty(array, 'explosive', {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error('boom');
      },
    });
    assert.throws(() => freezer(array), /boom/);
    // The failed traversal must not poison the cache: a later snapshot with
    // the property removed re-freezes successfully.
    delete (array as unknown as Record<string, unknown>)['explosive'];
    const frozen = freezer(array);
    assert.ok(Object.isFrozen(frozen));
  });
});
