/**
 * GS-INPUT-03 (button zone lifecycle) + GS-INPUT-04 (pad invalidation).
 *
 * Mounted GameButtonPad contract: zones measure into pad coordinates,
 * unmount/rename/re-layout release old zones, disposed sessions never
 * throw, duplicate actions are rejected, and stale scheduled callbacks die
 * at RN ingress after pause/session replacement (generation stamps).
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

// Refs captured per testID so tests can attach fake native nodes.
let capturedRefs: { testID: string | undefined; ref: { current: unknown } | null }[] = [];
// Deferred RN callbacks: tests pause/replace, then flush.
const scheduled: Array<() => void> = [];
let gestureConfig: Record<string, (event: unknown) => void> = {};

mock.module('react-native', {
  namedExports: {
    View: function View(props: HostProps & { ref?: { current: unknown } | null; testID?: string }) {
      capturedRefs.push({ testID: props.testID, ref: props.ref ?? null });
      return (props as HostProps).children ?? null;
    },
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: {},
    },
    findNodeHandle: () => 42,
  },
});
mock.module('react-native-gesture-handler', {
  namedExports: {
    GestureDetector: function GestureDetector(props: HostProps) {
      return (props as HostProps).children ?? null;
    },
    useManualGesture: (config: Record<string, (event: unknown) => void>) => {
      gestureConfig = config;
      return {};
    },
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    }),
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
type PadModule = typeof import('../src/react/GameButtonPad');
let GameButtonPad: PadModule['GameButtonPad'];
let GameButton: PadModule['GameButton'];

interface FakePadSession {
  status: string;
  input: { press: (action: string) => void; release: (action: string) => void };
  pressed: string[];
  released: string[];
  setStatus: (status: string) => void;
}

function fakePadSession(): FakePadSession {
  const pressed: string[] = [];
  const released: string[] = [];
  const listeners = new Set<(status: string) => void>();
  const session = {
    status: 'running',
    input: {
      press: (action: string) => {
        if (session.status === 'disposed') {
          throw new Error('input used after dispose');
        }
        pressed.push(action);
      },
      release: (action: string) => {
        if (session.status === 'disposed') {
          throw new Error('input used after dispose');
        }
        released.push(action);
      },
    },
    pressed,
    released,
    addStatusListener: (listener: (status: string) => void) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
    setStatus: (status: string) => {
      session.status = status;
      for (const listener of [...listeners]) {
        listener(status);
      }
    },
  };
  return session;
}

function fakeNode(x: number, y: number, width: number, height: number) {
  const rect = { x, y, width, height };
  return {
    rect,
    measureLayout: (
      _relativeTo: unknown,
      onSuccess: (x: number, y: number, width: number, height: number) => void,
      _onFail: () => void,
    ) => onSuccess(rect.x, rect.y, rect.width, rect.height),
  };
}

function buttonRef(testID: string): { current: unknown } {
  const entry = capturedRefs.find((candidate) => candidate.testID === testID);
  assert.ok(entry?.ref, `ref captured for ${testID}`);
  return entry.ref as { current: unknown };
}

/** Attach a fake native node to the pad container so measureLayout runs. */
function attachPadNode(): void {
  const entry = capturedRefs.find((candidate) => candidate.testID === 'pad');
  assert.ok(entry?.ref, 'pad ref captured');
  (entry.ref as { current: unknown }).current = {};
}

function fireLayout(
  renderer: ReactTestRenderer,
  testID: string,
  layout: { x: number; y: number; width: number; height: number },
): void {
  const node = renderer.root.find(
    (candidate: { props?: { testID?: string; onLayout?: unknown } }) =>
      candidate.props?.testID === testID && candidate.props?.onLayout !== undefined,
  );
  const handler = (node.props as { onLayout?: (event: unknown) => void }).onLayout;
  assert.ok(handler, `onLayout exposed for ${testID}`);
  handler({ nativeEvent: { layout } });
}

async function flushScheduled(): Promise<void> {
  await act(async () => {
    const pending = scheduled.splice(0);
    for (const fn of pending) {
      fn();
    }
  });
}

function downAt(touches: { id: number; x: number; y: number }[]): void {
  gestureConfig.onTouchesDown?.({ allTouches: touches });
}

function moveAt(touches: { id: number; x: number; y: number }[]): void {
  gestureConfig.onTouchesMove?.({ allTouches: touches });
}

function upAt(touches: { id: number; x: number; y: number }[]): void {
  gestureConfig.onTouchesUp?.({ changedTouches: touches });
}

describe('GS-INPUT-03 button zone lifecycle', () => {
  it('loads modules after mocks', async () => {
    const pad = await import('../src/react/GameButtonPad.tsx');
    GameButtonPad = pad.GameButtonPad;
    GameButton = pad.GameButton;
  });

  it('a nested button registers pad-space coordinates, not parent-relative ones', async () => {
    capturedRefs = [];
    const session = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(
            host('offset-row'),
            { style: { left: 100, top: 100 } },
            createElement(GameButton as never, { action: 'jump', testID: 'jump' }),
          ),
        ),
      );
    });
    // The platform measures the button at pad-space (110, 120); the layout
    // event alone only knows parent-relative (10, 20).
    attachPadNode();
    buttonRef('jump').current = fakeNode(110, 120, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'jump', { x: 10, y: 20, width: 80, height: 60 });
    });

    downAt([{ id: 1, x: 150, y: 150 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump'], 'pad-space hit presses');

    session.pressed.length = 0;
    session.released.length = 0;
    downAt([{ id: 2, x: 50, y: 50 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, [], 'parent-relative coords do not press');
    upAt([
      { id: 1, x: 150, y: 150 },
      { id: 2, x: 50, y: 50 },
    ]);
    await flushScheduled();
    renderer!.unmount();
  });

  it('unmount while held releases and removes the zone', async () => {
    capturedRefs = [];
    const session = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'jump' }),
        ),
      );
    });
    attachPadNode();
    buttonRef('jump').current = fakeNode(0, 0, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'jump', { x: 0, y: 0, width: 80, height: 60 });
    });
    downAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump']);

    await act(async () => {
      renderer!.unmount();
    });
    assert.deepEqual(session.released, ['jump'], 'unmount releases the held action');
  });

  it('renaming an action releases the old zone and registers the new one', async () => {
    capturedRefs = [];
    const session = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'btn' }),
        ),
      );
    });
    attachPadNode();
    buttonRef('btn').current = fakeNode(0, 0, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'btn', { x: 0, y: 0, width: 80, height: 60 });
    });
    downAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump']);

    await act(async () => {
      renderer!.update(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(GameButton as never, { action: 'kick', testID: 'btn' }),
        ),
      );
    });
    assert.deepEqual(session.released, ['jump'], 'the renamed-away zone releases');
    attachPadNode();
    buttonRef('btn').current = fakeNode(200, 0, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'btn', { x: 200, y: 0, width: 80, height: 60 });
    });
    session.pressed.length = 0;
    downAt([{ id: 2, x: 240, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['kick'], 'the new action registers');
    renderer!.unmount();
  });

  it('re-layout while held moves the zone without leaking the old rect', async () => {
    capturedRefs = [];
    const session = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'jump' }),
        ),
      );
    });
    const node = fakeNode(0, 0, 80, 60);
    buttonRef('jump').current = node;
    await act(async () => {
      fireLayout(renderer!, 'jump', { x: 0, y: 0, width: 80, height: 60 });
    });
    downAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump']);
    upAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();

    // The button moves; the new measurement wins over the old rect. The
    // native node identity is stable — only its measured rect changes.
    attachPadNode();
    const movedNode = buttonRef('jump').current as unknown as {
      rect: { x: number; y: number; width: number; height: number };
    };
    movedNode.rect.x = 200;
    await act(async () => {
      fireLayout(renderer!, 'jump', { x: 200, y: 0, width: 80, height: 60 });
    });
    session.pressed.length = 0;
    downAt([{ id: 2, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, [], 'the old rect no longer hits');
    downAt([{ id: 3, x: 240, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump'], 'the new rect hits');
    renderer!.unmount();
  });

  it('unmounting with a disposed session never throws', async () => {
    capturedRefs = [];
    const session = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'jump' }),
        ),
      );
    });
    attachPadNode();
    buttonRef('jump').current = fakeNode(0, 0, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'jump', { x: 0, y: 0, width: 80, height: 60 });
    });
    downAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();
    session.setStatus('disposed');
    await act(async () => {
      renderer!.unmount();
    });
    assert.deepEqual(session.released, [], 'no input calls after dispose');
  });

  it('duplicate mounted actions are rejected', async () => {
    capturedRefs = [];
    const session = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'left' }),
          createElement(GameButton as never, { action: 'jump', testID: 'right' }),
        ),
      );
    });
    attachPadNode();
    buttonRef('left').current = fakeNode(0, 0, 80, 60);
    attachPadNode();
    buttonRef('right').current = fakeNode(200, 0, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'left', { x: 0, y: 0, width: 80, height: 60 });
    });
    let duplicate = '';
    try {
      await act(async () => {
        fireLayout(renderer!, 'right', { x: 200, y: 0, width: 80, height: 60 });
      });
    } catch (error) {
      duplicate = String((error as Error)?.message ?? error);
    }
    assert.match(duplicate, /already registered/, 'second owner is rejected');
    renderer!.unmount();
  });
});

describe('GS-INPUT-04 pad invalidation', () => {
  it('stale scheduled callbacks die at RN ingress after pause', async () => {
    capturedRefs = [];
    const session = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'jump' }),
        ),
      );
    });
    attachPadNode();
    buttonRef('jump').current = fakeNode(0, 0, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'jump', { x: 0, y: 0, width: 80, height: 60 });
    });

    // Queue a down but do not deliver it yet.
    downAt([{ id: 1, x: 40, y: 30 }]);
    assert.equal(scheduled.length, 1, 'the down waits at RN ingress');
    session.setStatus('paused');
    await flushScheduled();
    assert.deepEqual(session.pressed, [], 'the stale down is dropped, not pressed');
    renderer!.unmount();
  });

  it('pause clears pad ownership; resume needs a fresh down', async () => {
    capturedRefs = [];
    const session = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: session, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'jump' }),
        ),
      );
    });
    attachPadNode();
    buttonRef('jump').current = fakeNode(0, 0, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'jump', { x: 0, y: 0, width: 80, height: 60 });
    });
    downAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump']);

    // The finger stays down across pause and resume: moves must not press.
    session.setStatus('paused');
    moveAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump'], 'no press while paused');
    session.setStatus('running');
    moveAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump'], 'no duplicate press without a fresh down');
    upAt([{ id: 1, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.released, [], 'lingering pointer cannot release');

    downAt([{ id: 2, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.pressed, ['jump', 'jump'], 'a fresh down presses again');
    upAt([{ id: 2, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(session.released, ['jump'], 'the fresh cycle releases normally');
    renderer!.unmount();
  });

  it('replacing the session invalidates queued callbacks for the old input', async () => {
    capturedRefs = [];
    const first = fakePadSession();
    const second = fakePadSession();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: first, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'jump' }),
        ),
      );
    });
    attachPadNode();
    buttonRef('jump').current = fakeNode(0, 0, 80, 60);
    await act(async () => {
      fireLayout(renderer!, 'jump', { x: 0, y: 0, width: 80, height: 60 });
    });
    downAt([{ id: 1, x: 40, y: 30 }]);
    assert.equal(scheduled.length, 1);

    await act(async () => {
      renderer!.update(
        createElement(
          GameButtonPad as never,
          { game: second, testID: 'pad' },
          createElement(GameButton as never, { action: 'jump', testID: 'jump' }),
        ),
      );
    });
    await flushScheduled();
    assert.deepEqual(first.pressed, [], 'the old session never sees the stale down');
    assert.deepEqual(second.pressed, [], 'the new session never sees the stale down');

    downAt([{ id: 2, x: 40, y: 30 }]);
    await flushScheduled();
    assert.deepEqual(second.pressed, ['jump'], 'a fresh down works on the new session');
    renderer!.unmount();
  });
});
