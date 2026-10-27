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
import { Component, createElement, useState } from 'react';
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
let deferScheduledCalls = false;
let sharedValueWrites = 0;
let appStateSetupError: Error | undefined;
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
      addEventListener: () => {
        if (appStateSetupError !== undefined) {
          throw appStateSetupError;
        }
        return { remove: () => undefined };
      },
    },
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: { Canvas: host('canvas') },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => useState(() => {
      let value = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return {
        get value() { return value; },
        set value(next: unknown) {
          sharedValueWrites += 1;
          value = next;
        },
      };
    })[0],
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
      if (!deferScheduledCalls) {
        callback(...args);
      }
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

function tickGame(initialCount = 0) {
  return defineGame({
    viewport,
    input: {},
    scenes: {
      main: defineScene({
        actions: [],
        create: () => ({ count: initialCount }),
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
  deferScheduledCalls = false;
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

function deliverScheduledCalls(): void {
  for (const [callback, ...args] of scheduledCalls.splice(0)) {
    (callback as (...args: unknown[]) => void)(...args);
  }
}

class ErrorBoundary extends Component<{
  readonly children?: React.ReactNode;
  readonly onError: (error: unknown) => void;
}> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: unknown): void { this.props.onError(error); }
  render(): React.ReactNode { return this.state.failed ? null : this.props.children; }
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
      sharedValueWrites = 0;
      uiFrame();
      assert.equal(sharedValueWrites, 3, 'only the three alpha-clock values are written');
      driver.fireNext(16);
      sharedValueWrites = 0;
      uiFrame();
      assert.equal(sharedValueWrites, 3, 'a new revision does not write diagnostic values');
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
    const callbackBefore = capturedFrameCallback;
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
    assert.equal(capturedFrameCallback, callbackBefore, 'the registered worklet is stable');
    driver.fireNext(16);
    uiFrame();
    assert.deepEqual(observed, [2], 'the replacement observer reports new revisions');
    renderer.unmount();
    session.dispose();
  });

  it('drops queued observations for replaced observers and samples the current revision afresh', async () => {
    const session = createGameSessionWithDriver(tickGame(), { frameDriver: new ManualFrameDriver() });
    const first: number[] = [];
    const second: number[] = [];
    const Renderer = host('renderer');
    const { renderer } = await mount(createElement(GameView as never, {
      game: session, renderer: Renderer,
      instrumentation: { onUiRevisionObserved: (revision: number) => first.push(revision) },
    } as never));
    deferScheduledCalls = true;
    uiFrame();
    assert.equal(scheduledCalls.length, 1);
    await act(async () => renderer.update(createElement(GameView as never, {
      game: session, renderer: Renderer,
      instrumentation: { onUiRevisionObserved: (revision: number) => second.push(revision) },
    } as never)));
    deliverScheduledCalls();
    assert.deepEqual(first, []);
    assert.deepEqual(second, [], 'the replacement must not receive the previous observer sample');
    uiFrame();
    uiFrame();
    deliverScheduledCalls();
    assert.deepEqual(second, [session.getRenderFrame().revision], 'new observer samples this revision once');
    await act(async () => renderer.unmount());
    session.dispose();
  });

  it('drops queued observations after unmount', async () => {
    const session = createGameSessionWithDriver(tickGame(), { frameDriver: new ManualFrameDriver() });
    const observed: number[] = [];
    const { renderer } = await mount(createElement(GameView as never, {
      game: session, renderer: host('renderer'),
      instrumentation: { onUiRevisionObserved: (revision: number) => observed.push(revision) },
    } as never));
    deferScheduledCalls = true;
    uiFrame();
    await act(async () => renderer.unmount());
    deliverScheduledCalls();
    assert.deepEqual(observed, []);
    assert.equal(session.status, 'paused');
    session.dispose();
  });

  it('isolates frames and queued observations when a session replaces one with the same explicit key', async () => {
    const first = createGameSessionWithDriver(tickGame(1), { frameDriver: new ManualFrameDriver() });
    const second = createGameSessionWithDriver(tickGame(100), { frameDriver: new ManualFrameDriver() });
    const rendered: number[] = [];
    const observed: number[] = [];
    const instrumentation = { onUiRevisionObserved: (revision: number) => observed.push(revision) };
    const Renderer = ({ frame }: { frame: { value: { current: { count: number } } } }) => {
      rendered.push(frame.value.current.count);
      return null;
    };
    const { renderer } = await mount(createElement(GameView as never, {
      game: first, presentationKey: 'surface', renderer: Renderer, instrumentation,
    } as never));
    deferScheduledCalls = true;
    uiFrame();
    rendered.length = 0;
    await act(async () => renderer.update(createElement(GameView as never, {
      game: second, presentationKey: 'surface', renderer: Renderer, instrumentation,
    } as never)));
    assert.deepEqual(rendered, [100], 'the replacement renderer starts with its own snapshot');
    deliverScheduledCalls();
    assert.deepEqual(observed, [], 'a retired session cannot deliver into its replacement');
    assert.equal(first.status, 'paused');
    assert.equal(second.status, 'running');
    await act(async () => renderer.unmount());
    first.dispose();
    second.dispose();
  });

  it('clears the presented camera when AppState setup fails', async () => {
    const session = createGameSessionWithDriver(tickGame(), { frameDriver: new ManualFrameDriver() });
    const failure = new Error('AppState setup failed');
    const caught: unknown[] = [];
    let camera: { value: unknown } | undefined;
    const Renderer = (props: { camera?: { value: unknown } }) => { camera = props.camera; return null; };
    appStateSetupError = failure;
    try {
      await act(async () => {
        create(createElement(ErrorBoundary, { onError: (error: unknown) => caught.push(error) },
          createElement(GameView as never, {
            game: session, renderer: Renderer,
            camera2D: { select: () => ({ center: { x: 0, y: 0 }, zoom: 1, rotationRadians: 0 }) },
          } as never)));
      });
    } finally {
      appStateSetupError = undefined;
    }
    assert.deepEqual(caught, [failure]);
    assert.equal(camera?.value, undefined, 'prepared camera resources unwind before the failed mount exits');
    assert.equal(session.status, 'paused');
    session.dispose();
  });

  it('treats the explicit key as a same-session reset without collapsing numeric key values', async () => {
    const session = createGameSessionWithDriver(tickGame(), { frameDriver: new ManualFrameDriver() });
    let presentedFrame: unknown;
    const Renderer = ({ frame }: { frame: unknown }) => { presentedFrame = frame; return null; };
    const { renderer } = await mount(createElement(GameView as never, {
      game: session, renderer: Renderer,
    } as never));
    let previous = presentedFrame;
    for (const key of [NaN, Infinity, -Infinity, 'Infinity', 1, '1']) {
      await act(async () => renderer.update(createElement(GameView as never, {
        game: session, renderer: Renderer, presentationKey: key,
      } as never)));
      assert.notEqual(presentedFrame, previous, `changing the reset key to ${String(key)} remounts`);
      previous = presentedFrame;
      await act(async () => renderer.update(createElement(GameView as never, {
        game: session, renderer: Renderer, presentationKey: key,
      } as never)));
      assert.equal(presentedFrame, previous, 'reusing the same key retains presentation');
    }
    assert.equal(session.status, 'running');
    await act(async () => renderer.unmount());
    session.dispose();
  });

  it('Strict Mode setup/cleanup rehearsals leave no scheduled loop behind', async () => {
    const { StrictMode } = await import('react');
    const driver = new ManualFrameDriver();
    const ownedSession = createGameSessionWithDriver(tickGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    let setups = 0;
    let releases = 0;
    const session = {
      ...ownedSession,
      get status() { return ownedSession.status; },
      addCommitListener(listener: Parameters<typeof ownedSession.addCommitListener>[0]) {
        setups += 1;
        const subscription = ownedSession.addCommitListener(listener);
        return { remove: () => { releases += 1; subscription.remove(); } };
      },
    };
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
    assert.equal(setups, 2, 'Strict Mode ran the binding setup twice');
    assert.equal(releases, 1, 'the rehearsal released the first binding');
    await act(async () => {
      renderer!.unmount();
    });
    assert.equal(session.status, 'paused', 'unmount pauses the borrowed session');
    assert.equal(driver.pendingCount, 0, 'no scheduled callback survives unmount');
    assert.equal(releases, 2, 'the final binding is released on unmount');
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
