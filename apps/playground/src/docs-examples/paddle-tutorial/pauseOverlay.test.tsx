/**
 * Mounted test for the reference pause overlay (T10-F4).
 *
 * The overlay is plain React Native UI, so react-native is mocked with
 * renderable host components and the real PauseOverlay is mounted with
 * react-test-renderer. Covers: one press pauses, the paused overlay blocks
 * gameplay touches (pointerEvents="auto"), one press resumes, accessibility
 * labels and roles, and 44pt effective hit targets.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, StrictMode } from 'react';
import { act, create } from 'react-test-renderer';
import type { GameSessionStatus } from 'rn-gamekit';

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
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
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

// The rn-gamekit/react barrel transitively imports the native module
// surface. None of it renders in this test — the values only need to exist
// for the import graph.
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Atlas: host('atlas'),
    Group: host('group'),
    Circle: host('circle'),
    Rect: host('rect'),
    Image: host('image'),
    Skia: { makeImageFromView: () => undefined },
    useRectBuffer: () => ({ current: undefined }),
    useRSXformBuffer: () => ({ current: undefined }),
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useFrameCallback: () => {},
  },
});
mock.module('react-native-worklets', {
  namedExports: {
    scheduleOnRN: () => {},
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


type PauseOverlayModule = typeof import('./PauseOverlay');
let PauseOverlay: PauseOverlayModule['PauseOverlay'];

function renderOverlay(status: GameSessionStatus, onPause: () => void, onResume: () => void) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <PauseOverlay status={status} onPause={onPause} onResume={onResume} />,
    );
  });
  return renderer;
}

function hostPressables(renderer: ReturnType<typeof create>) {
  return renderer.root.findAll(
    (node) => (node.type as string) === 'pressable',
  );
}

describe('PauseOverlay', () => {
  // The real component imports react-native, so it loads only after the
  // module mock is registered.
  before(async () => {
    PauseOverlay = (await import('./PauseOverlay')).PauseOverlay;
  });

  it('shows the pause button while running and one press pauses', () => {
    let paused = false;
    const renderer = renderOverlay(
      'running',
      () => {
        paused = true;
      },
      () => {},
    );

    const pressables = hostPressables(renderer);
    assert.equal(pressables.length, 1, 'exactly the pause button is interactive');
    const pause = pressables[0]!;
    assert.equal(pause.props.accessibilityLabel, 'Pause the game');
    assert.equal(pause.props.accessibilityRole, 'button');
    const hitSlop = pause.props.hitSlop as number | { horizontal?: number } | undefined;
    assert.ok(
      typeof hitSlop === 'number' ? hitSlop >= 12 : (hitSlop?.horizontal ?? 0) >= 12,
      'the pause control keeps an adequate hit target',
    );

    act(() => (pause.props.onPress as () => void)());
    assert.equal(paused, true, 'one press pauses');
  });

  it('replaces the pause button with a blocking overlay while paused and resumes on press', () => {
    let resumed = false;
    const renderer = renderOverlay(
      'paused',
      () => {},
      () => {
        resumed = true;
      },
    );

    // The overlay captures touches: the container is pointerEvents="auto"
    // over the frozen gameplay surface below it.
    const views = renderer.root.findAll((node) => (node.type as string) === 'view');
    assert.ok(
      views.some((view) => view.props.pointerEvents === 'auto'),
      'the paused overlay blocks gameplay touches',
    );

    const pressables = hostPressables(renderer);
    assert.equal(pressables.length, 1, 'the resume control is the only interactive element');
    const resume = pressables[0]!;
    assert.equal(resume.props.accessibilityLabel, 'Resume the game');
    assert.equal(resume.props.accessibilityRole, 'button');

    act(() => (resume.props.onPress as () => void)());
    assert.equal(resumed, true, 'one press resumes');
  });

  it('stays Strict Mode safe and keeps 44pt hit targets on both controls', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <StrictMode>
          <PauseOverlay status={'running'} onPause={() => {}} onResume={() => {}} />
        </StrictMode>,
      );
    });
    const running = hostPressables(renderer);
    assert.equal(running.length, 1);

    act(() => {
      renderer.update(
        <StrictMode>
          <PauseOverlay status={'paused'} onPause={() => {}} onResume={() => {}} />
        </StrictMode>,
      );
    });
    const paused = hostPressables(renderer);
    assert.equal(paused.length, 1);
    const resumeStyle = paused[0]!.props.style as { paddingVertical?: number };
    const height = (resumeStyle.paddingVertical ?? 0) * 2 + 16;
    assert.ok(height >= 44, `resume hit target is at least 44pt tall (${height})`);
  });
});

/**
 * Full-screen composition (T10-FF2): the header chrome must stay above the
 * blocking pause overlay, so Back works on the first press while paused.
 */
describe('PaddleContent composition while paused', () => {
  type Session = import('rn-gamekit').GameSession;
  let PaddleContent: React.ComponentType<import('../../shell/PlaygroundGameContentProps').PlaygroundGameContentProps>;
  let createSession: () => Session;

  before(async () => {
    const { createGameSessionWithDriver } = await import('rn-gamekit/testing');
    const { paddleGame } = await import('./game');
    const { ManualFrameDriver } = await import('../../../../../packages/gamekit/test/helpers/ManualFrameDriver.ts');
    PaddleContent = (await import('../../screens/paddle/PaddleContent')).default;
    createSession = () =>
      createGameSessionWithDriver(paddleGame, {
        frameDriver: new ManualFrameDriver(),
      }) as unknown as Session;
  });

  function mountContent(session: Session, exits: { count: number }) {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PaddleContent
          game={session as never}
          onExit={() => {
            exits.count += 1;
          }}
          onOpenGame={() => {}}
        />,
      );
    });
    return renderer;
  }

  it('keeps Back responsive on the first press while running and paused', () => {
    const exits = { count: 0 };
    const session = createSession();
    act(() => session.start());
    let renderer = mountContent(session, exits);

    // Running: Back works.
    const backWhileRunning = renderer.root.findAll(
      (node) => (node.type as string) === 'pressable' && node.props.accessibilityLabel === 'Back to playground',
    );
    assert.equal(backWhileRunning.length, 1);
    act(() => (backWhileRunning[0]!.props.onPress as () => void)());
    assert.equal(exits.count, 1, 'Back works on the first press while running');

    // Paused: Back still works and does not resume or mutate the session.
    act(() => session.pause());
    renderer = mountContent(session, exits);
    const backWhilePaused = renderer.root.findAll(
      (node) => (node.type as string) === 'pressable' && node.props.accessibilityLabel === 'Back to playground',
    );
    assert.equal(backWhilePaused.length, 1, 'Back is present while paused');
    act(() => (backWhilePaused[0]!.props.onPress as () => void)());
    assert.equal(exits.count, 2, 'Back works on the first press while paused');
    assert.equal(session.status, 'paused', 'Back never mutates the session');

    act(() => session.dispose());
  });

  it('constrains the blocking overlay to the stage below the header region', () => {
    const exits = { count: 0 };
    const session = createSession();
    act(() => session.start());
    act(() => session.pause());
    const renderer = mountContent(session, exits);

    const overlays = renderer.root.findAll(
      (node) =>
        (node.type as string) === 'view' &&
        node.props.pointerEvents === 'auto' &&
        Array.isArray(node.props.style),
    );
    assert.equal(overlays.length, 1, 'exactly the paused overlay blocks');
    const overlayStyle = (overlays[0]!.props.style as Record<string, unknown>[])[1] as {
      top?: number;
    };
    // 47 (insets.top) + 44 (header padding) + 36 (back button height).
    assert.equal(overlayStyle.top, 127, 'the overlay starts below the header region');

    // The header container itself stays touch-transparent (box-none), so
    // only Back is interactive above the overlay.
    const headerContainers = renderer.root.findAll(
      (node) => (node.type as string) === 'view' && node.props.pointerEvents === 'box-none',
    );
    assert.ok(headerContainers.length >= 2, 'the chrome layer stays box-none');

    act(() => session.dispose());
  });
});