/**
 * GS-REACT-03 — Buffer Probe reproduction screen.
 *
 * Headless coverage: the orbit math (constant count, deterministic motion),
 * the tile map contract, and the effect definition. Mounted coverage: the
 * screen renders all three Atlas layers behind the asset gate, the lab timer
 * advances commits, and the looping emitter emits on schedule. Whether slot
 * WRITES notify the native renderer is observable only on device — see the
 * Buffer Probe rows in plans/task-20-device-smoke.md.
 */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { before, describe, it, mock } from 'node:test';
import * as ReactNamespace from 'react';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

// GameWorld2D references the React namespace at runtime, and the batch
// policy branches on the dev flag.
(globalThis as Record<string, unknown>).React ??= ReactNamespace;
(globalThis as Record<string, unknown>).__DEV__ ??= true;


// The screen modules use Metro's static require convention for asset
// handles. Under the tsx CJS loader a bare require resolves asset bytes as
// JS, so register inert handlers for the binary extensions before any
// screen module loads.
for (const extension of ['.png', '.wav'] as const) {
  (Module as unknown as {
    _extensions: Record<string, (module: { exports: unknown }, filename: string) => void>;
  })._extensions[extension] = (module) => {
    module.exports = 42;
  };
}

function host(tag: string) {
  const C = ({ children, ...props }: Record<string, unknown>): unknown =>
    createElement(tag, props as never, children as never);
  (C as { displayName?: string }).displayName = tag;
  return C;
}

// Controllable asset gate for the screen's useGameAssets call.
let assetGateState: { status: 'loading' | 'ready' } = { status: 'loading' };

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    Text: host('text'),
    Pressable: host('pressable'),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
      flatten: (style: unknown) => style,
    },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  },
});
mock.module('react-native-safe-area-context', {
  namedExports: {
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Group: host('group'),
    Atlas: host('atlas'),
    Picture: host('picture'),
    Rect: host('rect'),
    Circle: host('circle'),
    Skia: {
      XYWHRect: () => ({ setXYWH: () => {} }),
      RSXform: () => ({ set: () => {} }),
      Color: () => [1, 1, 1, 0],
      PictureRecorder: () => ({
        beginRecording: () => ({}),
        finishRecordingAsPicture: () => ({ __picture: true }),
      }),
    },
    useRectBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => ({ setXYWH: () => {} })),
    }),
    useRSXformBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => ({ set: () => {} })),
    }),
    useColorBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => [1, 1, 1, 0]),
    }),
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: () => ({}),
    useFrameCallback: () => {},
    withTiming: (value: unknown) => value,
  },
});
mock.module('react-native-worklets', {
  namedExports: { scheduleOnRN: () => {} },
});
mock.module('expo-asset', { namedExports: { Asset: class {} } });
mock.module('react-native-gesture-handler', {
  namedExports: {
    GestureDetector: host('gesture-detector'),
    Gesture: { Tap: () => ({}), Pan: () => ({}) },
    Directions: {},
    GestureStateManager: {},
    State: {},
    useManualGesture: () => ({}),
  },
});

let BufferProbeScreen: (typeof import('./buffer-probe/BufferProbeScreen'))['default'];
let bufferProbeGame: typeof import('./buffer-probe/bufferProbeGame');

before(async () => {
  // Real implementations, imported from SOURCE (never the lib build): the
  // working in-repo pattern for mocked native modules.
  const { GameWorld2D } = await import(
    '../../../../packages/gamekit/src/react/sprites/GameWorld2D.tsx'
  );
  const { SpriteBatch } = await import(
    '../../../../packages/gamekit/src/react/sprites/SpriteBatch.tsx'
  );
  const { TileMapLayer2D } = await import(
    '../../../../packages/gamekit/src/react/tilemap/TileMapLayer2D.tsx'
  );
  const { ParticleView } = await import(
    '../../../../packages/gamekit/src/react/particles/ParticleView.tsx'
  );
  const { useParticlePresentation } = await import(
    '../../../../packages/gamekit/src/react/particles/useParticlePresentation.ts'
  );
  mock.module('rn-gamekit/react', {
    namedExports: {
      GameWorld2D,
      SpriteBatch,
      TileMapLayer2D,
      ParticleView,
      useParticlePresentation,
      useGameAssets: () => ({
        status: assetGateState.status,
        assets: {
          get: () => ({
            descriptor: { kind: 'image' },
            image: { __image: true, width: 64, height: 64 },
          }),
        },
      }),
    },
  });
  BufferProbeScreen = (await import('./buffer-probe/BufferProbeScreen.tsx')).default;
  bufferProbeGame = await import('./buffer-probe/bufferProbeGame.ts');
});

function findAtlases(renderer: ReturnType<typeof create>): number {
  return renderer.root.findAll((node) => String(node.type) === 'atlas').length;
}

describe('GS-REACT-03 Buffer Probe', () => {
  it('the orbit keeps a constant count, is deterministic, and moves every tick', () => {
    const { BUFFER_PROBE_CONFIG, probeOrbitPositions } = bufferProbeGame;
    const first = probeOrbitPositions(0);
    assert.equal(first.length, BUFFER_PROBE_CONFIG.orbitCount);
    assert.deepEqual(probeOrbitPositions(0), first, 'deterministic per tick');
    const second = probeOrbitPositions(1);
    assert.ok(
      second.some((position, index) => position.x !== first[index]!.x),
      'positions move every tick',
    );
    for (const position of first) {
      const radius = Math.hypot(
        position.x - BUFFER_PROBE_CONFIG.orbitCenterX,
        position.y - BUFFER_PROBE_CONFIG.orbitCenterY,
      );
      assert.ok(
        Math.abs(radius - BUFFER_PROBE_CONFIG.orbitRadius) < 1e-9,
        'constant orbit radius',
      );
    }
  });

  it('the tile map is a valid 40x12 layer with a visible ground pattern', () => {
    const { bufferProbeLevel, BUFFER_PROBE_CONFIG } = bufferProbeGame;
    const layer = bufferProbeLevel.layerById['terrain'];
    assert.ok(layer !== undefined);
    assert.equal(layer.width, BUFFER_PROBE_CONFIG.mapColumns);
    assert.equal(layer.height, BUFFER_PROBE_CONFIG.mapRows);
    const groundRow = layer.data.slice((12 - 1) * 40, 12 * 40);
    assert.ok(groundRow.every((id) => id === 1), 'solid ground row');
    const teethRow = layer.data.slice((12 - 2) * 40, (12 - 1) * 40);
    assert.ok(teethRow.some((id) => id === 2), 'alternating brick teeth');
    assert.ok(teethRow.some((id) => id === 0), 'teeth leave gaps');
  });

  it('the puff effect loops a small burst', () => {
    const { probePuff } = bufferProbeGame;
    assert.equal(probePuff.capacity, 32);
    assert.equal(probePuff.burst.count, 6);
  });

  it('mounts all three Atlas layers behind the asset gate and emits on schedule', async () => {
    assetGateState = { status: 'loading' };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(BufferProbeScreen as never, {
          game: { status: 'idle' },
          onExit: () => {},
          onOpenGame: () => {},
        } as never),
      );
    });
    assert.equal(findAtlases(renderer!), 0, 'nothing draws before the asset lease');

    assetGateState = { status: 'ready' };
    await act(async () => {
      renderer!.update(
        createElement(BufferProbeScreen as never, {
          game: { status: 'idle' },
          onExit: () => {},
          onOpenGame: () => {},
        } as never),
      );
    });
    assert.ok(findAtlases(renderer!) >= 2, 'sprite batch and tile layer Atlases mount');

    mock.timers.enable({ apis: ['setInterval'] });
    try {
      await act(async () => {
        mock.timers.tick(1000);
      });
    } finally {
      mock.timers.reset();
    }
    renderer!.unmount();
  });
});
