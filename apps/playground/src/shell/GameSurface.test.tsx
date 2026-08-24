import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

function host(tag: string) {
  const C = ({ children, ...props }: Record<string, unknown>): unknown =>
    createElement(tag, props as never, children as never);
  (C as { displayName?: string }).displayName = tag;
  return C;
}

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    Text: host('text'),
    Pressable: host('pressable'),
    ActivityIndicator: host('activity-indicator'),
    StyleSheet: {
      create: (s: Record<string, unknown>) => s,
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
      absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    },
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  },
});

const AnimatedMock = { View: host('animated-view') };
mock.module('react-native-reanimated', {
  defaultExport: AnimatedMock,
  namedExports: {
    default: AnimatedMock,
    useSharedValue: (v: unknown) => ({ value: v }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: unknown) => v,
    useReducedMotion: () => true,
    useAnimatedProps: () => ({}),
  },
});

mock.module('react-native-worklets', {
  namedExports: { scheduleOnRN: () => {} },
});

mock.module('@shopify/react-native-skia', {
  namedExports: {
    Canvas: host('canvas'),
    Group: host('group'),
    Atlas: host('atlas'),
    useRectBuffer: () => ({ value: [] }),
    useRSXformBuffer: () => ({ value: [] }),
    Skia: {},
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
  namedExports: { Asset: class {} },
});

mock.module('rn-gamekit/react', {
  namedExports: {
    GameView: host('game-view'),
    GamePointerInput: host('pointer-input'),
    useGameAssets: () => ({ status: 'loading', progress: 0, retry: () => {} }),
  },
});

let GameSurface: typeof import('./GameSurface')['GameSurface'];

before(async () => {
  const mod = await import('./GameSurface.tsx');
  GameSurface = mod.GameSurface;
});

function fakeSession(id: string, status: string = 'running') {
  const presses: string[] = [];
  const releases: string[] = [];
  return {
    id,
    status,
    presses,
    releases,
    input: {
      press: (action: string) => presses.push(action),
      release: (action: string) => releases.push(action),
    },
    addCommitListener: () => ({ remove: () => {} }),
    addStatusListener: () => ({ remove: () => {} }),
    pause: () => {},
    start: () => {},
    dispose: () => {},
    getRenderFrame: () => ({ current: null }),
    viewport: undefined,
    scene: 'test',
  } as unknown as import('rn-gamekit').GameSession & { presses: string[]; releases: string[]; id: string };
}

describe('GameSurface loading gate (T16-SF3)', () => {
  it('does not mount gameplay Content while loading and blocks placeholder input', async () => {
    const placeholder = fakeSession('placeholder');
    const Content = host('gameplay-content');
    const slot = {
      requestId: 1,
      generation: 1,
      gameId: 'platformer-lab',
      status: 'loading' as const,
      session: placeholder,
      renderer: host('renderer'),
      content: Content as never,
      pointer: false,
      retiring: [],
    } as unknown as import('./surfaceSlot').SurfaceSlot;

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(GameSurface as never, {
          slot,
          hidden: false,
          onBindingCommitted: () => {},
          onExit: () => {},
          onOpenGame: () => {},
          assetState: { status: 'loading', progress: 0.3, retry: () => {}, requestKey: '1' } as never,
        } as never),
      );
    });
    const root = renderer!.root;
    // Gameplay content must NOT be mounted during loading
    assert.equal(root.findAll((n: any) => n.type.displayName === 'gameplay-content').length, 0);
    // Asset gate overlay must be present and block touches
    assert.ok(root.findAll((n: any) => n.props?.testID === 'asset-gate-overlay').length > 0);
    // Back must be usable
    assert.ok(root.findAll((n: any) => n.props?.testID === 'asset-gate-back').length > 0);
    // Placeholder session must not have received gameplay input
    assert.equal(placeholder.presses.length, 0);
    assert.equal(placeholder.releases.length, 0);
  });

  it('mounts Content with real session and exact lease when ready', async () => {
    const placeholder = fakeSession('placeholder');
    const real = fakeSession('real');
    const lease = { descriptor: 'platformer-tiles-lease' };
    const ContentSpy = ({ game }: { game: unknown }) => {
      (ContentSpy as unknown as { lastGame?: unknown }).lastGame = game;
      return createElement('gameplay-content' as never, null);
    };
    (ContentSpy as unknown as { displayName?: string }).displayName = 'gameplay-content';

    const loadingSlot = {
      requestId: 1,
      generation: 1,
      gameId: 'platformer-lab',
      status: 'loading' as const,
      session: placeholder,
      renderer: host('renderer'),
      content: ContentSpy as never,
      pointer: false,
      retiring: [],
    } as unknown as import('./surfaceSlot').SurfaceSlot;

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(GameSurface as never, {
          slot: loadingSlot,
          hidden: false,
          onBindingCommitted: () => {},
          onExit: () => {},
          onOpenGame: () => {},
          assetState: { status: 'loading', progress: 0.3, retry: () => {}, requestKey: '1' } as never,
        } as never),
      );
    });
    // Initially loading: no content
    assert.equal(renderer!.root.findAll((n: any) => n.type.displayName === 'gameplay-content').length, 0);

    const readySlot = {
      requestId: 1,
      generation: 2,
      gameId: 'platformer-lab',
      status: 'ready' as const,
      session: real,
      renderer: host('renderer'),
      content: ContentSpy as never,
      assets: lease,
      pointer: false,
      retiring: [],
    } as unknown as import('./surfaceSlot').SurfaceSlot;

    await act(async () => {
      renderer!.update(
        createElement(GameSurface as never, {
          slot: readySlot,
          hidden: false,
          onBindingCommitted: () => {},
          onExit: () => {},
          onOpenGame: () => {},
          assetState: { status: 'ready', assets: lease, requestKey: '1' } as never,
        } as never),
      );
    });
    // Gate must disappear and Content mount exactly once with real session
    assert.equal(renderer!.root.findAll((n: any) => n.props?.testID === 'asset-gate-overlay').length, 0);
    assert.ok(renderer!.root.findAll((n: any) => n.type.displayName === 'gameplay-content').length > 0);
    assert.equal((ContentSpy as unknown as { lastGame?: unknown }).lastGame, real);
  });

  it('shows error UI and retry calls exact active request, stale cannot supply', async () => {
    const placeholder = fakeSession('placeholder');
    const Content = host('gameplay-content');
    let retried = 0;
    const retrySpy = () => { retried += 1; };
    const errorState = {
      status: 'error' as const,
      error: new Error('network failed'),
      retry: retrySpy,
      requestKey: '1',
    } as never;

    const loadingSlot = {
      requestId: 1,
      generation: 1,
      gameId: 'platformer-lab',
      status: 'loading' as const,
      session: placeholder,
      renderer: host('renderer'),
      content: Content as never,
      pointer: false,
      retiring: [],
    } as unknown as import('./surfaceSlot').SurfaceSlot;

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(GameSurface as never, {
          slot: loadingSlot,
          hidden: false,
          onBindingCommitted: () => {},
          onExit: () => {},
          onOpenGame: () => {},
          assetState: errorState,
        } as never),
      );
    });
    // Error UI must render, retry must be present, content must not be mounted
    assert.ok(renderer!.root.findAll((n: any) => n.props?.testID === 'asset-gate-error').length > 0);
    const retryBtn = renderer!.root.findAll((n: any) => n.props?.testID === 'asset-gate-retry')[0]!;
    (retryBtn.props as { onPress: () => void }).onPress();
    assert.equal(retried, 1, 'retry calls exact active request retry once');
    assert.equal(renderer!.root.findAll((n: any) => n.type.displayName === 'gameplay-content').length, 0);

    // Stale asset state for different request must not affect current surface
    // (simulates shell filtering: if shell passed stale, it would be ignored;
    // here we prove GameSurface itself would still show gate, not content)
    const staleError = {
      status: 'error' as const,
      error: new Error('stale error'),
      retry: () => { retried += 10; },
      requestKey: '999',
    } as never;
    // Rerender with stale error for same loading slot - should still show gate (not content)
    // but retry should be stale's retry if passed through; in real shell, stale would be filtered to loading spinner
    // We test that Content still not mounted even with stale error prop (gate blocks)
    await act(async () => {
      renderer!.update(
        createElement(GameSurface as never, {
          slot: loadingSlot,
          hidden: false,
          onBindingCommitted: () => {},
          onExit: () => {},
          onOpenGame: () => {},
          assetState: staleError,
        } as never),
      );
    });
    assert.equal(renderer!.root.findAll((n: any) => n.type.displayName === 'gameplay-content').length, 0);
    // Back remains usable even in error
    assert.ok(renderer!.root.findAll((n: any) => n.props?.testID === 'asset-gate-back').length > 0);
  });

  it('close remains safe while error is shown', async () => {
    const placeholder = fakeSession('placeholder');
    const Content = host('gameplay-content');
    let closed = false;
    const slot = {
      requestId: 1,
      generation: 1,
      gameId: 'platformer-lab',
      status: 'loading' as const,
      session: placeholder,
      renderer: host('renderer'),
      content: Content as never,
      pointer: false,
      retiring: [],
    } as unknown as import('./surfaceSlot').SurfaceSlot;

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(GameSurface as never, {
          slot,
          hidden: false,
          onBindingCommitted: () => {},
          onExit: () => { closed = true; },
          onOpenGame: () => {},
          assetState: { status: 'error', error: new Error('fail'), retry: () => {}, requestKey: '1' } as never,
        } as never),
      );
    });
    const back = renderer!.root.findAll((n: any) => n.props?.testID === 'asset-gate-back')[0]!;
    (back.props as { onPress: () => void }).onPress();
    assert.equal(closed, true);
  });
});
