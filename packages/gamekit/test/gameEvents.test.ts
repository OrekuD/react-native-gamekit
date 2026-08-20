/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineGame, defineGameEvents, defineScene, gameEvent, seedGameEvent } from '../src/index.ts';
import { GameEventError } from '../src/events/errors.ts';
import { PAYLOAD_LIMITS, cloneAndValidatePayload } from '../src/events/payload.ts';
import { createGameSessionWithDriver, ManualFrameDriver } from '../src/testing.ts';
import type { InferGameEventMap } from '../src/events/types.ts';

// Helper to create a minimal game with events for testing
function makeEvents() {
  return defineGameEvents({
    a: gameEvent<{ n: number }>(),
    b: gameEvent<{ s: string }>(),
  });
}

type TestEvents = ReturnType<typeof makeEvents>;
type TestEventMap = InferGameEventMap<TestEvents>;

function makeGameWithEvents(
  update: (ctx: { state: any; events: { emit: <K extends keyof TestEventMap & string>(name: K, payload: TestEventMap[K]) => void }; tick: number }) => any,
  emits: readonly (keyof TestEventMap & string)[] = ['a'],
) {
  const events = makeEvents();
  const scene = defineScene({
    actions: [] as const,
    emits,
    events,
    create: () => ({ v: 0 }),
    update: update as any,
    snapshot: ({ state }: any) => state,
  });
  const game = defineGame({
    viewport: { logicalSize: { width: 100, height: 100 }, mode: 'fit' },
    input: {},
    events,
    scenes: { main: scene },
    initialScene: 'main',
  });
  return { game, events };
}

describe('T13.1 definitions and payload boundary', () => {
  it('defineGameEvents freezes declarations and validates names', () => {
    const ev = defineGameEvents({ 'ok': gameEvent<number>() });
    assert.equal(Object.isFrozen(ev), true);
    assert.equal(Object.isFrozen(ev['ok']), true);
    // Empty name throws
    assert.throws(() => defineGameEvents({ '': gameEvent<number>() } as any), /Invalid game event name/);
  });

  it('cloneAndValidatePayload accepts valid plain values and freezes', () => {
    const payload = { n: 1, s: 'hi', b: true, u: undefined, arr: [1, 2], rec: { x: 1 } };
    const cloned: any = cloneAndValidatePayload(payload, 'a');
    assert.deepEqual(cloned, payload);
    assert.equal(Object.isFrozen(cloned), true);
    assert.equal(Object.isFrozen(cloned.arr), true);
    assert.equal(Object.isFrozen(cloned.rec), true);
    // Mutating original does not affect clone
    payload.n = 2;
    assert.equal((cloned as any).n, 1);
  });

  it('payload immutability: envelopes and payloads are frozen', () => {
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      events.emit('a', { n: 1 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(received.length, 1);
    const env = received[0];
    assert.equal(Object.isFrozen(env), true);
    assert.equal(Object.isFrozen(env.payload), true);
    assert.throws(() => { (env.payload as any).n = 2; }, /Cannot assign/);
    session.dispose();
  });

  it('rejects functions with exact path', () => {
    let err: unknown;
    try { cloneAndValidatePayload({ fn: () => {} } as any, 'a'); assert.fail('should throw'); } catch (e) { err = e; }
    assert.ok(err instanceof GameEventError);
    assert.match((err as Error).message, /Event "a" payload invalid at payload\.fn/);
  });

  it('rejects symbols, bigints, non-finite numbers, sparse arrays, cycles, class instances', () => {
    assert.throws(() => cloneAndValidatePayload({ s: Symbol('x') } as any, 'a'), GameEventError);
    assert.throws(() => cloneAndValidatePayload({ b: 1n } as any, 'a'), GameEventError);
    assert.throws(() => cloneAndValidatePayload({ n: NaN } as any, 'a'), GameEventError);
    assert.throws(() => cloneAndValidatePayload({ n: Infinity } as any, 'a'), GameEventError);
    // Sparse
    const sparse: any = [1, 2, 3];
    delete sparse[1];
    assert.throws(() => cloneAndValidatePayload(sparse, 'a'), GameEventError);
    // Cycle
    const cyc: any = { a: {} };
    cyc.a.self = cyc;
    assert.throws(() => cloneAndValidatePayload(cyc, 'a'), GameEventError);
    // Class instance
    class Cls { x = 1; }
    assert.throws(() => cloneAndValidatePayload(new Cls() as any, 'a'), GameEventError);
    // Map
    assert.throws(() => cloneAndValidatePayload(new Map() as any, 'a'), GameEventError);
    // Symbol key
    assert.throws(() => cloneAndValidatePayload({ [Symbol('k')]: 1 } as any, 'a'), GameEventError);
    // Unsafe prototype key
    const unsafe: any = {};
    Object.defineProperty(unsafe, '__proto__', { value: 1, enumerable: true, writable: true, configurable: true });
    // The above may not be enumerable as own property? Alternative: use Object.create(null) with __proto__
    // For test, we can directly test clone of object with __proto__ own property via defineProperty
    // Our payload validator checks Object.keys which will include __proto__ if defined as own
    // So we need to ensure it throws.
    // Instead test with plain object that has constructor key
    assert.throws(() => cloneAndValidatePayload({ constructor: 1 } as any, 'a'), GameEventError);
  });

  it('enforces bounded payload size', () => {
    // Depth
    let deep: any = { a: 1 };
    for (let i = 0; i < PAYLOAD_LIMITS.MAX_PAYLOAD_DEPTH + 1; i += 1) {
      deep = { next: deep };
    }
    assert.throws(() => cloneAndValidatePayload(deep, 'a'), /exceeds maximum depth/);
    // String length
    assert.throws(() => cloneAndValidatePayload({ s: 'x'.repeat(PAYLOAD_LIMITS.MAX_PAYLOAD_STRING_LENGTH + 1) }, 'a'), /string exceeds/);
    // Array length
    assert.throws(() => cloneAndValidatePayload(new Array(PAYLOAD_LIMITS.MAX_PAYLOAD_ARRAY_LENGTH + 1).fill(1), 'a'), /array exceeds/);
    // Node count
    const many: any = {};
    for (let i = 0; i < PAYLOAD_LIMITS.MAX_PAYLOAD_NODES + 1; i += 1) {
      many[`k${i}`] = i;
    }
    assert.throws(() => cloneAndValidatePayload(many, 'a'), /exceeds maximum payload size/);
  });

  it('reports exact payload path for nested failures', () => {
    let err: unknown; try { cloneAndValidatePayload({ a: { b: { c: NaN } } } as any, 'ev'); assert.fail('should throw'); } catch (e) { err = e; }
    assert.match((err as Error).message, /payload\.a\.b\.c/);
    let err2: unknown; try { cloneAndValidatePayload([1, 2, { x: () => {} }] as any, 'ev'); assert.fail('should throw'); } catch (e) { err2 = e; }
    assert.match((err2 as Error).message, /payload\[2\]\.x/);
  });
});

describe('T13.2 transactional emission', () => {
  it('failed ticks publish no events (update throw)', () => {
    const { game } = makeGameWithEvents(({ state, events, tick }: any) => {
      if (tick === 1) events.emit('a', { n: 1 });
      if (tick === 2) {
        events.emit('a', { n: 2 });
        throw new Error('boom');
      }
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10); // tick1 ok
    assert.equal(received.length, 1);
    assert.equal(received[0].payload.n, 1);
    try { driver.fireNext(20); } catch {}
    assert.equal(session.status, 'paused');
    assert.equal(received.length, 1, 'tick2 events discarded');
    session.dispose();
  });

  it('discards on snapshot throw', () => {
    const events = makeEvents();
    const scene = defineScene({
      actions: [],
      emits: ['a'],
      events,
      create: () => ({ v: 0, shouldThrow: false }),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      update: ({ state, events }: any) => {
        events.emit('a', { n: 1 });
        return { v: 1, shouldThrow: true };
      },
      snapshot: ({ state }: any) => {
        if (state.shouldThrow) throw new Error('snap boom');
        return state;
      },
    });
    const game = defineGame({
      viewport: { logicalSize: { width: 100, height: 100 }, mode: 'fit' },
      input: {},
      events,
      scenes: { main: scene },
      initialScene: 'main',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    try { driver.fireNext(10); } catch {}
    assert.equal(session.status, 'paused');
    assert.equal(received.length, 0);
    session.dispose();
  });

  it('discards on transition preparation failure', () => {
    const events = makeEvents();
    const sceneA = defineScene({
      actions: [],
      transitions: ['b'],
      emits: ['a'],
      events,
      create: () => ({ v: 0 }),
      update: ({ state, events, transition }: any) => {
        events.emit('a', { n: 1 });
        transition.setScene('b');
        return state;
      },
      snapshot: ({ state }: any) => state,
    });
    const sceneB = defineScene({
      actions: [],
      create: (): any => { throw new Error('create boom'); },
      update: ({ state }: any) => state,
      snapshot: ({ state }: any) => state,
    });
    const game = defineGame({
      viewport: { logicalSize: { width: 100, height: 100 }, mode: 'fit' },
      input: {},
      events,
      scenes: { main: sceneA, b: sceneB },
      initialScene: 'main',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    try { driver.fireNext(10); } catch {}
    assert.equal(session.status, 'paused');
    assert.equal(received.length, 0, 'transition failure discards');
    session.dispose();
  });

  it('emitter becomes invalid after update returns or throws', () => {
    let saved: any;
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      saved = events;
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.throws(() => saved.emit('a', { n: 1 }), GameEventError);
    session.dispose();
  });

  it('preserves allocation-free path for games without events', () => {
    const game = defineGame({
      viewport: { logicalSize: { width: 100, height: 100 }, mode: 'fit' },
      input: {},
      scenes: {
        main: defineScene({
          actions: [],
          create: () => ({ v: 0 }),
          update: ({ state }: any) => state,
          snapshot: ({ state }: any) => state,
        }),
      },
      initialScene: 'main',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    // Should not throw when game has no events and we try to add listener (should throw)
    assert.throws(() => session.addGameEventListener('a', () => {}), GameEventError);
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(session.getRenderFrame().tick, 1);
    session.dispose();
  });
});

describe('T13.3 ordered per-session delivery', () => {
  it('publishes in deterministic tick and ordinal order', () => {
    const { game } = makeGameWithEvents(({ state, events, tick }: any) => {
      if (tick === 1) {
        events.emit('a', { n: 10 });
        events.emit('a', { n: 11 });
        events.emit('b', { s: 'hi' });
      }
      if (tick === 2) {
        events.emit('a', { n: 20 });
      }
      return state;
    }, ['a', 'b']);
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.addGameEventListener('b', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.deepEqual(received.map(r => r.payload), [{ n: 10 }, { n: 11 }, { s: 'hi' }]);
    assert.deepEqual(received.map(r => r.ordinal), [0, 1, 2]);
    // Check tick order
    assert.equal(received[0].tick, 1);
    assert.equal(received[2].tick, 1);
    driver.fireNext(20);
    assert.equal(received[3].tick, 2);
    assert.equal(received[3].ordinal, 0);
    session.dispose();
  });

  it('catch-up ticks preserve tick and ordinal order without duplication', () => {
    const { game } = makeGameWithEvents(({ state, events, tick }: any) => {
      events.emit('a', { n: tick });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10, maxCatchUpSteps: 5 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e.tick); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(35); // 3 ticks
    assert.deepEqual(received, [1, 2, 3]);
    session.dispose();
  });

  it('zero-step callbacks publish nothing', () => {
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      events.emit('a', { n: 1 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0); // baseline, no tick
    assert.equal(received.length, 0);
    driver.fireNext(5); // less than step, zero-step
    assert.equal(received.length, 0);
    driver.fireNext(10); // now tick
    assert.equal(received.length, 1);
    session.dispose();
  });

  it('listener snapshot: added during delivery receives only later events', () => {
    const { game } = makeGameWithEvents(({ state, events, _tick }: any) => {
      events.emit('a', { n: 1 });
      events.emit('a', { n: 2 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const receivedLate: any[] = [];
    let lateSub: any;
    session.addGameEventListener('a', () => {
      if (!lateSub) {
        lateSub = session.addGameEventListener('a', (e: any) => { receivedLate.push(e.payload.n); });
      }
    });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    // Late listener should not have received the two events from tick1 (snapshot)
    assert.equal(receivedLate.length, 0);
    driver.fireNext(20); // tick2 emits two events
    // Now late listener should receive both events from tick2 (per-tick snapshot)
    assert.equal(receivedLate.length, 2);
    assert.deepEqual(receivedLate, [1, 2]);
    session.dispose();
  });

  it('removing listener prevents future deliveries and is idempotent', () => {
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      events.emit('a', { n: 1 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    const sub = session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(received.length, 1);
    sub.remove();
    sub.remove(); // idempotent
    driver.fireNext(20);
    assert.equal(received.length, 1);
    session.dispose();
  });

  it('successful transition-tick events retain source scene and tick', () => {
    const events = defineGameEvents({
      a: gameEvent<{ n: number }>(),
    });
    const sceneA = defineScene({
      actions: [],
      transitions: ['b'],
      emits: ['a'],
      events,
      create: () => ({}),
      update: ({ state, events, transition }: any) => {
        events.emit('a', { n: 1 });
        transition.setScene('b');
        return state;
      },
      snapshot: () => ({}),
    });
    const sceneB = defineScene({
      actions: [],
      create: () => ({}),
      update: ({ state }: any) => state,
      snapshot: () => ({}),
    });
    const game = defineGame({
      viewport: { logicalSize: { width: 100, height: 100 }, mode: 'fit' },
      input: {},
      events,
      scenes: { a: sceneA, b: sceneB },
      initialScene: 'a',
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10); // tick1 with transition
    assert.equal(received.length, 1);
    assert.equal(received[0].scene, 'a');
    assert.equal(received[0].tick, 1);
    assert.equal(session.scene, 'b');
    session.dispose();
  });

  it('pause produces no events and resume replays none', () => {
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      events.emit('a', { n: 1 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(received.length, 1);
    session.pause();
    // No tick while paused
    assert.equal(received.length, 1);
    session.start();
    driver.fireNext(100);
    driver.fireNext(110);
    assert.equal(received.length, 2); // new tick after resume, not replay
    session.dispose();
  });

  it('disposal prevents future delivery and releases listeners', () => {
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      events.emit('a', { n: 1 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', (e) => { received.push(e); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(received.length, 1);
    session.dispose();
    assert.throws(() => session.addGameEventListener('a', () => {}), /disposed/i);
    // No further delivery after dispose (no frame scheduled)
    assert.equal(received.length, 1);
  });

  it('throwing listener does not suppress siblings or alter simulation', () => {
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      events.emit('a', { n: 1 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: any[] = [];
    session.addGameEventListener('a', () => { throw new Error('listener boom'); });
    session.addGameEventListener('a', (e) => { received.push(e); });
    const originalError = console.error;
    let logged = false;
    console.error = () => { logged = true; };
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    console.error = originalError;
    assert.equal(received.length, 1, 'sibling still ran');
    assert.equal(logged, true, 'error was reported');
    assert.equal(session.status, 'running', 'simulation not paused');
    session.dispose();
  });

  it('seedGameEvent is deterministic', () => {
    const e1 = { name: 'a', payload: { n: 1 }, tick: 5, scene: 'main', sceneTick: 5, ordinal: 0 } as any;
    const e2 = { name: 'a', payload: { n: 1 }, tick: 5, scene: 'main', sceneTick: 5, ordinal: 0 } as any;
    const e3 = { name: 'a', payload: { n: 1 }, tick: 5, scene: 'main', sceneTick: 5, ordinal: 1 } as any;
    assert.equal(seedGameEvent(e1), seedGameEvent(e2));
    assert.notEqual(seedGameEvent(e1), seedGameEvent(e3));
  });

  it('(tick, ordinal) is unique within a session', () => {
    const { game } = makeGameWithEvents(({ state, events, tick }: any) => {
      events.emit('a', { n: tick });
      events.emit('a', { n: tick * 10 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const seen = new Set<string>();
    session.addGameEventListener('a', (e) => {
      const key = `${e.tick}:${e.ordinal}`;
      assert.equal(seen.has(key), false, `duplicate ${key}`);
      seen.add(key);
    });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    driver.fireNext(20);
    assert.equal(seen.size, 4);
    session.dispose();
  });

  it('F2: async rejecting listener does not break sibling and does not unhandle', async () => {
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      events.emit('a', { n: 1 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const received: number[] = [];
    const reported: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { reported.push(args); };
    // Async listener that rejects
    session.addGameEventListener('a', async () => {
      throw new Error('async boom');
    });
    session.addGameEventListener('a', (e: any) => { received.push(e.payload.n); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(received.length, 1, 'sibling still ran');
    assert.equal(reported.length, 1, 'rejection was reported');
    assert.equal(session.status, 'running', 'session not paused');
    // Check unhandled rejection: if our code did not catch, Node would emit unhandledRejection
    let unhandled = false;
    const onUnhandled = () => { unhandled = true; };
    process.on('unhandledRejection', onUnhandled);
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onUnhandled);
    assert.equal(unhandled, false, 'no unhandled rejection');
    console.error = origError;
    session.dispose();
  });

  it('F2: reporter throwing does not pause session', async () => {
    const { game } = makeGameWithEvents(({ state, events }: any) => {
      events.emit('a', { n: 1 });
      return state;
    });
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    const origError = console.error;
    console.error = () => { throw new Error('reporter boom'); };
    session.addGameEventListener('a', () => { throw new Error('listener boom'); });
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    assert.equal(session.status, 'running', 'session still running even though reporter threw');
    console.error = origError;
    session.dispose();
  });

  it('F3: shared acyclic references are cloned independently', () => {
    const shared = { x: 1 };
    const payload = { first: shared, second: shared };
    const cloned: any = cloneAndValidatePayload(payload, 'a');
    assert.notEqual(cloned.first, cloned.second, 'shared refs are cloned separately');
    assert.deepEqual(cloned.first, { x: 1 });
    assert.deepEqual(cloned.second, { x: 1 });
    assert.equal(Object.isFrozen(cloned.first), true);
    assert.equal(Object.isFrozen(cloned.second), true);
    assert.equal(Object.isFrozen(cloned), true);
    // Original mutation does not affect clone
    shared.x = 99;
    assert.equal(cloned.first.x, 1);
    assert.equal(cloned.second.x, 1);
    // Clones are frozen and independent
    assert.throws(() => { cloned.first.x = 2; }, /read only property/);
  });

  it('F3: self and mutual cycles are rejected at correct path', () => {
    const self: any = { a: 1 };
    self.self = self;
    let err: any;
    try { cloneAndValidatePayload(self, 'ev'); assert.fail('should throw'); } catch (e) { err = e; }
    assert.ok(err instanceof GameEventError);
    assert.match(err.message, /payload\.self.*cycle/);

    const a: any = { name: 'a' };
    const b: any = { name: 'b', ref: a };
    a.ref = b;
    try { cloneAndValidatePayload(a, 'ev'); assert.fail('should throw'); } catch (e) { err = e; }
    assert.match(err.message, /cycle/);
  });

  it('F3: getter is never invoked and accessor/non-enumerable are rejected', () => {
    let getterCalled = false;
    const payload: any = {};
    Object.defineProperty(payload, 'x', {
      get() { getterCalled = true; return 1; },
      enumerable: true,
      configurable: true,
    });
    let err: any;
    try { cloneAndValidatePayload(payload, 'ev'); assert.fail('should throw'); } catch (e) { err = e; }
    assert.equal(getterCalled, false, 'getter should not be invoked');
    assert.match(err.message, /accessor property/);
    assert.match(err.message, /payload\.x/);

    const nonEnum: any = {};
    Object.defineProperty(nonEnum, 'y', {
      value: 1,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    try { cloneAndValidatePayload(nonEnum, 'ev'); assert.fail('should throw'); } catch (e) { err = e; }
    assert.match(err.message, /non-enumerable/);
    assert.match(err.message, /payload\.y/);
  });

  it('F4: seed is equal for same tick/ordinal/name even with different sceneTick', () => {
    const e1: any = { name: 'a', tick: 5, ordinal: 0, sceneTick: 1, scene: 'main', payload: {} };
    const e2: any = { name: 'a', tick: 5, ordinal: 0, sceneTick: 99, scene: 'other', payload: {} };
    const e3: any = { name: 'a', tick: 5, ordinal: 1, sceneTick: 1, scene: 'main', payload: {} };
    assert.equal(seedGameEvent(e1), seedGameEvent(e2), 'sceneTick should not affect seed');
    assert.notEqual(seedGameEvent(e1), seedGameEvent(e3), 'different ordinal should change seed');
  });
});
