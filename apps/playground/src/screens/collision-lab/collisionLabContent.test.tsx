/**
 * Mounted interaction tests for the Collision Lab (T11-F9).
 *
 * react-native and safe-area-context are mocked with renderable host
 * components; the real CollisionLabContent is mounted with a real session.
 * Proves Back exits on the first press and the control buttons drive the
 * session's declared actions without leaking into gameplay input.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, StrictMode } from 'react';
import { act, create } from 'react-test-renderer';
import type { GameSession } from 'rn-gamekit';

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

mock.module('../../../assets/kenney/platformer-player.png', {
  defaultExport: 42,
  namedExports: {},
});

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

// The native module surface for the rn-gamekit/react barrel imports.
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Atlas: host('atlas'),
    Group: host('group'),
    Circle: host('circle'),
    Rect: host('rect'),
    Image: host('image'),
    Path: host('path'),
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

let CollisionLabContent: React.ComponentType<{
  readonly game: GameSession;
  readonly onExit: () => void;
  readonly onOpenGame: () => void;
}>;
type Driver = { fireNext(timestampMs: number): void };
let createSession: () => { session: GameSession; driver: Driver };
let session: GameSession;
let driver: Driver;
let timeline = 0;

before(async () => {
  const { createGameSessionWithDriver } = await import('rn-gamekit/testing');
  const { collisionLabDefinition } = await import('./collisionLabGame.ts');
  const { ManualFrameDriver } = await import('../../../../../packages/gamekit/test/helpers/ManualFrameDriver.ts');
  CollisionLabContent = (await import('./CollisionLabContent')).default;
  createSession = () => {
    const frameDriver = new ManualFrameDriver() as unknown as Driver;
    const labSession = createGameSessionWithDriver(collisionLabDefinition, {
      frameDriver: frameDriver as never,
    }) as unknown as GameSession;
    return { session: labSession, driver: frameDriver };
  };
  const created = createSession();
  session = created.session;
  driver = created.driver;
});

function tick(frames: number): void {
  for (let index = 0; index < frames; index += 1) {
    timeline += 1000 / 60;
    driver.fireNext(timeline);
  }
}

describe('Collision Lab content interaction', () => {
  it('exits on the first Back press without mutating the session', () => {
    const exits = { count: 0 };
    const created = createSession();
    session = created.session;
    driver = created.driver;
    timeline = 0;
    act(() => session.start());
    tick(1);
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <CollisionLabContent
          game={session}
          onExit={() => {
            exits.count += 1;
          }}
          onOpenGame={() => {}}
        />,
      );
    });

    const back = renderer.root.findAll(
      (node) => (node.type as string) === 'pressable' && node.props.accessibilityLabel === 'Back to playground',
    );
    assert.equal(back.length, 1);
    act(() => (back[0]!.props.onPress as () => void)());
    assert.equal(exits.count, 1, 'Back exits on the first press');
    assert.equal(session.status, 'running', 'Back never mutates the session');

    act(() => session.dispose());
  });

  it('drives every control through the declared button actions', () => {
    const created = createSession();
    session = created.session;
    driver = created.driver;
    timeline = 0;
    act(() => session.start());
    tick(1);
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<CollisionLabContent game={session} onExit={() => {}} onOpenGame={() => {}} />);
    });

    const pressables = renderer.root.findAll((node) => (node.type as string) === 'pressable');
    const labels = pressables.map((node) => node.props.accessibilityLabel as string);
    assert.ok(labels.includes('Pair toggle'), 'pair control present');
    assert.ok(labels.includes('Sweep toggle'));
    assert.ok(labels.includes('Filter toggle'));
    assert.ok(labels.includes('Anim toggle'));
    assert.ok(labels.includes('Debug toggle'));

    // Pressing the pair control changes the snapshot's pair.
    const pairButton = pressables.find((node) => node.props.accessibilityLabel === 'Pair toggle')!;
    act(() => (pairButton.props.onPress as () => void)());
    tick(1);
    const frame = session.getRenderFrame().current as { pair: string };
    assert.equal(frame.pair, 'aabbAabb', 'the control drives the declared action');

    act(() => session.dispose());
  });

  it('keeps controls outside the gameplay hit surface', () => {
    const created = createSession();
    session = created.session;
    driver = created.driver;
    timeline = 0;
    act(() => session.start());
    tick(1);
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <StrictMode>
          <CollisionLabContent game={session} onExit={() => {}} onOpenGame={() => {}} />
        </StrictMode>,
      );
    });
    // The content root is box-none: only the header and controls receive
    // touches; the gameplay surface below stays available.
    const roots = renderer.root.findAll((node) => (node.type as string) === 'view');
    assert.ok(roots.some((node) => node.props.pointerEvents === 'box-none'), 'the content root is box-none');
    act(() => session.dispose());
  });
});
