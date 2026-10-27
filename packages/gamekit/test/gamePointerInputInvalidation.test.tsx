/**
 * GS-INPUT-04 pointer adapter invalidation (mounted).
 *
 * Pause while a pointer is down clears the UI coalescer, advances the
 * packet epoch, and clears the React sampler mirror — the trailing sampler
 * unmounts even when no later coalescer event arrives. Deferred (queued)
 * pre-pause packets die at RN ingress; post-resume moves without a fresh
 * down produce nothing; a fresh down works. Session snapshots prove no held
 * action is resurrected.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, StrictMode, useEffect, useRef } from 'react';
import { act, create } from 'react-test-renderer';

// Source modules load dynamically in before(), after the mocks above:
// static VALUE imports would evaluate the library graph first and pull
// real native modules. Type-only imports erase fully and are always safe.
import type { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import type { ManualFrameDriver } from './helpers/ManualFrameDriver';
import type { GameDefinition } from '../src/definition/types';

function host(tag: string) {
  const Component = ({ children, ...props }: Record<string, unknown>): unknown =>
    createElement(tag, props as never, children as never);
  (Component as { displayName?: string }).displayName = tag;
  return Component;
}

// Deferred RN callbacks: tests pause/replace, then flush.
const scheduled: Array<() => void> = [];
let gestureConfig: Record<string, (event: unknown) => void> = {};
let frameCallbackCount = 0;
const activeFrameCallbacks = new Set<{ current: () => void }>();
const samplerChanges: boolean[] = [];
const dispatchResults: { seq: number; accepted: boolean }[] = [];
const dispatchRejections: string[] = [];
const pointerSamples: unknown[] = [];

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    },
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: { Canvas: host('canvas') },
});
mock.module('react-native-gesture-handler', {
  namedExports: {
    GestureDetector: function GestureDetector(props: { readonly children?: unknown }) {
      return (props as { children?: unknown }).children ?? null;
    },
    GestureStateManager: { activate: () => {}, deactivate: () => {}, fail: () => {} },
    useManualGesture: (config: Record<string, (event: unknown) => void>) => {
      gestureConfig = config;
      return {};
    },
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    // Stable per hook instance (via a real ref): fresh objects every render
    // would retrigger every effect keyed on a shared value and corrupt the
    // very lifecycle the tests observe.
    useSharedValue: (initial: unknown) => {
      const box = useRef<{ value: unknown } | null>(null);
      if (box.current === null) {
        box.current = {
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        };
      }
      return box.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: () => ({}),
    useFrameCallback: (callback: () => void) => {
      const current = useRef(callback);
      current.current = callback;
      useEffect(() => {
        frameCallbackCount += 1;
        activeFrameCallbacks.add(current);
        return () => { activeFrameCallbacks.delete(current); };
      }, []);
    },
    withTiming: (value: unknown) => value,
  },
});
mock.module('react-native-worklets', {
  namedExports: {
    scheduleOnRN: (fn: (...args: never[]) => void, ...args: never[]) => {
      scheduled.push(() => fn(...args));
    },
  },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PointerModule = typeof import('../src/react/GamePointerInput');
let GamePointerInput: PointerModule['GamePointerInput'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ViewModule = typeof import('../src/react/GameView');
let GameViewportContext: ViewModule['GameViewportContext'];
let GameCameraContext: ViewModule['GameCameraContext'];

const viewport = {
  surfaceSize: { width: 320, height: 480 },
  logicalBounds: { x: 0, y: 0, width: 320, height: 480 },
  visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 },
  contentBounds: { x: 0, y: 0, width: 320, height: 480 },
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

type Session = {
  readonly status: string;
  start(): void;
  pause(): void;
  restartScene(): void;
  dispose(): void;
  readonly input: { getResetRevision(action: string): number };
  getRenderFrame(): { readonly current: unknown };
};
let game: GameDefinition<never, never, never, never, Record<string, never>>;
let transitionGame: typeof game;
let droppingGame: typeof game;
let createSessionWithDriver: typeof createGameSessionWithDriver;
let ManualFrameDriverClass: typeof ManualFrameDriver;

function viewportBinding() {
  const listeners = new Set<() => void>();
  return {
    resolved: viewport,
    viewport: { value: viewport },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    revise: () => { for (const listener of listeners) listener(); },
    listenerCount: () => listeners.size,
  };
}

function pointerElement(
  session: Session,
  binding = viewportBinding(),
  strict = false,
  sampleListener: ((sample: unknown) => void) | null = (sample) => { pointerSamples.push(sample); },
) {
  const element = createElement(
    GameViewportContext.Provider as never,
    { value: { binding, viewport: binding.viewport } },
    createElement(
      GameCameraContext.Provider as never,
      { value: { presented: undefined } },
      createElement(GamePointerInput as never, {
        game: session,
        action: 'primary',
        instrumentation: {
          onSamplerChanged: (active: boolean) => { samplerChanges.push(active); },
          onDispatchResult: (seq: number, _atMs: number, accepted: boolean) => {
            dispatchResults.push({ seq, accepted });
          },
          onDispatchRejected: (cause: string) => { dispatchRejections.push(cause); },
          onPointerSample: sampleListener ?? undefined,
        },
      } as never),
    ),
  );
  return strict ? createElement(StrictMode, null, element) : element;
}

async function mountPointerInput(session: Session, binding = viewportBinding(), strict = false): Promise<ReturnType<typeof create>> {
  let renderer: ReturnType<typeof create> | null = null;
  await act(async () => {
    renderer = create(pointerElement(session, binding, strict));
  });
  return renderer!;
}

async function flushScheduled(): Promise<void> {
  await act(async () => {
    const pending = scheduled.splice(0);
    for (const fn of pending) {
      fn();
    }
  });
}

function down(id: number, x = 100, y = 100): void {
  gestureConfig.onTouchesDown?.({
    changedTouches: [{ id, x, y }],
    numberOfTouches: 1,
    handlerTag: 7,
  });
}

function move(id: number, x = 110, y = 110): void {
  gestureConfig.onTouchesMove?.({
    changedTouches: [{ id, x, y }],
    numberOfTouches: 1,
    handlerTag: 7,
  });
}

function cancelGesture(): void {
  gestureConfig.onTouchesCancel?.({ changedTouches: [], numberOfTouches: 0, handlerTag: 7 });
}

function up(id: number): void {
  gestureConfig.onTouchesUp?.({
    changedTouches: [{ id, x: 120, y: 120 }], numberOfTouches: 0, handlerTag: 7,
  });
}

function activeNow(session: Session, driver: ManualFrameDriver, atMs: number): boolean {
  // Two fires: the first may only establish the post-start baseline, the
  // second runs a step that samples the input buffer into the snapshot.
  driver.fireNext(atMs);
  driver.fireNext(atMs + 16);
  const frame = session.getRenderFrame().current as unknown as { activeNow: boolean };
  return frame.activeNow;
}

before(async () => {
  GamePointerInput = (await import('../src/react/GamePointerInput.tsx')).GamePointerInput;
  const view = await import('../src/react/GameView.tsx');
  GameViewportContext = view.GameViewportContext;
  GameCameraContext = view.GameCameraContext;
  const definition = await import('../src/index.ts');
  const sessionModule = await import('../src/core/session/createGameSession.ts');
  const helpers = await import('./helpers/ManualFrameDriver.ts');
  createSessionWithDriver = sessionModule.createGameSessionWithDriver;
  ManualFrameDriverClass = helpers.ManualFrameDriver;
  game = definition.defineGame({
    viewport: { logicalSize: { width: 320, height: 480 }, mode: 'fit' },
    input: { primary: { type: 'pointer' } },
    scenes: {
      main: definition.defineScene({
        actions: ['primary'],
        create: () => ({ activeNow: false }),
        update: ({ input }) => ({
          activeNow: input.pointer('primary').active,
        }),
        snapshot: ({ state }) => state,
      }),
    },
    initialScene: 'main',
  }) as unknown as GameDefinition<never, never, never, never, Record<string, never>>;
  const makeTransitionGame = (preserve: boolean) => definition.defineGame({
    viewport: { logicalSize: { width: 320, height: 480 }, mode: 'fit' },
    input: { primary: { type: 'pointer' }, secondary: { type: 'pointer' } },
    scenes: {
      source: definition.defineScene({
        actions: ['primary', 'secondary'],
        transitions: ['target'],
        create: () => ({ activeNow: false }),
        update: ({ input, transition }) => {
          if (input.pointer('primary').active) transition.setScene('target');
          return { activeNow: input.pointer('primary').active };
        },
        snapshot: ({ state }) => state,
      }),
      target: definition.defineScene({
        actions: preserve ? ['primary'] : [],
        create: () => ({ activeNow: false }),
        update: ({ input }) => ({ activeNow: preserve && input.pointer('primary').active }),
        snapshot: ({ state }) => state,
      }),
    },
    initialScene: 'source',
  }) as unknown as typeof game;
  transitionGame = makeTransitionGame(true);
  droppingGame = makeTransitionGame(false);
});

function resetInstrumentation(): void {
  scheduled.length = 0;
  samplerChanges.length = 0;
  dispatchResults.length = 0;
  dispatchRejections.length = 0;
  pointerSamples.length = 0;
}

describe('GS-INPUT-04 pointer adapter invalidation', () => {
  it('updates and removes RN sample instrumentation without retiring a live drag', async () => {
    resetInstrumentation();
    const clock = mock.method(Date, 'now', () => 1000);
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const binding = viewportBinding();
    const renderer = await mountPointerInput(session, binding);
    try {
      down(1);
      await flushScheduled();
      const initialGesture = gestureConfig;
      const initialFrameCount = frameCallbackCount;
      const replacements: unknown[] = [];
      await act(async () => { renderer.update(pointerElement(session, binding, false, (sample) => { replacements.push(sample); })); });
      clock.mock.mockImplementation(() => 1020);
      move(1);
      await flushScheduled();
      assert.equal(pointerSamples.length, 1);
      assert.equal(replacements.length, 1);
      await act(async () => { renderer.update(pointerElement(session, binding, false, null)); });
      clock.mock.mockImplementation(() => 1040);
      move(1, 160, 160);
      await flushScheduled();
      assert.equal(replacements.length, 1, 'removed instrumentation receives no samples');
      assert.equal(gestureConfig, initialGesture, 'RN instrumentation changes do not replace native handlers');
      assert.equal(frameCallbackCount, initialFrameCount, 'the same sampler remains registered');
      assert.equal(activeNow(session, driver, 0), true);
    } finally {
      clock.mock.restore();
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('rejects a queued begin after a running restart commits without a status change', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      down(1);
      await act(async () => { session.restartScene(); driver.fireNext(0); });
      assert.equal(session.status, 'running');
      await flushScheduled();
      assert.equal(activeNow(session, driver, 16), false);
      assert.equal(activeFrameCallbacks.size, 0);
      assert.deepEqual(dispatchResults.map(({ accepted }) => accepted), [false]);
      down(2);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 48), true);
    } finally {
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('retires a live drag on restart and rejects its later move until a fresh down', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      down(1);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 0), true);
      await act(async () => { session.restartScene(); driver.fireNext(32); });
      assert.equal(activeFrameCallbacks.size, 0);
      move(1);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 48), false);
      up(1);
      down(2);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 80), true);
    } finally {
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('preserves a held pointer and sampler through a compatible update-scoped handoff', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(transitionGame, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      const primaryRevision = session.input.getResetRevision('primary');
      const secondaryRevision = session.input.getResetRevision('secondary');
      down(1);
      await flushScheduled();
      await act(async () => { driver.fireNext(0); driver.fireNext(16); });
      assert.equal(session.input.getResetRevision('primary'), primaryRevision);
      assert.ok(session.input.getResetRevision('secondary') > secondaryRevision);
      assert.equal(activeFrameCallbacks.size, 1, 'resetting another action does not retire this sampler');
      assert.equal(activeNow(session, driver, 32), true);
      up(1);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 64), false, 'the same physical stream can still release');
      assert.deepEqual(samplerChanges, [true, false]);
    } finally {
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('retires a held pointer when the target scene drops its action', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(droppingGame, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      down(1);
      await flushScheduled();
      await act(async () => { driver.fireNext(0); driver.fireNext(16); });
      assert.equal(activeFrameCallbacks.size, 0);
      move(1);
      assert.equal(scheduled.length, 0, 'an old physical stream cannot reacquire after handoff');
      assert.equal(activeNow(session, driver, 32), false);
    } finally {
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('ignores retired native handlers and sampler callbacks after viewport owner replacement', async () => {
    resetInstrumentation();
    const clock = mock.method(Date, 'now', () => 1000);
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      down(1);
      await flushScheduled();
      const oldGesture = gestureConfig;
      const oldFrameCallback = [...activeFrameCallbacks][0]!.current;
      await act(async () => { renderer.update(pointerElement(session, viewportBinding())); });
      oldGesture.onTouchesDown?.({ changedTouches: [{ id: 9, x: 100, y: 100 }], numberOfTouches: 1, handlerTag: 7 });
      assert.equal(scheduled.length, 0, 'retired handlers cannot acquire the new coalescer');
      down(2);
      await flushScheduled();
      move(2, 150, 150);
      clock.mock.mockImplementation(() => 1020);
      oldFrameCallback();
      assert.equal(scheduled.length, 0, 'retired sampler cannot consume the new stream deferred move');
      [...activeFrameCallbacks][0]!.current();
      assert.equal(scheduled.length, 1, 'the current sampler still forwards that move');
      await flushScheduled();
    } finally {
      clock.mock.restore();
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('does not mount a sampler from a queued begin retired by pause/resume', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      down(1);
      await act(async () => { session.pause(); session.start(); });
      await flushScheduled();
      assert.deepEqual(samplerChanges, [], 'a rejected packet cannot own a frame callback');
      assert.equal(activeFrameCallbacks.size, 0);
    } finally {
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('recreates its committed binding after StrictMode effect rehearsal', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const binding = viewportBinding();
    const renderer = await mountPointerInput(session, binding, true);
    try {
      down(1);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 0), true, 'live binding accepts down after rehearsal');
      assert.deepEqual(pointerSamples, [{
        surface: { x: 100, y: 100 }, viewport, camera: undefined, world: { x: 100, y: 100 },
      }], 'the RN instrumentation observes the actual conversion once');
      assert.equal(binding.listenerCount(), 1);
    } finally {
      await act(async () => { renderer.unmount(); });
      assert.equal(binding.listenerCount(), 0);
      session.dispose();
    }
  });

  it('retires active and queued work when the session is disposed before unmount', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      down(1);
      await flushScheduled();
      up(1);
      await act(async () => { session.dispose(); });
      assert.equal(activeFrameCallbacks.size, 0, 'dispose retires the sampler immediately');
      await flushScheduled();
      assert.deepEqual(samplerChanges, [true, false]);
      down(2);
      assert.equal(scheduled.length, 0, 'disposed UI handler is inert');
    } finally {
      await act(async () => { renderer.unmount(); });
    }
  });

  it('invalidates a live stream on layout revision and requires a fresh down', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const binding = viewportBinding();
    const renderer = await mountPointerInput(session, binding);
    try {
      down(1);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 0), true);
      move(1);
      await act(async () => { binding.revise(); });
      await flushScheduled();
      assert.equal(activeFrameCallbacks.size, 0);
      assert.equal(activeNow(session, driver, 32), false);
      move(1, 150, 150);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 64), false);
      up(1);
      down(2);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 96), true);
    } finally {
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('uses one RN crossing per ordered edge and ignores a late older begin', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      down(1);
      up(1);
      assert.equal(scheduled.length, 2, 'each edge carries its own sampler ownership');
      scheduled.reverse();
      await flushScheduled();
      assert.equal(activeNow(session, driver, 0), false);
      assert.equal(activeFrameCallbacks.size, 0);
      assert.deepEqual(dispatchResults.map(({ accepted }) => accepted), [true, false]);
    } finally {
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('ignores native downs during pause until a fresh post-resume down', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    session.start();
    const renderer = await mountPointerInput(session);
    try {
      await act(async () => { session.pause(); });
      down(1);
      assert.equal(scheduled.length, 0);
      await act(async () => { session.start(); });
      move(1);
      assert.equal(scheduled.length, 0);
      down(2);
      await flushScheduled();
      assert.equal(activeNow(session, driver, 0), true);
    } finally {
      await act(async () => { renderer.unmount(); });
      session.dispose();
    }
  });

  it('pause while down clears the sampler even with no later coalescer event', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    await act(async () => {
      session.start();
    });
    const renderer = await mountPointerInput(session);
    const samplersBefore = frameCallbackCount;

    down(1);
    await flushScheduled();
    driver.fireNext(0);
    assert.equal(activeNow(session, driver, 16), true, 'the down reaches the session');
    assert.deepEqual(
      samplerChanges.slice(-1),
      [true],
      'the trailing sampler mounts while the pointer is down',
    );
    const samplersWhileDown = frameCallbackCount;
    assert.ok(samplersWhileDown > samplersBefore, 'sampler frame callback registered');

    await act(async () => {
      session.pause();
    });
    assert.deepEqual(
      samplerChanges.slice(-1),
      [false],
      'pause clears the React sampler mirror immediately',
    );
    assert.equal(
      frameCallbackCount,
      samplersWhileDown,
      'no new sampler registers after pause',
    );

    // A late native cancel/finalize produces no coalescer event (the
    // coalescer was reset) and must not remount the sampler.
    cancelGesture();
    await flushScheduled();
    assert.deepEqual(samplerChanges.slice(-1), [false], 'no sampler resurrection');
    assert.equal(frameCallbackCount, samplersWhileDown, 'still no new sampler');

    await act(async () => {
      session.start();
    });
    assert.equal(activeNow(session, driver, 48), false, 'no held action in the session');

    await act(async () => {
      renderer.unmount();
    });
    session.dispose();
  });

  it('deferred pre-pause packets die at ingress; resume needs a fresh down', async () => {
    resetInstrumentation();
    const driver = new ManualFrameDriverClass();
    const session = createSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 }) as unknown as Session;
    await act(async () => {
      session.start();
    });
    const renderer = await mountPointerInput(session);

    // Queue a down but do not deliver it yet.
    down(1);
    await act(async () => {
      session.pause();
    });
    await flushScheduled();
    assert.ok(
      dispatchRejections.includes('layout-epoch'),
      'the queued packet dies on the bumped epoch',
    );

    await act(async () => {
      session.start();
    });
    assert.equal(activeNow(session, driver, 16), false, 'nothing was acquired');

    move(1, 120, 120);
    await flushScheduled();
    assert.equal(activeNow(session, driver, 48), false, 'moves alone acquire nothing');
    assert.ok(
      !dispatchResults.some((entry) => entry.accepted),
      'no packet accepted without a down',
    );

    down(2);
    await flushScheduled();
    assert.equal(activeNow(session, driver, 64), true, 'a fresh down acquires');
    await act(async () => {
      renderer.unmount();
    });
    session.dispose();
  });
});
