import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDeepFreeze } from '../src/core/session/deepFreeze';

describe('deep-freeze array-owned values (F5)', () => {
  it('freezes nested objects stored on non-index string properties of arrays', () => {
    const freezer = createDeepFreeze();
    const array: number[] & { meta?: { nested: { value: number } } } = [1, 2, 3];
    array.meta = { nested: { value: 1 } };
    const frozen = freezer(array) as unknown as { meta: { nested: { value: number } } };

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
    const array = [1] as unknown as Record<symbol, { nested: { value: number } }> & unknown[];
    array[symbol] = { nested: { value: 1 } };
    const frozen = freezer(array) as unknown as Record<symbol, { nested: { value: number } }>;

    const meta = frozen[symbol];
    assert.ok(meta !== undefined);
    assert.ok(Object.isFrozen(meta.nested), 'nested object on a symbol key is frozen');
    assert.throws(() => {
      meta.nested.value = 2;
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
    (array as unknown as Record<string, unknown>)['meta'] = { self: array };
    const frozen = freezer(array) as unknown as Record<string, unknown>;

    const meta = frozen['meta'];
    assert.ok(meta !== undefined);
    assert.ok(Object.isFrozen(meta as object));
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

  it('freezes non-enumerable own string-key values on arrays', () => {
    const freezer = createDeepFreeze();
    const array: unknown[] = [1];
    const nested = { value: 1 };
    Object.defineProperty(array, 'hidden', {
      enumerable: false,
      configurable: true,
      writable: true,
      value: nested,
    });
    const frozen = freezer(array) as unknown as Record<string, { value: number }>;
    assert.ok(frozen['hidden'] !== undefined && Object.isFrozen(frozen['hidden']), 'non-enumerable own value is frozen');
    assert.throws(() => {
      frozen['hidden']!.value = 2;
    }, /Cannot assign/);
  });

  it('never freezes inherited enumerable values through an array', () => {
    const freezer = createDeepFreeze();
    const inherited = { value: 1 };
    const array = [1];
    Object.setPrototypeOf(array, { meta: inherited });
    freezer(array);
    assert.ok(!Object.isFrozen(inherited), 'a shared prototype value must stay mutable');
  });

  it('treats numeric-looking non-index keys as ordinary properties', () => {
    const freezer = createDeepFreeze();
    const array: unknown[] = [1];
    (array as unknown as Record<string, { value: number }>)['1e0'] = { value: 1 };
    (array as unknown as Record<string, { value: number }>)['01'] = { value: 2 };
    (array as unknown as Record<string, { value: number }>)['4294967295'] = { value: 3 };
    const frozen = freezer(array) as unknown as Record<string, { value: number }>;
    assert.ok(frozen['1e0'] !== undefined && Object.isFrozen(frozen['1e0']), "'1e0' is not a canonical index");
    assert.ok(frozen['01'] !== undefined && Object.isFrozen(frozen['01']), "'01' is not a canonical index");
    assert.ok(frozen['4294967295'] !== undefined && Object.isFrozen(frozen['4294967295']), 'the max-array-length key is not an index');
  });
});
