import { createDeepFreeze } from '../src/core/session/deepFreeze';
const keys: string[] = [];
const shared = new Proxy(
  { x: 1, y: 2, alive: true },
  {
    get(o, k, r) { keys.push(String(k)); return Reflect.get(o, k, r); },
    ownKeys(o) { return Reflect.ownKeys(o); },
    getOwnPropertyDescriptor(o, k) { return Reflect.getOwnPropertyDescriptor(o, k); },
  },
);
const freezer = createDeepFreeze();
freezer({ bricks: [shared, { x: 3, y: 4 }] });
console.log('after first:', keys.join(',') || '(none)');
keys.length = 0;
freezer({ bricks: [shared, { x: 5, y: 6 }] });
console.log('after second:', keys.join(',') || '(none)');
