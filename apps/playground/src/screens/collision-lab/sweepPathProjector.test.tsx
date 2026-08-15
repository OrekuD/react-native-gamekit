/**
 * T11-TF3: the mounted renderer's sweep path comes from the pure exported
 * projector, driven with controllable snapshots: the teleport frame yields
 * an empty path, ordinary adjacent frames yield short forward paths.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';

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

let projectSweepPath: (
  world: { readonly scale: number; readonly offsetX: number; readonly offsetY: number } | undefined,
  snap: SnapShape | undefined,
) => string;

before(async () => {
  projectSweepPath = (await import('./CollisionLabRenderer')).projectSweepPath as unknown as typeof projectSweepPath;
});

const WORLD = { scale: 4, offsetX: 0, offsetY: 0 };

interface SnapShape {
  readonly swept: boolean;
  readonly projectileTeleported: boolean;
  readonly projectileStart: { x: number; y: number };
  readonly projectile: { x: number; y: number };
  readonly scene?: string;
  readonly current?: unknown;
}

describe('sweep path projector (T11-TF3)', () => {
  it('publishes an empty path on the teleport frame', () => {
    const teleportFrame = {
      swept: true,
      projectileTeleported: true,
      projectileStart: { x: 381.33, y: 60 },
      projectile: { x: 24, y: 60 },
    } as SnapShape;
    assert.equal(projectSweepPath(WORLD, teleportFrame), '', 'no path across the wrap');
  });

  it('publishes no path while the sweep is off or the viewport is unknown', () => {
    assert.equal(
      projectSweepPath(WORLD, {
        swept: false,
        projectileTeleported: false,
        projectileStart: { x: 24, y: 60 },
        projectile: { x: 26.67, y: 60 },
      } as SnapShape),
      '',
      'no path while the sweep is off',
    );
    assert.equal(projectSweepPath(undefined, undefined), '', 'no path without a viewport');
  });

  it('publishes short forward paths for ordinary adjacent frames', () => {
    // Exactly representable step values so the rendered numbers are exact.
    const first = {
      swept: true,
      projectileTeleported: false,
      projectileStart: { x: 200, y: 60 },
      projectile: { x: 202, y: 60 },
    } as SnapShape;
    const second = {
      swept: true,
      projectileTeleported: false,
      projectileStart: { x: 202, y: 60 },
      projectile: { x: 204, y: 60 },
    } as SnapShape;
    const firstPath = projectSweepPath(WORLD, first);
    const secondPath = projectSweepPath(WORLD, second);
    assert.equal(firstPath, 'M 800 240 L 808 240');
    assert.equal(secondPath, 'M 808 240 L 816 240');
    // Adjacency: the next step's start is exactly the previous step's end.
    assert.ok(firstPath.length < 40, 'the path is short');
    const endOf = (path: string): string => path.slice(path.indexOf(' L ') + 3);
    const startOf = (path: string): string => path.slice(2, path.indexOf(' L '));
    assert.equal(startOf(secondPath), endOf(firstPath), 'adjacent steps chain end-to-start');
  });
});
