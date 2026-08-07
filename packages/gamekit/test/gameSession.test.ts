import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  scale: 'fit',
  overflow: 'letterbox',
} as const;

function createCounterGame(
  updates: Array<{ readonly tick: number; readonly deltaSeconds: number }> = [],
) {
  return defineGame({
    viewport,
    assets: [],
    input: { boost: { type: 'button' } },
    scenes: {
      play: defineScene({
        actions: [],
        create: () => ({ count: 0 }),
        update: ({ state, tick, deltaSeconds }) => {
          updates.push({ tick, deltaSeconds });
          return { count: state.count + 1 };
        },
        snapshot: ({ state }) => ({ count: state.count }),
      }),
    },
    initialScene: 'play',
  });
}

describe('GameSession fixed-step scheduling', () => {
  it('uses a baseline frame, a constant step, and one scheduled successor', () => {
    const updates: Array<{ readonly tick: number; readonly deltaSeconds: number }> = [];
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(updates), {
      frameDriver: driver,
      fixedStepMs: 10,
    });

    session.start();
    session.start();
    assert.equal(driver.pendingCount, 1);

    driver.fireNext(0);
    assert.equal(updates.length, 0);
    assert.equal(driver.pendingCount, 1);

    driver.fireNext(5);
    assert.equal(updates.length, 0);

    driver.fireNext(10);
    assert.deepEqual(updates, [{ tick: 1, deltaSeconds: 0.01 }]);
    assert.equal(driver.pendingCount, 1);
  });

  it('produces the same 60 ticks at 30, 60, and 120 Hz presentation', () => {
    const runAt = (presentationHz: number) => {
      const driver = new ManualFrameDriver();
      const session = createGameSessionWithDriver(createCounterGame(), { frameDriver: driver });
      session.start();
      driver.fireNext(0);

      for (let frame = 1; frame <= presentationHz; frame += 1) {
        driver.fireNext((frame * 1000) / presentationHz);
      }

      return session.getRenderFrame().tick;
    };

    assert.deepEqual([runAt(30), runAt(60), runAt(120)], [60, 60, 60]);
  });

  it('produces the same result for regular and irregular presentation frames', () => {
    const run = (timestamps: readonly number[]) => {
      const driver = new ManualFrameDriver();
      const session = createGameSessionWithDriver(createCounterGame(), {
        frameDriver: driver,
        fixedStepMs: 10,
      });
      session.start();
      for (const timestamp of timestamps) {
        driver.fireNext(timestamp);
      }
      return session.getRenderFrame().current.count;
    };

    assert.equal(
      run([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
      run([0, 3, 17, 22, 49, 63, 80, 100]),
    );
  });

  it('bounds catch-up work and drops excess whole-step debt', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
      maxCatchUpSteps: 3,
    });
    session.start();
    driver.fireNext(0);
    driver.fireNext(95);

    assert.equal(session.getRenderFrame().tick, 3);
    assert.ok(session.getRenderFrame().alpha >= 0);
    assert.ok(session.getRenderFrame().alpha < 1);

    driver.fireNext(100);
    assert.equal(session.getRenderFrame().tick, 3);
  });

  it('discards paused wall time and ignores a cancelled stale callback', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    const cancelledHandle = driver.fireNext(0);
    session.pause();
    assert.equal(driver.pendingCount, 0);

    driver.fireCancelled(cancelledHandle + 1, 500);
    assert.equal(session.getRenderFrame().tick, 0);
    assert.equal(driver.pendingCount, 0);

    session.start();
    driver.fireNext(1_000);
    assert.equal(session.getRenderFrame().tick, 0);
    driver.fireNext(1_010);
    assert.equal(session.getRenderFrame().tick, 1);
  });

  it('disposes idempotently and rejects later live operations', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), { frameDriver: driver });
    session.start();
    session.dispose();
    session.dispose();

    assert.equal(session.status, 'disposed');
    assert.equal(driver.pendingCount, 0);
    assert.throws(() => session.start(), { name: 'GameSessionDisposedError' });
    assert.throws(() => session.input.press('boost'), { name: 'GameSessionDisposedError' });
  });

  it('does not reschedule when the scene pauses during an update', () => {
    const driver = new ManualFrameDriver();
    let pause = () => {};
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        play: defineScene({
          actions: [],
          create: () => ({ updates: 0 }),
          update: ({ state }) => {
            pause();
            return { updates: state.updates + 1 };
          },
          snapshot: ({ state }) => ({ updates: state.updates }),
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    pause = () => session.pause();
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);

    assert.equal(session.status, 'paused');
    assert.equal(session.getRenderFrame().current.updates, 1);
    assert.equal(driver.pendingCount, 0);
  });

  it('pauses and leaves no successor when a scene update throws', () => {
    const driver = new ManualFrameDriver();
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        play: defineScene({
          actions: [],
          create: () => ({}),
          update: () => {
            throw new Error('update failed');
          },
          snapshot: () => null,
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);

    assert.throws(() => driver.fireNext(10), /update failed/);
    assert.equal(session.status, 'paused');
    assert.equal(driver.pendingCount, 0);
  });

  it('fails fast when a scene reads an undeclared input action', () => {
    const driver = new ManualFrameDriver();
    const game = defineGame({
      viewport,
      assets: [],
      input: { boost: { type: 'button' } },
      scenes: {
        play: defineScene({
          actions: ['boost'],
          create: () => ({}),
          update: ({ state, input }) => {
            input.button('missing' as 'boost');
            return { ...state };
          },
          snapshot: () => null,
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);

    assert.throws(() => driver.fireNext(10), /Unknown input action: missing/);
    assert.equal(session.status, 'paused');
  });

  it('does not extract or present after disposal during an update', () => {
    const driver = new ManualFrameDriver();
    let dispose = () => {};
    let snapshotCalls = 0;
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        play: defineScene({
          actions: [],
          create: () => ({ value: 0 }),
          update: ({ state }) => {
            dispose();
            return { value: state.value + 1 };
          },
          snapshot: ({ state }) => {
            snapshotCalls += 1;
            return { value: state.value };
          },
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    dispose = () => session.dispose();
    session.start();
    driver.fireNext(0);
    driver.fireNext(10);

    assert.equal(session.status, 'disposed');
    assert.equal(snapshotCalls, 1);
    assert.equal(session.getRenderFrame().tick, 0);
    assert.equal(driver.pendingCount, 0);
  });

  it('pauses instead of becoming a running session with no frame after a listener error', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), { frameDriver: driver });
    session.addRenderFrameListener(() => {
      throw new Error('presentation failed');
    });
    session.start();

    assert.throws(() => driver.fireNext(0), /presentation failed/);
    assert.equal(session.status, 'paused');
    assert.equal(driver.pendingCount, 0);
  });
});

describe('GameSession input and snapshots', () => {
  it('samples press, hold, and release edges once per simulation tick', () => {
    const states: Array<{
      readonly held: boolean;
      readonly pressed: boolean;
      readonly released: boolean;
    }> = [];
    const driver = new ManualFrameDriver();
    const game = defineGame({
      viewport,
      assets: [],
      input: { boost: { type: 'button' } },
      scenes: {
        play: defineScene({
          actions: ['boost'],
          create: () => ({}),
          update: ({ state, input }) => {
            states.push(input.button('boost'));
            return { ...state };
          },
          snapshot: () => null,
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);

    session.input.press('boost');
    driver.fireNext(10);
    driver.fireNext(20);
    session.input.release('boost');
    driver.fireNext(30);

    assert.deepEqual(states, [
      { held: true, pressed: true, released: false, cancelled: false },
      { held: true, pressed: false, released: false, cancelled: false },
      { held: false, pressed: false, released: true, cancelled: false },
    ]);
  });

  it('preserves press and release edges that occur between ticks', () => {
    const states: Array<ReturnType<Parameters<ReturnType<typeof defineScene>['update']>[0]['input']['button']>> = [];
    const driver = new ManualFrameDriver();
    const game = defineGame({
      viewport,
      assets: [],
      input: { boost: { type: 'button' } },
      scenes: {
        play: defineScene({
          actions: ['boost'],
          create: () => ({}),
          update: ({ state, input }) => {
            states.push(input.button('boost'));
            return { ...state };
          },
          snapshot: () => null,
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);
    session.input.press('boost');
    session.input.release('boost');
    driver.fireNext(10);

    assert.deepEqual(states[0], {
      held: false,
      pressed: true,
      released: true,
      cancelled: false,
    });
  });

  it('reports cancellation once and neutralizes the held action', () => {
    const states: Array<{
      readonly held: boolean;
      readonly cancelled: boolean;
    }> = [];
    const driver = new ManualFrameDriver();
    const game = defineGame({
      viewport,
      assets: [],
      input: { boost: { type: 'button' } },
      scenes: {
        play: defineScene({
          actions: ['boost'],
          create: () => ({}),
          update: ({ state, input }) => {
            states.push(input.button('boost'));
            return { ...state };
          },
          snapshot: () => null,
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);
    session.input.press('boost');
    session.input.cancel('boost');
    driver.fireNext(10);
    driver.fireNext(20);

    assert.equal(states[0]?.held, false);
    assert.equal(states[0]?.cancelled, true);
    assert.equal(states[1]?.cancelled, false);
  });

  it('consumes input edges only on the first tick of a catch-up frame', () => {
    const pressed: boolean[] = [];
    const driver = new ManualFrameDriver();
    const game = defineGame({
      viewport,
      assets: [],
      input: { boost: { type: 'button' } },
      scenes: {
        play: defineScene({
          actions: ['boost'],
          create: () => ({}),
          update: ({ state, input }) => {
            pressed.push(input.button('boost').pressed);
            return { ...state };
          },
          snapshot: () => null,
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    session.start();
    driver.fireNext(0);
    session.input.press('boost');
    driver.fireNext(30);

    assert.deepEqual(pressed, [true, false, false]);
  });

  it('publishes stable previous/current snapshots and removable listeners', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(createCounterGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const initial = session.getRenderFrame();
    const presented: typeof initial[] = [];
    const subscription = session.addRenderFrameListener((frame) => presented.push(frame));

    assert.equal(initial.previous, initial.current);
    assert.deepEqual(initial.current, { count: 0 });

    session.start();
    driver.fireNext(0);
    driver.fireNext(10);
    const afterTick = session.getRenderFrame();

    assert.deepEqual(afterTick.previous, { count: 0 });
    assert.deepEqual(afterTick.current, { count: 1 });
    assert.deepEqual(initial.current, { count: 0 });
    assert.equal(presented.length, 2);

    subscription.remove();
    subscription.remove();
    driver.fireNext(20);
    assert.equal(presented.length, 2);
  });

  it('deeply freezes nested renderer snapshots', () => {
    const driver = new ManualFrameDriver();
    const game = defineGame({
      viewport,
      assets: [],
      input: {},
      scenes: {
        play: defineScene({
          actions: [],
          create: () => ({ x: 1 }),
          update: ({ state }) => ({ x: state.x + 1 }),
          snapshot: ({ state }) => ({ position: { x: state.x } }),
        }),
      },
      initialScene: 'play',
    });
    const session = createGameSessionWithDriver(game, { frameDriver: driver });
    const snapshot = session.getRenderFrame().current;

    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.position), true);
    assert.equal(Reflect.set(snapshot.position, 'x', 99), false);
    assert.equal(session.getRenderFrame().current.position.x, 1);
  });
});
