/**
 * T12-F7: Sprite Field diagnostics traffic.
 *
 * Mounts the real content against a real scrolling session: zero diagnostic
 * publications while the toggle is off, a bounded cadence while on, and
 * unchanged score/animation commits that never invoke the HUD setter.
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
    SafeAreaView: host('safe-area-view'),
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Group: host('group'),
    Circle: host('circle'),
    Rect: host('rect'),
    Path: host('path'),
    Skia: { makeImageFromView: () => undefined },
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
mock.module('../../../assets/kenney/platformer-player.png', {
  defaultExport: 42,
  namedExports: {},
});
mock.module('../../../assets/kenney/tiny-farm.png', {
  defaultExport: 42,
  namedExports: {},
});

// The game manifest references static module handles via require(...);
// seed the stub BEFORE the dynamic imports.
(globalThis as { require?: (id: string) => number }).require = () => 42;

let SpriteFieldContent: React.ComponentType<{
  readonly game: GameSession;
  readonly onExit: () => void;
  readonly onOpenGame: (gameId: string) => void;
  readonly assetState: { status: 'ready'; assets: unknown; requestKey: string };
  readonly onHudPublish?: () => void;
  readonly onDiagnosticsPublish?: () => void;
}>;
let ManualFrameDriver: new () => { fireNext(t: number): void };
let createGameSessionWithDriver: (definition: unknown, options: unknown) => GameSession;
let spriteFieldDefinition: unknown;

before(async () => {
  try {
    const { spriteFieldDefinition: definition } = await import('./spriteFieldGame.ts');
    spriteFieldDefinition = definition;
    const content = await import('./SpriteFieldContent.tsx');
    const testing = await import('rn-gamekit/testing');
    SpriteFieldContent = content.default as unknown as typeof SpriteFieldContent;
    ManualFrameDriver = testing.ManualFrameDriver;
    createGameSessionWithDriver = testing.createGameSessionWithDriver as unknown as typeof createGameSessionWithDriver;
  } catch (error) {
    console.log('IMPORT-CHAIN-FAIL', (error as Error).stack?.split('\n').slice(0, 8).join(' | '));
    throw error;
  }
});

function harness() {
  const driver = new ManualFrameDriver();
  const session = createGameSessionWithDriver(spriteFieldDefinition, {
    frameDriver: driver,
  }) as GameSession;
  return { session, driver };
}

describe('Sprite Field diagnostics traffic (T12-F7)', () => {
  it('publishes zero diagnostics while off, a bounded cadence while on, and no HUD setter for unchanged commits', () => {
    let hudPublishes = 0;
    let diagPublishes = 0;
    const { session, driver } = harness();
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
        <SpriteFieldContent
          game={session}
          onExit={() => undefined}
          onOpenGame={() => undefined}
          assetState={{ status: 'ready', assets: undefined as never, requestKey: 'k' }}
          onHudPublish={() => { hudPublishes += 1; }}
          onDiagnosticsPublish={() => { diagPublishes += 1; }}
        />,
      );
    });

    // 120 commits with a moving camera (follow drag) while diagnostics are
    // OFF: the diagnostics setter never runs; the HUD publishes for score.
    session.input.begin('primary', 1, { x: 1200, y: 300 });
    tick(120);
    assert.equal(diagPublishes, 0, 'no diagnostic traffic while off');
    assert.ok(hudPublishes > 0, 'the HUD still updates for score changes');

    // Toggle diagnostics ON: bounded by the 8 Hz cadence.
    const diagButton = renderer.root.findByProps({ accessibilityLabel: 'Toggle camera diagnostics' });
    act(() => {
      diagButton.props.onPress();
    });
    tick(1);
    const diagBaseline = diagPublishes;
    tick(120);
    const during = diagPublishes - diagBaseline;
    assert.ok(during > 0, 'diagnostics publish while on');
    assert.ok(during <= 25, `bounded by the cadence (got ${during} in ~2s)`);

    // Release: score stops, animation is idle. 120 more commits must never
    // invoke the HUD setter (the record is unchanged).
    session.input.cancel('primary');
    tick(60); // Let the follow camera settle.
    const hudBaseline = hudPublishes;
    tick(120);
    assert.equal(hudPublishes, hudBaseline, 'unchanged score/animation commits never invoke the HUD setter');

    act(() => session.dispose());
  });
});
