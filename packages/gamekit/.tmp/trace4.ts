import { createDeepFreeze } from '../src/core/session/deepFreeze';

function countAccesses<T extends object>(target: T): T & { getCount: () => number } {
  let gets = 0;
  const keys: string[] = [];
  const push = (k: string) => keys.push(k);
  const proxy = new Proxy(target, {
    get(object, key, receiver) {
      gets += 1;
      push(String(key));
      return Reflect.get(object, key, receiver);
    },
    ownKeys(object) { return Reflect.ownKeys(object); },
    getOwnPropertyDescriptor(object, key) { return Reflect.getOwnPropertyDescriptor(object, key); },
  }) as T & { getCount: () => number };
  Object.defineProperty(proxy, 'getCount', { value: () => gets, enumerable: false, configurable: true });
  return proxy;
}

const freezer = createDeepFreeze();
const shared = countAccesses({ x: 1, y: 2, alive: true });
freezer({ bricks: [shared, { x: 3, y: 4 }] });
console.log('after first:', shared.getCount(), keys.join(','));
keys.length = 0;
freezer({ bricks: [shared, { x: 5, y: 6 }] });
console.log('after second:', shared.getCount(), keys.join(',') || '(none)');
