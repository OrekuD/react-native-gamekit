/**
 * Camera Lab (T12.8) — a focused screen for camera edge cases.
 *
 * A 2000 x 1500 marker field inside a 320 x 480 viewport. Controls: follow
 * (dead zone + world clamp), zoom presets, slow rotation, deterministic
 * shake, explicit teleport cuts, debug overlay (visible world bounds), and
 * culling. Every value the renderer draws comes from the headless snapshot.
 */
import {
  clampCameraBounds2D,
  createCamera2D,
  createGameSession,
  defineGame,
  defineScene,
  filterCameraVisible2D,
  followCamera2D,
  getCameraVisibleBounds2D,
  sampleCameraShake2D,
  surfaceToWorld2D,
  worldToSurface2D,
  type Aabb2D,
  type Camera2D,
  type GameSession,
} from 'rn-gamekit';
import { resolveViewport2D } from 'rn-gamekit';

export const CAMERA_LAB_CONFIG = {
  logicalWidth: 320,
  logicalHeight: 480,
  worldWidth: 2000,
  worldHeight: 1500,
  markerSpacing: 160,
  deadZone: { x: -60, y: -80, width: 120, height: 160 },
  shakeAmplitude: 10,
  shakeDurationSeconds: 0.5,
} as const;

export const CAMERA_LAB_VIEW: Aabb2D = {
  x: 0,
  y: 0,
  width: CAMERA_LAB_CONFIG.logicalWidth,
  height: CAMERA_LAB_CONFIG.logicalHeight,
};

export const CAMERA_LAB_WORLD: Aabb2D = {
  x: 0,
  y: 0,
  width: CAMERA_LAB_CONFIG.worldWidth,
  height: CAMERA_LAB_CONFIG.worldHeight,
};

export interface CameraLabMarker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly column: number;
  readonly row: number;
}

export interface CameraLabSnapshot {
  readonly camera: Camera2D;
  readonly follow: boolean;
  readonly rotating: boolean;
  readonly shaking: boolean;
  readonly culling: boolean;
  readonly debug: boolean;
  /** A teleport cut signal: the binding snaps on this frame (T12.3). */
  readonly cutSignal: boolean;
  readonly pointerWorld: { readonly x: number; readonly y: number } | undefined;
  readonly markers: readonly CameraLabMarker[];
  /** Headless culling result (T12.6): markers inside the visible region. */
  readonly visibleMarkerIds: readonly string[];
  /** The conservative visible world bounds, for the debug overlay. */
  readonly visibleBounds: Aabb2D;
  /** World/surface round-trip error for a fixed probe (T12-SF4). */
  readonly roundTripError: number;
  readonly elapsed: number;
}

interface CameraLabState {
  readonly camera: Camera2D;
  /** The UNSHAKEN camera center: follow and clamping operate on this, so
   *  the deterministic shake is a pure offset that never accumulates. */
  readonly baseCenter: { readonly x: number; readonly y: number };
  readonly follow: boolean;
  readonly rotating: boolean;
  readonly shaking: boolean;
  readonly culling: boolean;
  readonly debug: boolean;
  readonly cutSignal: boolean;
  readonly zoomPreset: number;
  readonly shakeStartElapsed: number | undefined;
  readonly pointerWorld: { readonly x: number; readonly y: number } | undefined;
  readonly elapsed: number;
}

const ZOOM_PRESETS = [1, 0.75, 1.5] as const;

function markers(): readonly CameraLabMarker[] {
  const result: CameraLabMarker[] = [];
  const { markerSpacing, worldWidth, worldHeight } = CAMERA_LAB_CONFIG;
  let index = 0;
  for (let y = markerSpacing / 2; y < worldHeight; y += markerSpacing) {
    for (let x = markerSpacing / 2; x < worldWidth; x += markerSpacing) {
      result.push({
        id: `m${index}`,
        x,
        y,
        column: Math.round(x / markerSpacing),
        row: Math.round(y / markerSpacing),
      });
      index += 1;
    }
  }
  return result;
}

const INITIAL_CAMERA: Camera2D = createCamera2D({ center: { x: 160, y: 240 } });

const cameraLabScene = defineScene({
  actions: [
    'primary',
    'toggle-follow',
    'cycle-zoom',
    'toggle-rotation',
    'toggle-shake',
    'trigger-cut',
    'toggle-debug',
    'toggle-culling',
  ],
  transitions: [],
  create: (): CameraLabState => ({
    camera: INITIAL_CAMERA,
    baseCenter: INITIAL_CAMERA.center,
    follow: true,
    rotating: false,
    shaking: false,
    culling: true,
    debug: true,
    cutSignal: false,
    zoomPreset: 0,
    shakeStartElapsed: undefined,
    pointerWorld: undefined,
    elapsed: 0,
  }),
  update: ({ state, input, deltaSeconds }): CameraLabState => {
    const follow = input.button('toggle-follow').pressed ? !state.follow : state.follow;
    const rotating = input.button('toggle-rotation').pressed ? !state.rotating : state.rotating;
    const shaking = input.button('toggle-shake').pressed ? !state.shaking : state.shaking;
    const culling = input.button('toggle-culling').pressed ? !state.culling : state.culling;
    const debug = input.button('toggle-debug').pressed ? !state.debug : state.debug;
    const zoomPreset = input.button('cycle-zoom').pressed
      ? (state.zoomPreset + 1) % ZOOM_PRESETS.length
      : state.zoomPreset;
    const triggerCut = input.button('trigger-cut').pressed;

    const pointer = input.pointer('primary');
    const pointerWorld =
      pointer.active && pointer.position !== undefined ? pointer.position : state.pointerWorld;

    // The authored BASE camera: follow and clamping operate on the
    // unshaken center, so the deterministic shake is a pure offset that
    // never accumulates and always ends back on the base.
    let baseCenter = state.baseCenter;
    if (follow) {
      const followed = clampCameraBounds2D(
        followCamera2D(
          { ...state.camera, center: baseCenter },
          pointerWorld ?? baseCenter,
          { deadZone: CAMERA_LAB_CONFIG.deadZone },
        ),
        CAMERA_LAB_WORLD,
        CAMERA_LAB_VIEW,
      );
      baseCenter = followed.center;
    }
    const zoom = ZOOM_PRESETS[zoomPreset] ?? 1;
    const baseCamera: Camera2D = {
      center: baseCenter,
      zoom,
      rotationRadians: rotating ? state.elapsed * 0.25 : 0,
    };

    // Deterministic shake: a pure offset around the stable base, so pointer
    // inversion (which uses the presented camera) stays aligned with what
    // the player sees.
    const elapsed = state.elapsed + deltaSeconds;
    const shakeStartElapsed = shaking
      ? (state.shakeStartElapsed ?? elapsed)
      : undefined;
    const camera =
      shaking && shakeStartElapsed !== undefined
        ? sampleCameraShake2D(baseCamera, {
            seed: 42,
            elapsedSeconds: elapsed - shakeStartElapsed,
            durationSeconds: CAMERA_LAB_CONFIG.shakeDurationSeconds,
            amplitude: CAMERA_LAB_CONFIG.shakeAmplitude,
          })
        : baseCamera;

    const cutSignal = triggerCut;
    return {
      camera,
      baseCenter,
      follow,
      rotating,
      shaking,
      culling,
      debug,
      cutSignal,
      zoomPreset,
      shakeStartElapsed,
      pointerWorld,
      elapsed,
    };
  },
  snapshot: ({ state }): CameraLabSnapshot => {
    const all = markers();
    const visibleMarkerIds = state.culling
      ? filterCameraVisible2D(
          all.map((marker) => ({
            id: marker.id,
            bounds: { x: marker.x - 6, y: marker.y - 6, width: 12, height: 12 },
          })),
          state.camera,
          CAMERA_LAB_VIEW,
          24,
        ).map((item) => item.id)
      : all.map((marker) => marker.id);
    return {
      camera: state.camera,
      follow: state.follow,
      rotating: state.rotating,
      shaking: state.shaking,
      culling: state.culling,
      debug: state.debug,
      cutSignal: state.cutSignal,
      pointerWorld: state.pointerWorld,
      markers: all,
      visibleMarkerIds,
      visibleBounds: getCameraVisibleBounds2D(state.camera, CAMERA_LAB_VIEW),
      // T12-SF4: headless world/surface round-trip error through the same
      // pure conveniences the pointer adapter uses.
      roundTripError: (() => {
        const viewport = resolveViewport2D(
          { logicalSize: { width: CAMERA_LAB_CONFIG.logicalWidth, height: CAMERA_LAB_CONFIG.logicalHeight }, mode: 'fit' },
          { width: CAMERA_LAB_CONFIG.logicalWidth, height: CAMERA_LAB_CONFIG.logicalHeight },
        );
        if (viewport === undefined) {
          return NaN;
        }
        const probe = { x: 123.25, y: -67.5 };
        const round = surfaceToWorld2D(worldToSurface2D(probe, viewport, state.camera), viewport, state.camera);
        return Math.hypot(round.x - probe.x, round.y - probe.y);
      })(),
      elapsed: state.elapsed,
    };
  },
});

export const cameraLabDefinition = defineGame({
  viewport: {
    logicalSize: { width: CAMERA_LAB_CONFIG.logicalWidth, height: CAMERA_LAB_CONFIG.logicalHeight },
    mode: 'fit',
  },
  input: {
    primary: { type: 'pointer', description: 'Move the camera target' },
    'toggle-follow': { type: 'button', description: 'Follow the pointer' },
    'cycle-zoom': { type: 'button', description: 'Cycle zoom presets' },
    'toggle-rotation': { type: 'button', description: 'Rotate the view' },
    'toggle-shake': { type: 'button', description: 'Deterministic shake' },
    'trigger-cut': { type: 'button', description: 'Teleport the camera (snap)' },
    'toggle-debug': { type: 'button', description: 'Show the visible bounds' },
    'toggle-culling': { type: 'button', description: 'Cull off-screen markers' },
  },
  scenes: {
    lab: cameraLabScene,
  },
  initialScene: 'lab',
});

export function createCameraLabSession(): GameSession<
  typeof cameraLabDefinition['scenes'],
  typeof cameraLabDefinition['input']
> {
  return createGameSession(cameraLabDefinition);
}
