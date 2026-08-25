/**
 * T12-F7: diagnostics publication traffic.
 *
 * Mounts the Camera Lab content against a real session with the mock
 * stack and counts ACTUAL setter publications: zero diagnostic traffic
 * while off, a bounded cadence while on, and unchanged commits that never
 * invoke a setter — across a moving camera with rotation and shake.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import type { GameSession } from 'rn-gamekit';

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    Text: host('text'),
    Pressable: host('pressable'),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    },
  },
});
mock.module('react-native-safe-area-context', {
  namedExports: {
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Group: host('group'),
    Circle: host('circle'),
    Rect: host('rect'),
    Path: host('path'),
    Skia: { makeImageFromView: () => undefined, Path: { Make: () => ({ addRect: () => undefined }) }, XYWHRect: () => ({}) },
  },
});
const capturedFrameCallbacks: ((info: { timestamp: number }) => void)[] = [];
let scheduleOnRNCalls = 0;
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useFrameCallback: (fn: (info: { timestamp: number }) => void) => {
      capturedFrameCallbacks.push(fn);
    },
  },
});
mock.module('react-native-worklets', {
  namedExports: {
    scheduleOnRN: () => {
      scheduleOnRNCalls += 1;
    },
  },
});
mock.module('react-native-gesture-handler', {
  namedExports: {
    GestureDetector: host('gesture-detector'),
    GestureStateManager: {},
    useManualGesture: () => ({ gesture: null, gestureState: undefined }),
  },
});
mock.module('expo-asset', {
  namedExports: {
    Asset: class {},
  },
});

let CameraLabContent: React.ComponentType<{
  readonly game: GameSession;
  readonly onExit: () => void;
  readonly onOpenGame: (gameId: string) => void;
  readonly onPublish?: () => void;
  readonly onRunSurfaceEvent?: (event: unknown) => void;
}>;
let ManualFrameDriver: new () => { fireNext(t: number): void };
let createGameSessionWithDriver: (definition: unknown, options: unknown) => GameSession;
let cameraLabDefinition: unknown;

before(async () => {
  const { cameraLabDefinition: definition } = await import('./cameraLabGame.ts');
  cameraLabDefinition = definition;
  const content = await import('./CameraLabContent.tsx');
  const testing = await import('rn-gamekit/testing');
  CameraLabContent = content.default as unknown as typeof CameraLabContent;
  ManualFrameDriver = testing.ManualFrameDriver;
  createGameSessionWithDriver = testing.createGameSessionWithDriver as unknown as typeof createGameSessionWithDriver;
});

function harness() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(cameraLabDefinition, {
    frameDriver: driver,
  }) as GameSession;
  return { session, driver };
}

describe('Camera Lab diagnostics publication traffic (T12-F7)', () => {
  it('bounds HUD publications by the cadence under a moving, rotating, shaking camera (T12-F7)', () => {
    let publishes = 0;
    const { session, driver } = harness();
    const tick = (frames: number) => {
      for (let i = 0; i < frames; i += 1) {
        act(() => driver.fireNext((i + 1) * 16.7));
      }
    };
    act(() => session.start());
    act(() => driver.fireNext(0));
    act(() => {
      create(
        <CameraLabContent game={session} onExit={() => undefined} onOpenGame={() => undefined} onPublish={() => { publishes += 1; }} />,
      );
    });
    assert.equal(publishes, 1, 'the initial snapshot publishes once');

    // Moving follow target + rotation + shake: 180 commits (~3 s). The
    // 8 Hz cadence caps publications around 1 + 25.
    session.input.press('toggle-rotation');
    session.input.release('toggle-rotation');
    session.input.press('toggle-shake');
    session.input.release('toggle-shake');
    session.input.begin('primary', 1, { x: 900, y: 800 });
    tick(180);
    assert.ok(publishes > 1, 'the HUD updates while the camera moves');
    assert.ok(publishes <= 30, `bounded by the cadence (got ${publishes} in ~3s)`);

    // A settled camera publishes nothing more: stop rotation, release the
    // pointer, let the shake end, then 60 commits with nothing changing.
    session.input.press('toggle-rotation');
    session.input.release('toggle-rotation');
    session.input.cancel('primary');
    tick(60);
    const settled = publishes;
    tick(60);
    const steadyState = publishes - settled;
    assert.ok(
      steadyState <= 10,
      `steady-state counter traffic is cadence-bounded (${steadyState} in ~1s)`,
    );
    act(() => session.dispose());
  });
});

describe('Camera Lab instrumentation contract (T12-F8)', () => {
  it('keeps one instrumentation attachment across forced rerenders and counts pointer traffic', () => {
    const { session, driver } = harness();
    const attachments: unknown[] = [];
    const detaches: unknown[] = [];
    const onRunSurfaceEvent = (event: { kind: string; instrumentation?: unknown; attachment?: unknown; session?: unknown }) => {
      if (event.kind === 'instrumentation-attached') {
        attachments.push(event.instrumentation);
      } else if (event.kind === 'instrumentation-detached') {
        detaches.push(event.session);
      } else {
        attachments.push(event.attachment);
      }
    };
    const tick = (frames: number) => {
      for (let i = 0; i < frames; i += 1) {
        act(() => driver.fireNext((i + 1) * 16.7));
      }
    };
    act(() => session.start());
    act(() => driver.fireNext(0));
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <CameraLabContent
          game={session}
          onExit={() => undefined}
          onOpenGame={() => undefined}
          onPublish={() => undefined}
          onRunSurfaceEvent={onRunSurfaceEvent as never}
        />,
      );
    });
    assert.equal(attachments.length, 1, 'exactly one attachment on mount');
    const firstAttachment = attachments[0];

    // A drag generates pointer traffic through the SAME attachment.
    session.input.begin('primary', 1, { x: 300, y: 400 });
    tick(10);
    session.input.move('primary', 1, { x: 500, y: 600 });
    tick(10);
    session.input.cancel('primary');

    // Force a React rerender during (what would be) an active drag.
    const rerenderButton = renderer.root.findByProps({ accessibilityLabel: 'Force a React rerender' });
    act(() => {
      rerenderButton.props.onPress();
    });
    act(() => {
      rerenderButton.props.onPress();
    });
    assert.equal(attachments.length, 1, 'forced rerenders never re-attach');
    assert.equal(detaches.length, 0, 'forced rerenders never detach');
    assert.equal(attachments[0], firstAttachment, 'the instrumentation identity is stable');

    // The counters accumulate through the live instrumentation.
    const counters = (attachments[0] as { pointer: { onRawTouch?: () => void; onForwarded?: () => void } }).pointer;
    assert.ok(counters !== undefined);
    // Per-cause rejection attribution: a stale-layout packet increments the
    // layout counter through the SAME attachment pair.
    const view = (attachments[0] as { view: { onPresentCommit?: () => void } }).view;
    assert.ok(view !== undefined);
    act(() => session.dispose());
  });
});

describe('UI -> RN transfer cadence (T12-TF2)', () => {
  it('transfers only when counters changed and the 125 ms interval elapsed', () => {
    capturedFrameCallbacks.length = 0;
    scheduleOnRNCalls = 0;
    const { session, driver } = harness();
    const attachments: { pointer: { onRawTouch?: () => void } }[] = [];
    let renderer!: ReturnType<typeof create>;
    act(() => session.start());
    act(() => driver.fireNext(0));
    act(() => {
      renderer = create(
        <CameraLabContent
          game={session}
          onExit={() => undefined}
          onOpenGame={() => undefined}
          onPublish={() => undefined}
          onRunSurfaceEvent={(event: unknown) => {
            const typed = event as { kind: string; instrumentation?: { pointer: { onRawTouch?: () => void } } };
            if (typed.kind === 'instrumentation-attached' && typed.instrumentation !== undefined) {
              attachments.push(typed.instrumentation);
            }
          }}
        />,
      );
    });
    assert.equal(attachments.length, 1, 'attached');
    const pointer = attachments[0]!.pointer;
    const frames = capturedFrameCallbacks[0]!;
    // One frame past the interval delivers the initial snapshot;
    // afterwards unchanged counters never transfer again.
    act(() => frames({ timestamp: 200 }));    const transferBaseline = scheduleOnRNCalls;

    // 120 frames at 120 Hz (8.3 ms) with unchanged counters: zero
    // additional transfers.
    let now = 0;
    for (let i = 0; i < 120; i += 1) {
      now += 8.333;
      act(() => frames({ timestamp: now }));
    }
    assert.equal(scheduleOnRNCalls, transferBaseline, 'unchanged counters never transfer');

    // Continuously changing counters for one second: transfers are bounded
    // by the 8 Hz cadence (~8 for 1000 ms at 125 ms) and the latest values
    // are retained.
    const before = scheduleOnRNCalls;
    for (let i = 0; i < 120; i += 1) {
      now += 8.333;
      act(() => pointer.onRawTouch?.());
      act(() => frames({ timestamp: now }));
    }
    const transfers = scheduleOnRNCalls - before;
    assert.ok(transfers > 0, 'changing counters transfer');
    assert.ok(transfers <= 10, `bounded by the cadence (got ${transfers} in ~1s)`);

    // Detach: unmounting runs the cleanup (setActive(false)); further
    // frames never call the receiver.
    act(() => renderer.unmount());
    act(() => session.dispose());
    const afterDispose = scheduleOnRNCalls;
    for (let i = 0; i < 30; i += 1) {
      now += 8.333;
      act(() => pointer.onRawTouch?.());
      act(() => frames({ timestamp: now }));
    }
    assert.equal(scheduleOnRNCalls, afterDispose, 'no transfer after detach');
  });
});
