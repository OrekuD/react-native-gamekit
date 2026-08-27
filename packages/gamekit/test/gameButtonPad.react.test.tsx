/**
 * GameButtonPad surface contract (T20).
 *
 * The pad is an invisible full-surface overlay: it never blocks touches on
 * empty areas (box-none), renders arbitrary children alongside the button
 * zones, and turns touch events into session press/release diffs through the
 * headless controller.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { mock } from 'node:test';

const host = (_type: string) =>
  function HostComponent(_props: Record<string, unknown>) {
    return null;
  };

let gestureConfig:
  | {
      onTouchesDown?: (event: unknown) => void;
      onTouchesUp?: (event: unknown) => void;
    }
  | undefined;

mock.module('react-native', {
  namedExports: {
    // The View mock must RENDER ITS CHILDREN so nested GameButtons mount.
    View: function View(props: { readonly children?: unknown }) {
      return (props as { children?: unknown }).children ?? null;
    },
    StyleSheet: { create: (s: Record<string, unknown>) => s, absoluteFill: {} },
  },
});
mock.module('react-native-gesture-handler', {
  namedExports: {
    // The detector must RENDER ITS CHILDREN so the pad's View mounts.
    GestureDetector: function GestureDetector(props: { readonly children?: unknown }) {
      const { host } = hostModule;
      void host;
      return (props as { children?: unknown }).children ?? null;
    },
    useManualGesture: (config: object) => {
      gestureConfig = config;
      return {};
    },
  },
});
const hostModule = { host: host('unused') };

const pressed: string[] = [];
const released: string[] = [];
const fakeSession = {
  input: {
    press: (action: string) => pressed.push(action),
    release: (action: string) => released.push(action),
  },
};

describe('GameButtonPad surface contract', () => {
  it('renders a box-none overlay, registers measured zones, and applies diffs', async () => {
    const { GameButtonPad, GameButton } = await import('../src/react/GameButtonPad.tsx');
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        createElement(
          GameButtonPad as never,
          { game: fakeSession, hitSlop: 12, testID: 'pad' },
          createElement('View', { testID: 'art', pointerEvents: 'none' }),
          createElement(GameButton as never, {
            action: 'jump',
            testID: 'jump-zone',
          }),
        ),
      );
    });
    const node = renderer!.root;
    const surface = node.find(
      (n: { props?: { pointerEvents?: string } }) => n.props?.pointerEvents === 'box-none',
    );
    assert.ok(surface, 'the pad container is box-none: empty areas pass touches through');

    // GameButton renders a mocked View whose element carries onLayout; find
    // the deepest node with the zone's testID and fire a synthetic layout.
    let layoutHandler: ((event: unknown) => void) | undefined;
    const walk = (node: {
      props?: { testID?: string; onLayout?: (event: unknown) => void };
      children?: readonly unknown[];
    }): void => {
      if (node.props?.testID === 'jump-zone' && node.props.onLayout) {
        layoutHandler = node.props.onLayout;
        return;
      }
      for (const child of node.children ?? []) walk(child as typeof node);
    };
    walk(node);
    assert.ok(layoutHandler, 'the zone view exposes an onLayout handler');
    // Simulate the platform measuring the button's bounds.
    await act(async () => {
      layoutHandler!({ nativeEvent: { layout: { x: 0, y: 0, width: 80, height: 60 } } });
    });

    // A finger inside the registered zone presses 'jump'.
    const down = gestureConfig?.onTouchesDown as (e: unknown) => void;
    await act(async () => {
      down({ allTouches: [{ id: 1, x: 40, y: 30 }] });
    });
    assert.deepEqual(pressed, ['jump'], 'touching the zone presses the declared action');

    await act(async () => {
      (gestureConfig?.onTouchesUp as (e: unknown) => void)({
        changedTouches: [{ id: 1, x: 40, y: 30 }],
      });
    });
    assert.deepEqual(released, ['jump'], 'lifting releases');

    const art = node.find((n: { props?: { testID?: string } }) => n.props?.testID === 'art');
    assert.ok(art, 'arbitrary non-button children render under the same surface');
    renderer!.unmount();
  });

  it('throws when a GameButton mounts outside a GameButtonPad', async () => {
    const { GameButton } = await import('../src/react/GameButtonPad.tsx');
    let threw = false;
    try {
      await act(async () => {
        create(createElement(GameButton as never, { action: 'jump' }));
      });
    } catch (error) {
      threw = error instanceof Error && error.message.includes('GameButtonPad');
    }
    assert.equal(threw, true, 'a stray GameButton is a developer error');
  });
});
