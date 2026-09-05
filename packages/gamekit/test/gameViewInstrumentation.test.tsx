/**
 * GS-REACT-01 — disabled instrumentation performs no diagnostic round trip.
 *
 * The UI frame callback branches BEFORE timestamp reads and RN scheduling
 * when no `onUiRevisionObserved` observer is installed: executing the actual
 * registered frame callback across multiple revisions schedules nothing and
 * reads no timestamps. An enabled observer still reports the first UI
 * observation once per revision, and replacing instrumentation never
 * restarts the session.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { defineGame, defineScene } from '../src/index';
import type { GameViewInstrumentation } from '../src/react/instrumentation';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

function host(tag: string) {
  const Component = ({ children, ...props }: Record<string, unknown>): unknown =>
    createElement(tag, props as never, children as never);
  (Component as { displayName?: string }).displayName = tag;
  return Component;
}

let capturedFrameCallback: ((info: { timeSincePreviousFrame?: number }) => void) | null = null;
const scheduledCalls: unknown[][] = [];
let dateNowCalls = 0;
const realDateNow = Date.now;

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => undefined }),
    },
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: { Canvas: host('canvas') },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: () => ({}),
    useFrameCallback: (callback: (info: { timeSincePreviousFrame?: number }) => void) => {
      capturedFrameCallback = callback;
    },
  },
});
mock.module('react-native-worklets', {
  namedExports: {
    // The RN crossing itself is mocked away; the callback still runs so
    // observer delivery is observable headlessly.
    scheduleOnRN: (callback: (...args: never[]) => void, ...args: never[]) => {
      scheduledCalls.push([callback, ...args]);
      callback(...args);
    },
  },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type GameViewModule = typeof import('../src/react/GameView');
let GameView: GameViewModule['GameView'];

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

function tickGame() {
  return defineGame({
    viewport,
    input: {},
    scenes: {
      main: defineScene({
        actions: [],
        create: () => ({ count: 0 }),
        update: ({ state }: { state: { readonly count: number } }) => ({
          count: state.count + 1,
        }),
        snapshot: ({ state }: { state: { readonly count: number } }) => ({
          count: state.count,
        }),
      }),
    },
    initialScene: 'main',
  });
}

before(async () => {
  GameView = (await import('../src/react/GameView.tsx')).GameView;
});

async function mount(
  ui: React.ReactElement,
): Promise<{ readonly renderer: ReturnType<typeof create> }> {
  capturedFrameCallback = null;
  scheduledCalls.length = 0;
  let renderer: ReturnType<typeof create> | null = null;
  await act(async () => {
    renderer = create(ui);
  });
  assert.ok(capturedFrameCallback !== null, 'the frame callback is registered');
  return { renderer: renderer! };
}

function uiFrame(): void {
  capturedFrameCallback!({ timeSincePreviousFrame: 16 });
}

describe('GS-REACT-01 instrumentation round trip', () => {
  it('executes the frame callback with no diagnostic scheduling or timing reads when disabled', async () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(tickGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const { renderer } = await mount(
      createElement(GameView as never, {
        game: session,
        renderer: host('renderer'),
      } as never),
    );
    assert.equal(session.status, 'running');

    dateNowCalls = 0;
    Date.now = () => {
      dateNowCalls += 1;
      return realDateNow();
    };
    try {
      driver.fireNext(0);
      uiFrame();
      driver.fireNext(16);
      uiFrame();
      driver.fireNext(32);
      uiFrame();
    } finally {
      Date.now = realDateNow;
    }

    assert.equal(session.getRenderFrame().tick, 3, 'commits advanced across revisions');
    assert.equal(scheduledCalls.length, 0, 'no RN scheduling without an observer');
    assert.equal(dateNowCalls, 0, 'no timestamp reads without an observer');
    renderer.unmount();
    session.dispose();
  });

  it('reports the first UI observation once per revision when enabled', async () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(tickGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const observed: { revision: number; atMs: number }[] = [];
    const instrumentation: GameViewInstrumentation = {
      onUiRevisionObserved: (revision, atMs) => {
        observed.push({ revision, atMs });
      },
    };
    const { renderer } = await mount(
      createElement(GameView as never, {
        game: session,
        renderer: host('renderer'),
        instrumentation,
      } as never),
    );

    driver.fireNext(0);
    uiFrame();
    uiFrame();
    assert.deepEqual(
      observed.map((entry) => entry.revision),
      [1],
      'one report for the first observation of the revision',
    );
    driver.fireNext(16);
    uiFrame();
    assert.deepEqual(
      observed.map((entry) => entry.revision),
      [1, 2],
      'the next revision reports exactly once',
    );
    assert.ok(
      observed.every((entry) => Number.isFinite(entry.atMs)),
      'reports carry timestamps',
    );
    renderer.unmount();
    session.dispose();
  });

  it('replacing instrumentation does not restart the session', async () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(tickGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const first: GameViewInstrumentation = { onUiRevisionObserved: () => {} };
    const { renderer } = await mount(
      createElement(GameView as never, {
        game: session,
        renderer: host('renderer'),
        instrumentation: first,
      } as never),
    );
    driver.fireNext(0);
    const pendingBefore = driver.pendingCount;
    const observed: number[] = [];
    const second: GameViewInstrumentation = {
      onUiRevisionObserved: (revision) => {
        observed.push(revision);
      },
    };
    await act(async () => {
      renderer.update(
        createElement(GameView as never, {
          game: session,
          renderer: host('renderer'),
          instrumentation: second,
        } as never),
      );
    });
    assert.equal(session.status, 'running', 'no restart on instrumentation replacement');
    assert.equal(driver.pendingCount, pendingBefore, 'the scheduled loop is untouched');
    driver.fireNext(16);
    uiFrame();
    assert.deepEqual(observed, [2], 'the replacement observer reports new revisions');
    renderer.unmount();
    session.dispose();
  });

  it('Strict Mode setup/cleanup rehearsals leave no scheduled loop behind', async () => {
    const { StrictMode } = await import('react');
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(tickGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          StrictMode,
          null,
          createElement(GameView as never, {
            game: session,
            renderer: host('renderer'),
          } as never),
        ),
      );
    });
    assert.equal(session.status, 'running', 'the rehearsed mount still binds');
    await act(async () => {
      renderer!.unmount();
    });
    assert.equal(session.status, 'paused', 'unmount pauses the borrowed session');
    assert.equal(driver.pendingCount, 0, 'no scheduled callback survives unmount');
    session.dispose();
  });

  it('unmounting a disposed session is safe', async () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(tickGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const { renderer } = await mount(
      createElement(GameView as never, {
        game: session,
        renderer: host('renderer'),
      } as never),
    );
    session.dispose();
    await act(async () => {
      renderer.unmount();
    });
    assert.equal(driver.pendingCount, 0, 'no scheduled callback survives');
  });

  it('a throwing session start releases the status subscription the effect acquired', async () => {
    const counts = { commit: 0, status: 0 };
    const stubSession = {
      status: 'idle',
      viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
      input: {},
      getRenderFrame: () => ({ revision: 0, scene: 'main', tick: 0, stepMs: 10 }),
      addCommitListener: () => {
        counts.commit += 1;
        return {
          remove: () => {
            counts.commit -= 1;
          },
        };
      },
      addStatusListener: () => {
        counts.status += 1;
        return {
          remove: () => {
            counts.status -= 1;
          },
        };
      },
      start: () => {
        throw new Error('session start exploded');
      },
      pause: () => {},
    };
    const caught: unknown[] = [];
    class Boundary extends (await import('react')).Component<{
      readonly children?: React.ReactNode;
    }> {
      state: { readonly error?: unknown } = {};
      static getDerivedStateFromError(error: unknown): { readonly error: unknown } {
        return { error };
      }
      componentDidCatch(error: unknown): void {
        caught.push(error);
      }
      render(): React.ReactNode {
        if ('error' in this.state) {
          return null;
        }
        return (this.props as { readonly children?: React.ReactNode }).children ?? null;
      }
    }
    await act(async () => {
      create(
        createElement(Boundary, null, createElement(GameView as never, {
          game: stubSession,
          renderer: host('renderer'),
        } as never)),
      );
    });
    assert.equal(caught.length, 1, 'the effect failure reaches the boundary');
    assert.match(String((caught[0] as Error)?.message ?? caught[0]), /session start exploded/);
    assert.equal(counts.commit, 0, 'the binder released its commit listener');
    assert.equal(counts.status, 0, 'the effect released its status subscription');
  });
});
