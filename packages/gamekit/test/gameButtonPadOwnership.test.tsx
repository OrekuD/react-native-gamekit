import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';
import { StrictMode, createElement, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { defineGame, defineScene } from '../src/index';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

type Touch = { id: number; x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type Callback = (x: number, y: number, width: number, height: number) => void;
let config: Record<string, (event: unknown) => void>;
let scheduled: Array<{ fn: (...args: unknown[]) => void; args: unknown[] }> = [];
let measurements: Array<() => void> = [];
let deferMeasurement = false;
let nativeMeasurement = true;
let measurementFails = false;
let rect: Rect = { x: 110, y: 120, width: 80, height: 60 };

mock.module('react-native', {
  namedExports: {
    View: (props: Record<string, unknown>) => createElement('View', props, props.children as never),
    StyleSheet: { absoluteFill: {} },
    findNodeHandle: () => 42,
  },
});
mock.module('react-native-gesture-handler', {
  namedExports: {
    GestureDetector: ({ children }: { children?: unknown }) => children ?? null,
    useManualGesture: (value: typeof config) => { config = value; return {}; },
  },
});
mock.module('react-native-reanimated', {
  namedExports: { useSharedValue: (value: unknown) => useRef({ value }).current },
});
mock.module('react-native-worklets', {
  namedExports: {
    scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => scheduled.push({ fn, args }),
  },
});
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PadModule = typeof import('../src/react/GameButtonPad');
let GameButtonPad: PadModule['GameButtonPad'];
let GameButton: PadModule['GameButton'];
before(async () => { ({ GameButtonPad, GameButton } = await import('../src/react/GameButtonPad.tsx')); });

function session() {
  const pressed: string[] = [];
  const released: string[] = [];
  const listeners = new Set<(status: string) => void>();
  const game = {
    status: 'running',
    input: { press: (name: string) => pressed.push(name), release: (name: string) => released.push(name), getResetRevision: () => 0 },
    addCommitListener: () => ({ remove: () => {} }),
    addStatusListener: (fn: (status: string) => void) => {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    },
    setStatus: (status: string) => {
      game.status = status;
      for (const fn of listeners) fn(status);
    },
    pressed,
    released,
  };
  return game;
}

type Game = Pick<ReturnType<typeof session>, 'status' | 'input' | 'addStatusListener' | 'addCommitListener'>;
function tree(game: Game, action: string | null = 'jump', hitSlop = 0) {
  return createElement(GameButtonPad as never, { game, testID: 'pad', hitSlop },
    action === null ? null : createElement(GameButton, { action, testID: 'button' }));
}

async function mount(game: Game, strict = false) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(strict ? createElement(StrictMode, {}, tree(game)) : tree(game), {
      createNodeMock: () => nativeMeasurement ? {
        measureLayout: (_ancestor: unknown, success: Callback, failure: () => void) => {
          const snapshot = { ...rect };
          const failed = measurementFails;
          const measure = () => failed ? failure() : success(snapshot.x, snapshot.y, snapshot.width, snapshot.height);
          if (deferMeasurement) measurements.push(measure);
          else measure();
        },
      } : {},
    });
  });
  return renderer;
}

function layout(renderer: ReactTestRenderer, testID = 'button') {
  const host = renderer.root.findAllByType('View' as never).find((view) => view.props.testID === testID);
  assert.equal(typeof host?.props.onLayout, 'function', `${testID} exposes onLayout`);
  host!.props.onLayout({ nativeEvent: { layout: { x: 10, y: 20, width: 80, height: 60 } } });
}
function down(changed: Touch[], all = changed) {
  config.onTouchesDown!({ changedTouches: changed, allTouches: all, handlerTag: 123, pointerType: 1 });
}
function move(touches: Touch[]) { config.onTouchesMove!({ changedTouches: touches, allTouches: touches }); }
async function flush() {
  await act(async () => {
    for (const { fn, args } of scheduled.splice(0)) fn(...args);
  });
}
async function unmount(renderer: ReactTestRenderer) { await act(async () => renderer.unmount()); }
const inside: Touch = { id: 1, x: 150, y: 150 };

beforeEach(() => {
  scheduled = [];
  measurements = [];
  deferMeasurement = false;
  nativeMeasurement = true;
  measurementFails = false;
  rect = { x: 110, y: 120, width: 80, height: 60 };
});

describe('button ownership regressions', () => {
  it('removes a held child zone after React clears its native ref', async () => {
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    down([inside]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await act(async () => renderer.update(tree(game, null)));
    assert.deepEqual(game.released, ['jump']);
    down([{ ...inside, id: 2 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await unmount(renderer);
  });

  it('renames a measured button without needing another native layout event', async () => {
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    down([inside]); await flush();
    await act(async () => renderer.update(tree(game, 'kick')));
    assert.deepEqual(game.released, ['jump']);
    down([{ ...inside, id: 2 }]); await flush();
    assert.deepEqual(game.pressed, ['jump', 'kick']);
    await unmount(renderer);
  });

  it('waits for pad-space measurement instead of accepting a provisional parent rect', async () => {
    deferMeasurement = true;
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    down([{ id: 1, x: 40, y: 40 }]); await flush();
    assert.deepEqual(game.pressed, []);
    await act(async () => { for (const measure of measurements.splice(0)) measure(); });
    down([{ ...inside, id: 2 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await unmount(renderer);
  });

  it('keeps zones inactive when native measurement is unavailable', async () => {
    nativeMeasurement = false;
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    down([{ id: 1, x: 40, y: 40 }]); await flush();
    assert.deepEqual(game.pressed, []);
    await unmount(renderer);
  });

  it('ignores older native measurements for the same mounted owner', async () => {
    deferMeasurement = true;
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    rect = { ...rect, x: 300 };
    layout(renderer);
    const newest = measurements.pop()!;
    await act(async () => { newest(); for (const measure of measurements.splice(0)) measure(); });
    down([{ id: 1, x: 340, y: 150 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await unmount(renderer);
  });

  it('invalidates queued touches when a measured zone moves', async () => {
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    down([inside]);
    rect = { ...rect, x: 130 };
    layout(renderer);
    await flush();
    assert.deepEqual(game.pressed, []);
    down([{ ...inside, id: 2 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await unmount(renderer);
  });

  it('refreshes nested measurements on pad layout and releases active ownership', async () => {
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    down([inside]); await flush();
    rect = { ...rect, x: 300 };
    layout(renderer, 'pad');
    assert.deepEqual(game.released, ['jump']);
    move([{ id: 1, x: 340, y: 150 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    down([{ id: 2, x: 340, y: 150 }]); await flush();
    assert.deepEqual(game.pressed, ['jump', 'jump']);
    await unmount(renderer);
  });

  it('refreshes pad-space bounds on a committed configuration render without another layout event', async () => {
    const game = session();
    const renderer = await mount(game);
    down([inside]); await flush();
    rect = { ...rect, x: 300 };
    await act(async () => renderer.update(tree(game)));
    assert.deepEqual(game.released, ['jump']);
    down([{ ...inside, id: 2 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    down([{ id: 3, x: 340, y: 150 }]); await flush();
    assert.deepEqual(game.pressed, ['jump', 'jump']);
    await unmount(renderer);
  });

  it('removes stale bounds after measurement fails and rejects zero-area hit slop zones', async () => {
    const game = session();
    const renderer = await mount(game);
    down([inside]); await flush();
    measurementFails = true;
    await act(async () => renderer.update(tree(game)));
    assert.deepEqual(game.released, ['jump']);
    down([{ ...inside, id: 2 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    measurementFails = false;
    rect = { x: 0, y: 0, width: 0, height: 0 };
    await act(async () => renderer.update(tree(game, 'jump', 20)));
    down([{ id: 3, x: 0, y: 0 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await unmount(renderer);
  });

  it('ignores downs while paused and queued paused downs after rapid resume', async () => {
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    game.setStatus('paused');
    down([inside]);
    assert.equal(scheduled.length, 0, 'paused input never crosses to RN');
    await flush();
    assert.deepEqual(game.pressed, []);
    down([{ ...inside, id: 2 }]);
    game.setStatus('running');
    await flush();
    assert.deepEqual(game.pressed, []);
    await unmount(renderer);
  });

  it('does not reactivate an old finger when another finger lands after resume', async () => {
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    down([inside]); await flush();
    game.setStatus('paused'); game.setStatus('running');
    const outside = { id: 2, x: 500, y: 500 };
    down([outside], [inside, outside]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await unmount(renderer);
  });

  it('transfers only compact changed-touch packets to RN', async () => {
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    down([{ ...inside, absoluteX: 300, absoluteY: 400 } as Touch]);
    assert.deepEqual(scheduled[0]!.args[1], [inside]);
    await flush();
    await unmount(renderer);
  });

  it('updates hitSlop without remounting the pad', async () => {
    const game = session();
    const renderer = await mount(game);
    layout(renderer);
    await act(async () => renderer.update(tree(game, 'jump', 20)));
    down([{ id: 1, x: 100, y: 150 }]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await unmount(renderer);
  });

  it('survives StrictMode effect rehearsal with native refs and stable ownership', async () => {
    const game = session();
    const renderer = await mount(game, true);
    down([inside]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    await unmount(renderer);
    assert.deepEqual(game.released, ['jump']);
  });

  it('rejects callbacks from the replaced session even when they read the live shared generation', async () => {
    const first = session();
    const second = session();
    const renderer = await mount(first);
    const oldDown = config.onTouchesDown!;
    await act(async () => renderer.update(tree(second)));
    oldDown({ changedTouches: [inside], allTouches: [inside] });
    await flush();
    assert.deepEqual(first.pressed, []);
    assert.deepEqual(second.pressed, []);
    down([inside]); await flush();
    assert.deepEqual(second.pressed, ['jump']);
    await unmount(renderer);
  });

  it('does not schedule callbacks from an unmounted pad', async () => {
    const game = session();
    const renderer = await mount(game);
    const oldDown = config.onTouchesDown!;
    await unmount(renderer);
    oldDown({ changedTouches: [inside], allTouches: [inside] });
    assert.deepEqual(scheduled, []);
    assert.deepEqual(game.pressed, []);
  });

  it('rolls back the status subscription when commit subscription setup fails', async () => {
    const game = session();
    const failure = new Error('commit subscription failed');
    let removed = 0;
    game.addStatusListener = () => ({ remove: () => { removed += 1; return true; } });
    game.addCommitListener = () => { throw failure; };
    await assert.rejects(async () => { await mount(game); }, failure);
    assert.equal(removed, 1);
    down([inside]);
    assert.deepEqual(scheduled, [], 'failed setup retires the UI callback lifetime');
  });

  it('removes all listeners even when releasing held input fails', async () => {
    const game = session();
    const failure = new Error('input release failed');
    const removed: string[] = [];
    game.addStatusListener = () => ({ remove: () => { removed.push('status'); return true; } });
    game.addCommitListener = () => ({ remove: () => { removed.push('commit'); } });
    game.input.release = () => { throw failure; };
    const renderer = await mount(game);
    down([inside]); await flush();
    await assert.rejects(async () => { await unmount(renderer); }, failure);
    assert.deepEqual(removed.sort(), ['commit', 'status']);
    down([inside]);
    assert.deepEqual(scheduled, [], 'failed cleanup still retires the UI callback lifetime');
  });

  it('preserves setup and rollback errors when both fail', async () => {
    const game = session();
    const setupFailure = new Error('commit subscription failed');
    const cleanupFailure = new Error('status removal failed');
    game.addStatusListener = () => ({ remove: () => { throw cleanupFailure; } });
    game.addCommitListener = () => { throw setupFailure; };
    await assert.rejects(async () => { await mount(game); }, (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [setupFailure, cleanupFailure]);
      return true;
    });
    down([inside]);
    assert.deepEqual(scheduled, []);
  });

  it('finalize drains ownership even if native delivers no changed-touch cancellation', async () => {
    const game = session();
    const renderer = await mount(game);
    down([inside]); await flush();
    config.onFinalize!({ canceled: true }); await flush();
    assert.deepEqual(game.released, ['jump']);
    move([inside]); await flush();
    assert.deepEqual(game.pressed, ['jump']);
    down([{ ...inside, id: 2 }]); await flush();
    assert.deepEqual(game.pressed, ['jump', 'jump']);
    await unmount(renderer);
  });

  it('cancel drains ownership even when the changed touch list is empty', async () => {
    const game = session();
    const renderer = await mount(game);
    down([inside]); await flush();
    config.onTouchesCancel!({ changedTouches: [], allTouches: [] }); await flush();
    assert.deepEqual(game.released, ['jump']);
    await unmount(renderer);
  });

  it('running restart drops queued downs and allows a fresh down after a held input reset', async () => {
    const driver = new ManualFrameDriver();
    const game = createGameSessionWithDriver(defineGame({
      viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
      input: { jump: { type: 'button' } },
      scenes: { play: defineScene({
        actions: ['jump'], create: () => ({ jumps: 0 }),
        update: ({ state, input }) => ({ jumps: state.jumps + (input.button('jump').pressed ? 1 : 0) }),
        snapshot: ({ state }) => state,
      }) },
      initialScene: 'play',
    }), { frameDriver: driver });
    game.start();
    driver.fireNext(0);
    const renderer = await mount(game as unknown as Game);
    down([inside]);
    game.restartScene();
    driver.fireNext(1000 / 60);
    const afterRestart = game.input.acceptedCount;
    await flush();
    assert.equal(game.input.acceptedCount, afterRestart, 'queued pre-restart down is rejected');
    down([{ ...inside, id: 2 }]); await flush();
    assert.equal(game.input.acceptedCount, afterRestart + 1);
    game.restartScene();
    driver.fireNext(2000 / 60);
    const afterHeldRestart = game.input.acceptedCount;
    move([{ ...inside, id: 2 }]); await flush();
    down([{ ...inside, id: 3 }], [{ ...inside, id: 2 }, { ...inside, id: 3 }]); await flush();
    assert.equal(game.input.acceptedCount, afterHeldRestart + 1, 'fresh finger presses despite the old physical finger');
    await unmount(renderer);
    game.dispose();
  });
});
