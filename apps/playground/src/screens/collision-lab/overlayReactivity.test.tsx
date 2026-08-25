/**
 * Overlay reactivity contract (T11-SF4).
 *
 * Mounts the real fixed overlay topology with CONTROLLABLE shared values
 * and a getter-based derived mock: mutating the snapshot or viewport
 * inputs recomputes the derived Skia props without any React rerender or
 * node remount.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, StrictMode } from 'react';
import { act, create } from 'react-test-renderer';

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

// Getter-based derived mock: `value` recomputes on read, so mutating the
// source shared values is observable through the derived props without any
// React render.
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => unknown) => ({ get value() { return fn(); } }),
    useFrameCallback: () => {},
  },
});

mock.module('@shopify/react-native-skia', {
  namedExports: {
    Circle: host('circle'),
    Rect: host('rect'),
    Path: host('path'),
    Skia: { makeImageFromView: () => undefined },
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

type Controllable = { value: unknown };

let ColliderOverlay: React.ComponentType<{
  readonly index: number;
  readonly kind: 'aabb' | 'circle';
  readonly world: Controllable;
  readonly snap: Controllable;
}>;
let COLLIDER_TOPOLOGY: readonly { label: string; kind: 'aabb' | 'circle' }[];

before(async () => {
  const rendererModule = await import('./CollisionLabRenderer');
  // The overlay's props are Reanimated SharedValues at runtime; the test
  // drives them with plain controllable objects through the getter mock.
  ColliderOverlay = rendererModule.ColliderOverlay as unknown as React.ComponentType<{
    readonly index: number;
    readonly kind: 'aabb' | 'circle';
    readonly world: Controllable;
    readonly snap: Controllable;
  }>;
  COLLIDER_TOPOLOGY = rendererModule.COLLIDER_TOPOLOGY;
});

interface SnapshotShape {
  debugVisible: boolean;
  colliderDebug: {
    kind: string;
    x: number;
    y: number;
    width: number;
    height: number;
    radius?: number;
    label?: string;
  }[];
  swept: boolean;
  projectileTeleported: boolean;
  sprite: { x: number; y: number };
}

function makeInputs() {
  const snap: Controllable = {
    value: {
      debugVisible: true,
      swept: false,
      projectileTeleported: false,
      sprite: { x: 160, y: 400 },
      colliderDebug: [
        { kind: 'aabb', x: 145, y: 354, width: 30, height: 46, label: 'body' },
        { kind: 'circle', x: 160, y: 366, width: 14, height: 14, radius: 14, label: 'hurtbox' },
      ],
    } as SnapshotShape,
  };
  const world: Controllable = { value: { scale: 4, offsetX: 0, offsetY: 0 } };
  return { snap, world };
}

describe('Collision Lab overlay reactivity (T11-SF4)', () => {
  it('updates reactive Skia props on visibility, position, and viewport changes without remounting', () => {
    const { snap, world } = makeInputs();
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <StrictMode>
          <ColliderOverlay index={0} kind="aabb" world={world} snap={snap} />
        </StrictMode>,
      );
    });

    const rect = () =>
      renderer.root.findAll((node) => (node.type as string) === 'rect')[0]!;
    const before = rect();
    // Visible at the authored position, scaled by the viewport.
    assert.equal(before.props.x.value, 145 * 4);
    assert.equal(before.props.y.value, 354 * 4);
    assert.equal(before.props.width.value, 30 * 4);
    assert.equal(before.props.height.value, 46 * 4);

    // Hide via debug visibility: the same node reports zero size.
    (snap.value as SnapshotShape).debugVisible = false;
    const hidden = rect();
    assert.equal(hidden, before, 'the node is not remounted');
    assert.equal(hidden.props.width.value, 0);
    assert.equal(hidden.props.height.value, 0);

    // Show again and move the sprite: the same node reports the new
    // position without any React rerender.
    (snap.value as SnapshotShape).debugVisible = true;
    const debug = (snap.value as SnapshotShape).colliderDebug[0] as { x: number; y: number };
    debug.x = 200;
    debug.y = 300;
    const moved = rect();
    assert.equal(moved, before, 'still the same node');
    assert.equal(moved.props.x.value, 200 * 4);
    assert.equal(moved.props.y.value, 300 * 4);

    // Change the viewport scale: the same node reports the new transform.
    world.value = { scale: 2, offsetX: 10, offsetY: 20 };
    const resized = rect();
    assert.equal(resized, before, 'still the same node');
    assert.equal(resized.props.x.value, 200 * 2 + 10);
    assert.equal(resized.props.y.value, 300 * 2 + 20);
  });

  it('keeps the fixed topology of four stable nodes with stable keys', () => {
    assert.deepEqual(
      COLLIDER_TOPOLOGY.map((spec) => spec.label),
      ['body', 'hurtbox', 'attack', 'pickup'],
    );
    assert.deepEqual(
      COLLIDER_TOPOLOGY.map((spec) => spec.kind),
      ['aabb', 'circle', 'aabb', 'circle'],
    );
  });
});
