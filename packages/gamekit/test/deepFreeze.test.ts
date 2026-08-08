import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDeepFreeze } from '../src/core/session/deepFreeze';

/**
 * Trusted deep-freeze cache tests (T3).
 *
 * The freezer is observable through access-counting proxies: a cached
 * (trusted) subtree is never re-traversed, while new or untrusted nodes are
 * walked and frozen every time.
 */

interface AccessCounting {
  readonly getCount: () => number;
}

function countAccesses<T extends object>(target: T): T & AccessCounting {
  let gets = 0;
  const proxy = new Proxy(target, {
    get(object, key, receiver) {
      // The probe's own accessor must not count as a frozen-subtree read.
      if (key !== 'getCount') {
        gets += 1;
      }
      return Reflect.get(object, key, receiver);
    },
    ownKeys(object) {
      return Reflect.ownKeys(object);
    },
    getOwnPropertyDescriptor(object, key) {
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  }) as T & AccessCounting;
  Object.defineProperty(proxy, 'getCount', {
    value: () => gets,
    enumerable: false,
    configurable: true,
  });
  return proxy;
}

describe('trusted deep-freeze cache (T3)', () => {
  it('freezes a structurally shared subtree only once across snapshots', () => {
    const freezer = createDeepFreeze();
    const shared = countAccesses({ x: 1, y: 2, alive: true });
    const first = freezer({ bricks: [shared, { x: 3, y: 4 }] });
    const afterFirst = shared.getCount();
    const second = freezer({ bricks: [shared, { x: 5, y: 6 }] });
    assert.ok(afterFirst >= 3, 'first traversal read the shared node and its children');
    assert.equal(shared.getCount(), afterFirst, 'second traversal must not re-read the shared subtree');
    assert.equal(Object.isFrozen(first.bricks[0]), true);
    assert.equal(Object.isFrozen(second.bricks[0]), true);
  });

  it('freezes a newly introduced nested object inside an otherwise-shared tree', () => {
    const freezer = createDeepFreeze();
    interface Brick {
      readonly x: number;
      readonly nested?: { readonly deep: boolean };
    }
    const shared: Brick = { x: 1 };
    const fresh: Brick = { x: 2, nested: { deep: true } };
    freezer({ bricks: [shared] });
    const frame = freezer({ bricks: [shared, fresh] });
    const firstBrick = frame.bricks[0]!;
    const secondBrick = frame.bricks[1]!;
    assert.equal(Object.isFrozen(firstBrick), true, 'shared node stays frozen');
    assert.equal(Object.isFrozen(secondBrick), true, 'new node is frozen');
    assert.equal(Object.isFrozen(secondBrick.nested), true, 'new nested node is frozen');
  });

  it('does not infinite-loop on cyclic snapshots and freezes the cycle', () => {
    const freezer = createDeepFreeze();
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    const frame = freezer(cyclic);
    assert.equal(Object.isFrozen(frame), true);
    assert.equal(Object.isFrozen(frame.self), true);
    assert.equal(frame.self, frame, 'the cycle is preserved');
  });

  it('leaves the parent untrusted when a child getter throws, then re-traverses later', () => {
    const freezer = createDeepFreeze();
    let throwNow = true;
    const flaky = countAccesses(
      new Proxy(
        { ok: true, boom: 1 },
        {
          get(object, key, receiver) {
            if (throwNow && key === 'boom') {
              throw new Error('boom');
            }
            return Reflect.get(object, key, receiver);
          },
        },
      ),
    );
    const parent = countAccesses({ child: flaky, boom: 1 });
    assert.throws(() => freezer(parent), /boom/);
    const countAfterThrow = parent.getCount();
    throwNow = false;
    const frame = freezer(parent);
    assert.ok(
      parent.getCount() > countAfterThrow,
      'failed traversal must not mark the parent trusted; it is re-walked',
    );
    assert.equal(Object.isFrozen(frame.child), true);
    assert.equal(Object.isFrozen(frame), true);
  });

  it('recurses into objects that are already frozen but shallowly', () => {
    const freezer = createDeepFreeze();
    const shallowFrozen = Object.freeze({ mutableChild: { deep: 'value' } });
    const frame = freezer({ outer: shallowFrozen });
    assert.equal(Object.isFrozen(frame.outer), true);
    assert.equal(
      Object.isFrozen(frame.outer.mutableChild),
      true,
      'shallow-frozen parents must still be recursed into',
    );
  });

  it('keeps separate freezers independent per session', () => {
    const freezerA = createDeepFreeze();
    const freezerB = createDeepFreeze();
    const shared = countAccesses({ x: 1 });
    freezerA({ bricks: [shared] });
    const afterA = shared.getCount();
    freezerB({ bricks: [shared] });
    assert.ok(
      shared.getCount() > afterA,
      'a second session must not trust subtrees cached by the first',
    );
  });
});
