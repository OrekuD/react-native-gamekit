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
import { createElement, useRef } from 'react';
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
const samplerChanges: boolean[] = [];
const dispatchResults: { seq: number; accepted: boolean }[] = [];
const dispatchRejections: string[] = [];

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
    useFrameCallback: () => {
      frameCallbackCount += 1;
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
  dispose(): void;
  getRenderFrame(): { readonly current: unknown };
};
let game: GameDefinition<never, never, never, never, Record<string, never>>;
let createSessionWithDriver: typeof createGameSessionWithDriver;
let ManualFrameDriverClass: typeof ManualFrameDriver;

function viewportBinding() {
  return {
    resolved: viewport,
    subscribe: () => () => {},
  };
}

async function mountPointerInput(session: Session): Promise<ReturnType<typeof create>> {
  let renderer: ReturnType<typeof create> | null = null;
  await act(async () => {
    renderer = create(
      createElement(
        GameViewportContext.Provider as never,
        {
          value: {
            binding: viewportBinding(),
            viewport: { value: viewport },
          },
        },
        createElement(
          GameCameraContext.Provider as never,
          { value: { presented: undefined } },
          createElement(GamePointerInput as never, {
            game: session,
            action: 'primary',
            instrumentation: {
              onSamplerChanged: (active: boolean) => {
                samplerChanges.push(active);
              },
              onDispatchResult: (seq: number, _atMs: number, accepted: boolean) => {
                dispatchResults.push({ seq, accepted });
              },
              onDispatchRejected: (cause: string) => {
                dispatchRejections.push(cause);
              },
            },
          } as never),
        ),
      ),
    );
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
});

function resetInstrumentation(): void {
  scheduled.length = 0;
  samplerChanges.length = 0;
  dispatchResults.length = 0;
  dispatchRejections.length = 0;
}

describe('GS-INPUT-04 pointer adapter invalidation', () => {
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
