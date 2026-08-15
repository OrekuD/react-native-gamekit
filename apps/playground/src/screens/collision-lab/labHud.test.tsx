/**
 * HUD publication contract (T11-FF3, T11-FF4).
 *
 * Mounts the real LabHud against a real session: 60 unchanged commits
 * publish nothing, each semantic transition publishes exactly once, the
 * sweep-time and contact-point values are visible when a hit exists, and
 * session replacement detaches the old listener exactly once.
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

// The rn-gamekit/react barrel surface for the content's type imports.
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
mock.module('../../../assets/kenney/platformer-player.png', {
  defaultExport: 42,
  namedExports: {},
});

let LabHud: React.ComponentType<{ readonly game: GameSession; readonly onPublish?: () => void }>;
let createHarness: () => { session: GameSession; driver: { fireNext(t: number): void } };

before(async () => {
  const { createGameSessionWithDriver } = await import('rn-gamekit/testing');
  const { collisionLabDefinition } = await import('./collisionLabGame.ts');
  const { ManualFrameDriver } = await import('../../../../../packages/gamekit/test/helpers/ManualFrameDriver.ts');
  LabHud = (await import('./CollisionLabContent')).LabHud;
  createHarness = () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(collisionLabDefinition, {
      frameDriver: driver,
    }) as unknown as GameSession;
    return { session, driver: driver as never };
  };
});

describe('Collision Lab HUD publication contract', () => {
  it('publishes nothing across 60 unchanged commits (FF3)', () => {
    const { session, driver } = createHarness();
    let publishes = 0;
    act(() => session.start());
    let timeline = 0;
    act(() => {
      driver.fireNext(0);
    });
    act(() => {
      create(<LabHud game={session} onPublish={() => { publishes += 1; }} />);
    });
    const initial = publishes;
    assert.equal(initial, 1, 'the initial snapshot publishes once');

    for (let index = 1; index <= 60; index += 1) {
      timeline += 1000 / 60;
      act(() => {
        driver.fireNext(timeline);
      });
    }
    assert.equal(publishes, 1, 'no setState, updater, or render for unchanged commits');

    act(() => session.dispose());
  });

  it('publishes exactly once per semantic transition for all five actions (SF4)', () => {
    const { session, driver } = createHarness();
    let publishes = 0;
    act(() => session.start());
    let timeline = 0;
    act(() => {
      driver.fireNext(0);
      create(<LabHud game={session} onPublish={() => { publishes += 1; }} />);
    });
    const initial = publishes;

    const actions = ['cycle-pair', 'toggle-sweep', 'toggle-filter', 'cycle-anim', 'toggle-debug'] as const;
    for (const action of actions) {
      session.input.press(action);
      session.input.release(action);
      timeline += 1000 / 60;
      act(() => {
        driver.fireNext(timeline);
      });
      publishes; // read for the assertion below
    }
    assert.equal(
      publishes,
      initial + actions.length,
      'each of the five actions publishes exactly once',
    );

    // Unchanged steady-state commits publish nothing afterwards.
    for (let index = 0; index < 30; index += 1) {
      timeline += 1000 / 60;
      act(() => {
        driver.fireNext(timeline);
      });
    }
    assert.equal(publishes, initial + actions.length, 'steady-state commits publish nothing');

    act(() => session.dispose());
  });

  it('detaches the old commit listener on replacement (FF3)', () => {
    const first = createHarness();
    const second = createHarness();
    let publishes = 0;
    act(() => first.session.start());
    let timeline = 0;
    act(() => {
      first.driver.fireNext(0);
    });
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<LabHud game={first.session} onPublish={() => { publishes += 1; }} />);
    });
    assert.equal(publishes, 1);

    // Replace the session: the old listener must detach and the new one
    // publishes the replacement snapshot once.
    act(() => second.session.start());
    act(() => {
      renderer.update(<LabHud game={second.session} onPublish={() => { publishes += 1; }} />);
    });
    assert.equal(publishes, 2, 'the replacement snapshot publishes once');

    // Firing the OLD session must not publish anything more.
    timeline += 1000 / 60;
    act(() => {
      first.driver.fireNext(timeline);
    });
    assert.equal(publishes, 2, 'the old listener is detached');

    act(() => first.session.dispose());
    act(() => second.session.dispose());
  });

  it('shows the contact point and sweep time when a hit exists (FF4)', () => {
    const { session, driver } = createHarness();
    act(() => session.start());
    let timeline = 0;
    act(() => {
      driver.fireNext(0);
    });
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<LabHud game={session} onPublish={() => {}} />);
    });

    // Enable the sweep and run until the projectile crosses the target.
    session.input.press('toggle-sweep');
    session.input.release('toggle-sweep');
    let texts: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      timeline += 1000 / 60;
      act(() => {
        driver.fireNext(timeline);
      });
      texts = renderer.root
        .findAll((node) => (node.type as string) === 'text')
        .map((node) => node.children.map((child) => String(child)).join(''));
      if (texts.some((text) => text.includes('sweep contact yes'))) {
        break;
      }
    }
    const sweepLine = texts.find((text) => text.includes('sweep contact yes'));
    assert.ok(sweepLine !== undefined, 'the sweep time is visible when a hit exists');
    const contactLine = texts.find((text) => text.includes('point ('));
    assert.ok(contactLine !== undefined, 'the contact point is visible');

    act(() => session.dispose());
  });
});
