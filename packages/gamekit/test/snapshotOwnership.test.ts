import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDeepFreeze, SnapshotDomainError } from '../src/core/session/deepFreeze';

describe('snapshot ownership boundary', () => {
  it('does not trust any part of a cycle when its root fails validation', () => {
    const freeze = createDeepFreeze();
    const parent: Record<string, unknown> = {};
    const child = { parent };
    parent['child'] = child;
    parent['invalid'] = () => undefined;
    assert.throws(() => freeze(parent), SnapshotDomainError);
    assert.ok(Object.isFrozen(child), 'completed children may already be frozen');
    assert.ok(!Object.isFrozen(parent));
    assert.throws(() => freeze(child), SnapshotDomainError);
    delete parent['invalid'];
    freeze(child);
    assert.ok(Object.isFrozen(parent), 'retry must traverse the entire cycle');
  });

  it('does not trust a completed child if freezing a cyclic ancestor throws', () => {
    const freeze = createDeepFreeze();
    let fail = true;
    const target: Record<string, unknown> = {};
    const parent = new Proxy(target, {
      preventExtensions(object) {
        if (fail) throw new Error('freeze failed');
        return Reflect.preventExtensions(object);
      },
    });
    const child = { parent };
    target['child'] = child;
    assert.throws(() => freeze(parent), /freeze failed/);
    fail = false;
    freeze(child);
    assert.ok(Object.isFrozen(parent));
  });

  for (const [length, key] of [[0, ' '], [100, '1e2']] as const) {
    it(`validates the noncanonical array key ${JSON.stringify(key)}`, () => {
      const values = Array.from({ length }, () => 0);
      Object.defineProperty(values, key, { value: { nested: {} }, configurable: true });
      createDeepFreeze()(values);
      assert.ok(Object.isFrozen(Reflect.get(values, key).nested));
    });

    it(`rejects unsupported data on array key ${JSON.stringify(key)}`, () => {
      const values = Array.from({ length }, () => 0);
      Object.defineProperty(values, key, { value: new Map(), configurable: true });
      assert.throws(() => createDeepFreeze()(values), SnapshotDomainError);
    });
  }

  it('does not read or freeze inherited numeric values through array holes', () => {
    const inherited = { mutable: true };
    const values = new Array<unknown>(3);
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, '1', {
      get() { throw new Error('inherited getter must not run'); },
    });
    prototype[0] = inherited;
    Object.setPrototypeOf(values, prototype);
    createDeepFreeze()(values);
    assert.ok(!Object.isFrozen(inherited));
    assert.ok(!Object.hasOwn(values, '0'));
  });

  it('bounds sparse-array reads by owned properties, not length', () => {
    let reads = 0;
    const values = new Array<unknown>(1_000_000);
    values[999_999] = { x: 1 };
    const proxy = new Proxy(values, {
      get(target, key, receiver) {
        reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    createDeepFreeze()(proxy);
    assert.ok(reads < 10, `only owned values should be read; received ${reads}`);
    assert.ok(Object.isFrozen(values[999_999]));
  });

  for (const kind of ['record', 'array'] as const) {
    for (const key of ['value', '0', Symbol('value')]) {
      for (const accessor of ['get', 'set'] as const) {
        it(`rejects a ${kind} ${String(key)} ${accessor} without invoking it`, () => {
          let calls = 0;
          const snapshot = kind === 'array' ? [] : {};
          Object.defineProperty(snapshot, key, {
            [accessor]: () => { calls += 1; return { mutable: true }; },
            configurable: false,
            enumerable: false,
          });
          assert.throws(() => createDeepFreeze()({ nested: snapshot }, { scene: 'play' }),
            (error: unknown) => {
              assert.ok(error instanceof SnapshotDomainError);
              assert.ok(error.path.includes('nested'));
              assert.ok(error.path.includes(String(key)));
              assert.equal(error.scene, 'play');
              assert.match(error.message, /accessor/);
              return true;
            });
          assert.equal(calls, 0);
        });
      }
    }
  }
});
