/**
 * T20F-R5 / T20G-R1 — mounted async-preparation integration under React
 * Strict Mode, driven through the REAL asset-ready path.
 *
 * Serial startup contract (decided per the T20F-R5 review): asset readiness
 * is the gate — `createSession(context)` runs only after the matched asset
 * lease arrives, and the save I/O runs inside the game factory, joined by
 * its own promise. The test mounts the production `GameAssetAcquirer`
 * (mocked `useGameAssets`, real component) next to the real `GameSurface`
 * + `SurfaceController` boundary and lets the acquirer's effect invoke
 * `onReady` — exactly as the shell wires it. Nothing calls
 * `controller.assetReady()` directly.
 *
 * Under Strict Mode double-invocation, asset arrival, same-props rerenders,
 * and resolution the proof is: one preparation, one binding, one ready
 * publication, one disposal.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, StrictMode } from 'react';
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
mock.module('react-native-worklets', { namedExports: { scheduleOnRN: () => {} } });
mock.module('@shopify/react-native-skia', { namedExports: { Canvas: host('canvas') } });
mock.module('react-native-gesture-handler', {
  namedExports: { GestureDetector: host('gesture-detector') },
});
mock.module('expo-asset', { namedExports: { Asset: class {} } });

// Controllable asset gate: the production `GameAssetAcquirer` consumes this
// through the mocked `useGameAssets`; the test flips it and re-renders, and
// the acquirer's effect — not the test — forwards readiness.
let assetGateState: { status: 'loading' | 'ready'; assets?: unknown } = { status: 'loading' };

mock.module('rn-gamekit/react', {
  namedExports: {
    GameView: host('game-view'),
    GamePointerInput: host('pointer-input'),
    useGameAssets: () => assetGateState,
  },
});

let GameSurface: (typeof import('./GameSurface'))['GameSurface'];
let GameAssetAcquirer: (typeof import('./gameAssetAcquirer'))['GameAssetAcquirer'];
let SurfaceController: (typeof import('./surfaceController'))['SurfaceController'];

before(async () => {
  GameSurface = (await import('./GameSurface.tsx')).GameSurface;
  GameAssetAcquirer = (await import('./gameAssetAcquirer.tsx')).GameAssetAcquirer;
  SurfaceController = (await import('./surfaceController.ts')).SurfaceController;
});

interface SessionStub {
  readonly marker: string;
  status: 'ready' | 'disposed';
  pauseCalls: number;
  pause: () => void;
  start: () => void;
}
function session(marker: string): SessionStub {
  return { marker, status: 'ready', pauseCalls: 0, pause: () => {}, start: () => {} };
}
const RENDERER = (() => null) as never;
const WRAPPED_RENDERER = (() => null) as never;
const CONTENT = (() => null) as never;

describe('T20G-R1 async preparation through the real asset path under Strict Mode', () => {
  it('acquirer effect readiness prepares once, publishes once, binds once, disposes once', async () => {
    const disposeCalls: SessionStub[] = [];
    const bindCalls: SessionStub[] = [];
    const presentationDisposeCalls: SessionStub[] = [];
    const pending: {
      requestId: number;
      resolve: (made: SessionStub) => void;
    }[] = [];
    // Publication counting: distinct ready generations count ready
    // publications; every ready publication must carry the same session.
    let readyPublications = 0;
    const readyGenerations = new Set<number>();
    const readySessionMarkers = new Set<string>();
    const statePublications: string[] = [];
    let latest: import('./surfaceSlot.ts').SurfaceSlot | undefined;
    const controller = new SurfaceController({
      games: {
        'hydration-fixture': {
          renderer: RENDERER,
          content: CONTENT,
          createSession: (context) =>
            new Promise<SessionStub>((resolve) => {
              pending.push({ requestId: context.requestId, resolve });
            }) as never,
          pointer: false,
          assets: { manifest: { kind: 'hydration-manifest' }, groups: ['world'] },
          // T20G-R2: the entry derives the validated startup projection;
          // the ready slot publishes it for the content layer.
          startupSave: (candidate) =>
            `startup:${(candidate as unknown as { marker: string }).marker}`,
          bindPresentation: (candidate) => {
            bindCalls.push(candidate as unknown as SessionStub);
            return {
              renderer: WRAPPED_RENDERER,
              dispose: () => {
                presentationDisposeCalls.push(candidate as unknown as SessionStub);
              },
            };
          },
        },
      },
      neutral: { session: session('neutral') as never, renderer: RENDERER },
      createPlaceholder: () => session('placeholder') as never,
      disposeSession: (candidate) => disposeCalls.push(candidate as unknown as SessionStub),
      onSlot: (slot) => {
        latest = slot;
        // Count ready publications by DISTINCT generation: the shell also
        // republishes an unchanged ready generation when its retirement
        // records drain (T8.4), which is not a second publication of a
        // session. A distinct generation with a ready status always means a
        // new gameplay binding went live.
        if (slot.status === 'ready' && !readyGenerations.has(slot.generation)) {
          readyGenerations.add(slot.generation);
          readyPublications += 1;
        }
        if (slot.status === 'ready')
          readySessionMarkers.add((slot.session as unknown as { marker: string }).marker);
      },
      initialGeneration: 1,
    });

    controller.open('hydration-fixture');
    const loadingSlot = controller.current;
    assert.equal(loadingSlot.status, 'loading');

    // The shell's exact wiring: the acquirer's readiness callback forwards
    // to the controller; display state rides `onStateChange`. Stable
    // identities mirror the shell's useCallback handlers.
    const requestId = loadingSlot.requestId;
    const handleAssetReady = (readyId: number, assets: import('./surfaceSlot.ts').SlotAssets): void => {
      controller.assetReady(readyId, assets);
    };
    const handleAssetState = (stateId: number, state: unknown): void => {
      statePublications.push(`${stateId}:${(state as { status: string }).status}`);
    };

    let renderer: ReturnType<typeof create> | null = null;
    const tree = (): React.ReactElement =>
      createElement(
        StrictMode,
        null,
        createElement(GameAssetAcquirer as never, {
          key: requestId,
          requestId,
          manifest: { kind: 'hydration-manifest' },
          groups: ['world'],
          onReady: handleAssetReady,
          onStateChange: handleAssetState,
        } as never),
        createElement(GameSurface as never, {
          slot: controller.current,
          hidden: false,
          onBindingCommitted: () => controller.bindingCommitted(controller.current.generation),
          onExit: () => {},
          onOpenGame: () => {},
          assetState: undefined,
        } as never),
      );
    const rerenderSurface = async (): Promise<void> => {
      await act(async () => {
        if (renderer === null) renderer = create(tree());
        else renderer.update(tree());
      });
    };

    // Strict Mode double-mount: the acquirer's effect double-invokes with
    // `loading` state; no preparation may start.
    await rerenderSurface();
    assert.equal(pending.length, 0, 'no preparation before the lease arrives');
    assert.deepEqual(statePublications, [`${requestId}:loading`, `${requestId}:loading`]);

    // The asset gate flips to ready and the tree re-renders; the acquirer's
    // effect — through its own effect body — forwards the lease.
    assetGateState = { status: 'ready', assets: { descriptor: 'lease' } };
    await rerenderSurface();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(controller.current.status, 'loading', 'preparation keeps the loading state');
    assert.equal(pending.length, 1, 'exactly one preparation across Strict Mode invocations');
    assert.deepEqual(
      statePublications.slice(-1),
      [`${requestId}:ready`],
      'the acquirer publishes the displayed ready state',
    );

    // Same-props rerenders while preparation is pending change nothing.
    await rerenderSurface();
    await rerenderSurface();
    assert.equal(pending.length, 1, 'rerenders start no new preparation');

    // The save/build promise settles → atomic publication with the binding.
    const made = session('hydration-real');
    pending[0]!.resolve(made);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await rerenderSurface();
    const ready = controller.current;
    assert.equal(ready.status, 'ready');
    assert.equal(ready.session, made as never);
    assert.equal(ready.renderer, WRAPPED_RENDERER, 'one binding: the wrapped renderer');
    assert.equal(bindCalls.length, 1, 'exactly one presentation binding');
    assert.notEqual(ready.presentationDispose, undefined, 'one disposer, owned by the slot');
    assert.equal(
      ready.startupSave,
      'startup:hydration-real',
      'the ready slot publishes the validated startup projection',
    );
    assert.equal(readyPublications, 1, `exactly one ready publication through onSlot (got ${readyPublications})`);
    assert.deepEqual([...readySessionMarkers], ['hydration-real'], 'every ready publication carries the one session');
    assert.notEqual(latest, undefined);

    // Same-props rerenders after publication start nothing new.
    await rerenderSurface();
    assert.equal(pending.length, 1);
    assert.equal(controller.current, ready, 'the ready slot is stable');
    assert.equal(readyPublications, 1, 'no additional ready publications');
    assert.deepEqual([...readySessionMarkers], ['hydration-real']);

    // One disposal owner: controller disposal releases the binding exactly
    // once and the session exactly once.
    await act(async () => {
      controller.dispose();
    });
    assert.equal(presentationDisposeCalls.length, 1, 'exactly one binding release');
    assert.equal(disposeCalls.filter((candidate) => candidate === made).length, 1, 'exactly one session dispose');
    renderer!.unmount();
  });
});
