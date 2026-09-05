/**
 * GS-CAMERA-01 — paused transitions present coherently (mounted).
 *
 * Pause, then transition to a scene with a very different camera: the
 * published frame and the presented camera must change together without
 * advancing tick/alpha or restarting the session. Changing the camera
 * definition while paused must not implicitly start the session, and the
 * next commit must use the replacement definition.
 */
import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import { createElement, useRef } from 'react';
import { act, create } from 'react-test-renderer';

import { createGameSessionWithDriver } from '../src/core/session/createGameSession';
import { defineGame, defineScene } from '../src/index';
import { ManualFrameDriver } from './helpers/ManualFrameDriver';

function host(tag: string) {
  const Component = ({ children, ...props }: Record<string, unknown>): unknown =>
    createElement(tag, props as never, children as never);
  (Component as { displayName?: string }).displayName = tag;
  return Component;
}

interface CapturedPresented {
  value?: { camera?: { center?: { x?: number; y?: number }; zoom?: number } };
}
const captured: { camera: unknown } = { camera: undefined };

mock.module('react-native', {
  namedExports: {
    View: host('view'),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => undefined }),
    },
  },
});
mock.module('@shopify/react-native-skia', {
  namedExports: { Canvas: host('canvas') },
});
mock.module('react-native-reanimated', {
  namedExports: {
    // Stable per hook instance: fresh objects every render would retrigger
    // every effect keyed on a shared value and corrupt the lifecycle under
    // observation (notably the bind-once presentation effect).
    useSharedValue: (initial: unknown) => {
      const box = useRef<{ value: unknown } | null>(null);
      if (box.current === null) {
        box.current = {
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        };
      }
      return box.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: () => ({}),
    useFrameCallback: () => {},
  },
});
mock.module('react-native-worklets', {
  namedExports: { scheduleOnRN: () => {} },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type GameViewModule = typeof import('../src/react/GameView');
let GameView: GameViewModule['GameView'];
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type CameraModule = typeof import('../src/react/camera2d/defineGameCamera2D');
let defineGameCamera2D: CameraModule['defineGameCamera2D'];

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

function cameraAt(x: number, y: number, zoom = 1) {
  return { center: { x, y }, zoom, rotationRadians: 0 };
}

function twoSceneGame() {
  return defineGame({
    viewport,
    input: {},
    scenes: {
      play: defineScene({
        actions: [],
        create: () => ({ camera: cameraAt(0, 0) }),
        update: ({ state }: { state: { readonly camera: unknown } }) => state,
        snapshot: ({ state }: { state: { readonly camera: unknown } }) => ({
          camera: state.camera,
        }),
      }),
      boss: defineScene({
        actions: [],
        create: () => ({ camera: cameraAt(500, 300) }),
        update: ({ state }: { state: { readonly camera: unknown } }) => state,
        snapshot: ({ state }: { state: { readonly camera: unknown } }) => ({
          camera: state.camera,
        }),
      }),
    },
    initialScene: 'play',
  });
}

function capturingRenderer(props: Record<string, unknown>): null {
  captured.camera = (props as { camera?: unknown }).camera;
  return null;
}

before(async () => {
  GameView = (await import('../src/react/GameView.tsx')).GameView;
  defineGameCamera2D = (await import('../src/react/camera2d/defineGameCamera2D.ts'))
    .defineGameCamera2D;
});

describe('GS-CAMERA-01 paused transitions present coherently', () => {
  it('pause, transition, and keep a coherent frame/camera pair without restarting', async () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(twoSceneGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const camera2D = defineGameCamera2D({
      select: (frame) => (frame as { current: { camera: never } }).current.camera as never,
    });
    captured.camera = undefined;
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(GameView as never, {
          game: session,
          renderer: capturingRenderer,
          camera2D,
        } as never),
      );
    });
    driver.fireNext(0);
    driver.fireNext(16);
    const tickBefore = session.getRenderFrame().tick;
    assert.ok(tickBefore >= 1, 'the session ran before pausing');

    await act(async () => {
      session.pause();
    });
    assert.equal(session.status, 'paused');
    session.setScene('boss');

    assert.equal(session.scene, 'boss', 'the frame transitions while paused');
    assert.equal(session.status, 'paused', 'no implicit restart');
    assert.equal(session.getRenderFrame().tick, tickBefore, 'simulation tick does not advance');
    assert.deepEqual(
      (captured.camera as CapturedPresented | undefined)?.value?.camera?.center,
      { x: 500, y: 300 },
      'the presented camera follows the new scene without present()',
    );
    renderer!.unmount();
    session.dispose();
  });

  it('changing the camera definition while paused neither starts nor flashes', async () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(twoSceneGame(), {
      frameDriver: driver,
      fixedStepMs: 10,
    });
    const cameraA = defineGameCamera2D({
      select: (frame) => (frame as { current: { camera: never } }).current.camera as never,
    });
    captured.camera = undefined;
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(GameView as never, {
          game: session,
          renderer: capturingRenderer,
          camera2D: cameraA,
        } as never),
      );
    });
    driver.fireNext(0);
    await act(async () => {
      session.pause();
    });

    const cameraB = defineGameCamera2D({
      select: (frame) => {
        const camera = (
          frame as {
            current: {
              camera: { center: { x: number; y: number }; zoom: number; rotationRadians: number };
            };
          }
        ).current.camera;
        return { ...camera, center: { x: camera.center.x + 1000, y: camera.center.y } };
      },
    });
    await act(async () => {
      renderer!.update(
        createElement(GameView as never, {
          game: session,
          renderer: capturingRenderer,
          camera2D: cameraB,
        } as never),
      );
    });
    assert.equal(session.status, 'paused', 'definition changes never override a user pause');

    // The replacement definition is live through the stable binding.
    await act(async () => {
      session.start();
    });
    driver.fireNext(32);
    driver.fireNext(48);
    assert.equal(
      (captured.camera as CapturedPresented | undefined)?.value?.camera?.center?.x,
      1000,
      'commits after replacement use the new selector',
    );
    renderer!.unmount();
    session.dispose();
  });
});
