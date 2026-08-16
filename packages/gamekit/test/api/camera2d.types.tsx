/**
 * Compile-time contract fixture (T12.0) for Camera2D.
 *
 * Typechecked only — never executed. Frozen by `tsconfig.assets.json`
 * (`pnpm typecheck:assets`) once the Camera2D surface lands. The fixture
 * pins the smallest intended author experience:
 *
 * - a game with no camera and no API changes;
 * - a static camera binding passed to `GameView` only;
 * - a discriminated-scene camera selector that handles every scene;
 * - a renderer receiving the presented camera as a shared value;
 * - a pointer adapter that never repeats the camera binding;
 * - headless imports of every pure camera helper from `rn-gamekit`;
 * - layers with default and per-axis parallax;
 * - invalid 3D or mutable camera shapes rejected by TypeScript.
 *
 * Decision record (T12.0): the static binding wins over a direct selector
 * prop and over a mandatory camera field in every frame, because the
 * pointer adapter must consume the SAME presented generation as the
 * renderer without duplicating the selector. Absence keeps the exact
 * current viewport path; an explicit identity camera must match it within
 * the documented floating-point tolerance.
 */
import { createElement } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import {
  clampCameraBounds2D,
  createCamera2D,
  defineGame,
  defineScene,
  followCamera2D,
  getCameraVisibleBounds2D,
  logicalToWorld2D,
  sampleCameraShake2D,
  surfaceToWorld2D,
  worldToLogical2D,
  worldToSurface2D,
  type Aabb2D,
  type Camera2D,
  type CameraCut2D,
  type CommitFrame,
  type GameSession,
  type Point2D,
  type ResolvedViewport2D,
} from 'rn-gamekit';
import {
  GameLayer2D,
  GamePointerInput,
  GameView,
  GameWorld2D,
  defineGameCamera2D,
  useGameSession,
  type GameRendererProps,
} from 'rn-gamekit/react';

// ---------------------------------------------------------------------------
// Headless pure surface: all camera helpers import from the native-free root.
// ---------------------------------------------------------------------------

const logicalView: Aabb2D = { x: -80, y: -120, width: 160, height: 240 };
const resolvedViewport = undefined as unknown as ResolvedViewport2D;

const authored: Camera2D = createCamera2D({ center: { x: 10, y: 20 }, zoom: 2 });
const identity: Camera2D = createCamera2D();

const logicalPoint: Point2D = worldToLogical2D({ x: 5, y: 5 }, authored, logicalView);
const worldPoint: Point2D = logicalToWorld2D(logicalPoint, authored, logicalView);
const visibleBounds: Aabb2D = getCameraVisibleBounds2D(authored, logicalView);
const surfacePoint: Point2D = worldToSurface2D(worldPoint, resolvedViewport, authored);
const worldAgain: Point2D = surfaceToWorld2D(surfacePoint, resolvedViewport, authored);

const followed: Camera2D = followCamera2D(
  authored,
  { x: 100, y: 100 },
  { deadZone: { x: -16, y: -16, width: 32, height: 32 }, perAxis: { x: true, y: true } },
  1 / 60,
);
const clamped: Camera2D = clampCameraBounds2D(
  followed,
  { x: 0, y: 0, width: 2000, height: 2000 },
  logicalView,
);
const shaken: Camera2D = sampleCameraShake2D(clamped, {
  seed: 7,
  elapsedSeconds: 0.25,
  durationSeconds: 0.3,
  amplitude: 4,
});

// Camera values are immutable plain data; every helper returns a new value.
const _used: readonly [Point2D, Point2D, Aabb2D, Point2D, Point2D, Camera2D, Camera2D, Camera2D] = [
  logicalPoint,
  worldPoint,
  visibleBounds,
  surfacePoint,
  worldAgain,
  followed,
  clamped,
  shaken,
];

// ---------------------------------------------------------------------------
// Games with a camera: authored camera data lives in the scene snapshot and
// the static binding selects it from committed frames.
// ---------------------------------------------------------------------------

const playScene = defineScene({
  actions: ['move'],
  create: () => ({ camera: identity }),
  update: ({ state }) => state,
  snapshot: ({ state }) => ({ camera: state.camera }),
});

const staticCameraGame = defineGame({
  viewport: {
    logicalSize: { width: 160, height: 240 },
    mode: 'fit',
  },
  input: {
    move: { type: 'pointer' },
  },
  scenes: {
    play: playScene,
  },
  initialScene: 'play',
});

const staticCamera = defineGameCamera2D({
  select: (frame: CommitFrame<typeof staticCameraGame['scenes']>) => frame.current.camera,
});

// A discriminated-scene game: the selector receives the union and must
// handle every scene's snapshot.
const menuScene = defineScene({
  actions: ['move'],
  create: () => ({ camera: identity }),
  update: ({ state }) => state,
  snapshot: ({ state }) => ({ camera: state.camera }),
});

const multiSceneGame = defineGame({
  viewport: {
    logicalSize: { width: 160, height: 240 },
    mode: 'fit',
  },
  input: {
    move: { type: 'pointer' },
  },
  scenes: {
    menu: menuScene,
    play: playScene,
  },
  initialScene: 'menu',
});

const multiSceneCamera = defineGameCamera2D({
  select: (frame: CommitFrame<typeof multiSceneGame['scenes']>) => frame.current.camera,
});
void multiSceneGame;
void multiSceneCamera;

// ---------------------------------------------------------------------------
// React surface: GameView owns the presented camera; the renderer receives
// it as a shared value; the pointer adapter discovers it from the surface.
// ---------------------------------------------------------------------------

function PlatformRenderer({
  frame,
  viewport,
  camera,
}: GameRendererProps<typeof staticCameraGame['scenes']>): React.ReactElement {
  return (
    <GameWorld2D viewport={viewport} camera={camera}>
      <GameLayer2D parallax={{ x: 0.25, y: 0.25 }}>
        <>{frame.value.current.camera.zoom}</>
      </GameLayer2D>
      <GameLayer2D>
        <>{frame.value.current.camera.zoom}</>
      </GameLayer2D>
    </GameWorld2D>
  );
}

const presentedCamera = undefined as unknown as SharedValue<CameraCut2D | undefined>;
const _rendererAcceptsCamera: GameRendererProps<typeof staticCameraGame['scenes']> = {
  frame: undefined as unknown as SharedValue<CommitFrame<typeof staticCameraGame['scenes']>>,
  alpha: undefined as unknown as SharedValue<number>,
  viewport: undefined as unknown as SharedValue<ResolvedViewport2D | undefined>,
  camera: presentedCamera,
};

function CameraGame(): React.ReactElement {
  const session = useGameSession(staticCameraGame);
  if (session === undefined) {
    return <></>;
  }
  return (
    <GameView game={session} renderer={PlatformRenderer} camera2D={staticCamera}>
      <GamePointerInput game={session} action="move" />
    </GameView>
  );
}

// A game with NO camera must compile with no API changes at all.
function PlainRenderer({
  frame,
  viewport,
}: GameRendererProps<typeof staticCameraGame['scenes']>): React.ReactElement {
  return <GameWorld2D viewport={viewport}>{frame.value.current.camera.zoom}</GameWorld2D>;
}

function NoCameraGame(): React.ReactElement {
  const session = useGameSession(staticCameraGame);
  if (session === undefined) {
    return <></>;
  }
  return <GameView game={session} renderer={PlainRenderer} />;
}

const _game: GameSession = undefined as unknown as GameSession;

// The fixture components are compile-only: mark them used, matching the
// other test/api fixtures.
void CameraGame;
void NoCameraGame;

// ---------------------------------------------------------------------------
// Negative fixtures: the camera contract is 2D, immutable, and headless.
// ---------------------------------------------------------------------------

const _threeDimensional: Camera2D = {
  center: { x: 0, y: 0 },
  zoom: 1,
  rotationRadians: 0,
  // @ts-expect-error — Camera2D has no third dimension
  z: 1,
};

const _controller: Camera2D = {
  center: { x: 0, y: 0 },
  zoom: 1,
  rotationRadians: 0,
  // @ts-expect-error — Camera2D is plain data, not a mutable controller
  moveTo: (): void => undefined,
};

const _invalidParallax: { x: number; y: number } = {
  // @ts-expect-error — parallax factors are finite numbers per axis
  x: '0.25' as unknown as string,
  y: 0,
};

const _adapterProps = { game: _game, action: 'move' as const, camera2D: staticCamera };
// @ts-expect-error — the camera binding belongs to GameView, never to the
// pointer adapter; the adapter discovers it from the mounted surface
createElement(GamePointerInput, _adapterProps);
