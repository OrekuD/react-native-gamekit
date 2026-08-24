/**
 * Platformer Lab — the Task 16 reference platformer (T16.6, rebuilt per
 * T16-F2).
 *
 * The player body, velocity, gravity, and `movePlatformerBody2D` live in
 * the headless scene's FIXED-STEP update — the screen owns no clock or
 * scheduler. Three deterministic checkpoints sit at fixed world x
 * positions; crossing one emits a typed Task 13 event and records it in
 * scene state. The renderer only presents committed snapshots.
 */
import {
  clampCameraBounds2D,
  createCamera2D,
  createGameSession,
  defineAssets,
  defineGame,
  defineGameEvents,
  defineScene,
  gameEvent,
  image,
  type Aabb2D,
  type Camera2D,
  type GameAssetManifest,
  type GameSession,
} from 'rn-gamekit';
import {
  defineTileMap2D,
  defineTileSet2D,
  movePlatformerBody2D,
} from 'rn-gamekit/tilemap';

// ---------------------------------------------------------------------------
// Level definition (immutable module-scope data)
// ---------------------------------------------------------------------------

export const PLATFORMER_LAB_CONFIG = {
  logicalWidth: 320,
  logicalHeight: 480,
  cellSize: 32,
  mapColumns: 60,
  mapRows: 18,
  gravity: 1400,
  moveSpeed: 220,
  jumpVelocity: -560,
  floorSnapDistance: 4,
  /** Deterministic checkpoint world x positions. */
  checkpoints: [512, 1024, 1536],
} as const;

export const PLATFORMER_LAB_WORLD: Aabb2D = {
  x: 0,
  y: 0,
  width: PLATFORMER_LAB_CONFIG.mapColumns * PLATFORMER_LAB_CONFIG.cellSize,
  height: PLATFORMER_LAB_CONFIG.mapRows * PLATFORMER_LAB_CONFIG.cellSize,
};

export const PLATFORMER_LAB_VIEW: Aabb2D = {
  x: 0,
  y: 0,
  width: PLATFORMER_LAB_CONFIG.logicalWidth,
  height: PLATFORMER_LAB_CONFIG.logicalHeight,
};

const C = PLATFORMER_LAB_CONFIG.cellSize;

/**
 * Terrain rows (row-major, 60x18): ground along the bottom two rows with
 * two gaps, brick floats, one-way planks above them.
 */
function buildTerrain(): number[] {
  const { mapColumns: W, mapRows: H } = PLATFORMER_LAB_CONFIG;
  const data = new Array(W * H).fill(0);
  const set = (x: number, y: number, id: number): void => {
    if (x >= 0 && x < W && y >= 0 && y < H) data[y * W + x] = id;
  };
  // Ground rows with two jumpable gaps (96px and 64px wide).
  for (let x = 0; x < W; x++) {
    const inGap = (x >= 20 && x <= 22) || (x === 44 || x === 45);
    if (!inGap) {
      set(x, H - 1, 1);
      set(x, H - 2, 1);
    }
  }
  // Reachability budget: max jump rise ~= v^2 / (2g) ~= 111px (3.5 cells).
  // One-way planks bridge the first gap one hop above ground (row H-5,
  // top = 416; rise 96px from the 512px ground top).
  for (let x = 19; x <= 25; x++) set(x, H - 5, 3);
  // Brick floats above the planks (row H-7, top = 352; rise 64px).
  for (let x = 30; x <= 36; x++) set(x, H - 7, 2);
  // Higher planks above the bricks (row H-9, top = 288; rise 64px).
  for (let x = 31; x <= 35; x++) set(x, H - 9, 3);
  // Late brick float reachable from the ground (row H-5).
  for (let x = 48; x <= 52; x++) set(x, H - 5, 2);
  return data;
}

/** Decorative cloud layer (parallax presentation only; never collides). */
function buildClouds(): number[] {
  const { mapColumns: W, mapRows: H } = PLATFORMER_LAB_CONFIG;
  const data = new Array(W * H).fill(0);
  let seed = 7;
  for (let i = 0; i < 40; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = seed % W;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const y = seed % Math.max(1, H - 8);
    data[y * W + x] = 4;
  }
  return data;
}

export const platformerLabTileset = defineTileSet2D({
  tiles: {
    ground: { frame: 'ground', collision: 'solid' },
    brick: { frame: 'brick', collision: 'solid' },
    plank: { frame: 'oneway', collision: 'one-way-up' },
    cloud: { frame: 'cloud' },
  },
});

export const platformerLabLevel = defineTileMap2D({
  cellSize: { width: C, height: C },
  origin: { x: 0, y: 0 },
  tileset: platformerLabTileset,
  layers: [
    { id: 'terrain', width: PLATFORMER_LAB_CONFIG.mapColumns, height: PLATFORMER_LAB_CONFIG.mapRows, data: buildTerrain() },
    { id: 'clouds', width: PLATFORMER_LAB_CONFIG.mapColumns, height: PLATFORMER_LAB_CONFIG.mapRows, collidable: false, data: buildClouds() },
  ],
});

/** The spawn point stands on the first ground row, left of every gap. */
export const PLAYER_SPAWN: Aabb2D = {
  x: 2 * C + 4,
  y: (PLATFORMER_LAB_CONFIG.mapRows - 2) * C - 28,
  width: 24,
  height: 28,
};

// ---------------------------------------------------------------------------
// Assets (real bundled tilesheet through the Gamekit asset APIs)
// ---------------------------------------------------------------------------

export const platformerLabAssets = defineAssets({
  world: {
    tiles: image(require('../../../assets/platformer-tiles.png')),
  },
});

export type PlatformerLabManifest = GameAssetManifest<typeof platformerLabAssets>;

// ---------------------------------------------------------------------------
// Events (Task 13)
// ---------------------------------------------------------------------------

export const platformerLabEvents = defineGameEvents({
  checkpoint: gameEvent<{ readonly index: number; readonly x: number }>(),
});

// ---------------------------------------------------------------------------
// Scene state and snapshot
// ---------------------------------------------------------------------------

export interface PlatformerCheckpointState {
  readonly x: number;
  readonly reached: boolean;
}

export interface PlatformerLabSnapshot {
  readonly body: Aabb2D;
  readonly onGround: boolean;
  readonly facingRight: boolean;
  readonly contacts: {
    readonly floor: boolean;
    readonly leftWall: boolean;
    readonly rightWall: boolean;
    readonly ceiling: boolean;
  };
  readonly checkpoints: readonly PlatformerCheckpointState[];
  readonly elapsed: number;
  /** Monotonic committed tick count (render-schedule comparisons). */
  readonly ticks: number;
}

interface PlatformerLabState {
  readonly body: Aabb2D;
  readonly vx: number;
  readonly vy: number;
  readonly onGround: boolean;
  readonly facingRight: boolean;
  readonly contacts: PlatformerLabSnapshot['contacts'];
  readonly checkpointsReached: readonly boolean[];
  readonly elapsed: number;
  readonly ticks: number;
  /** One-shot cut signal so the camera snaps to the spawn on frame one. */
  readonly spawnCut: boolean;
}

function makeState(): PlatformerLabState {
  return {
    body: PLAYER_SPAWN,
    vx: 0,
    vy: 0,
    onGround: false,
    facingRight: true,
    contacts: { floor: false, leftWall: false, rightWall: false, ceiling: false },
    checkpointsReached: PLATFORMER_LAB_CONFIG.checkpoints.map(() => false),
    elapsed: 0,
    ticks: 0,
    spawnCut: true,
  };
}

const platformerLabScene = defineScene({
  actions: ['left', 'right', 'jump', 'drop'],
  transitions: [],
  emits: ['checkpoint'],
  events: platformerLabEvents,
  create: makeState,
  update: ({ state, input, events, deltaSeconds }): PlatformerLabState => {
    const left = input.button('left').held ?? false;
    const right = input.button('right').held ?? false;
    const drop = input.button('drop').held ?? false;
    const jumpPressed = input.button('jump').pressed;

    let vx = left === right ? 0 : right ? PLATFORMER_LAB_CONFIG.moveSpeed : -PLATFORMER_LAB_CONFIG.moveSpeed;
    let vy = state.vy + PLATFORMER_LAB_CONFIG.gravity * deltaSeconds;
    // Jump only from the ground (contact fact of the PREVIOUS step).
    if (jumpPressed && state.onGround) {
      vy = PLATFORMER_LAB_CONFIG.jumpVelocity;
    }

    const result = movePlatformerBody2D({
      body: state.body,
      velocity: { x: vx, y: vy },
      deltaSeconds,
      map: platformerLabLevel,
      collisionLayers: ['terrain'],
      dropThroughOneWay: drop,
      floorSnapDistance: PLATFORMER_LAB_CONFIG.floorSnapDistance,
    });

    const onGround = result.contacts.floor !== undefined;
    const checkpointsReached = PLATFORMER_LAB_CONFIG.checkpoints.map(
      (cx, index) =>
        state.checkpointsReached[index] ||
        result.body.x + result.body.width / 2 >= cx,
    );
    // T13: emit exactly once per newly reached checkpoint.
    checkpointsReached.forEach((reached, index) => {
      if (reached && !state.checkpointsReached[index]) {
        events.emit('checkpoint', {
          index,
          x: PLATFORMER_LAB_CONFIG.checkpoints[index]!,
        });
      }
    });

    return {
      body: result.body,
      vx,
      vy: onGround ? 0 : result.velocity.y,
      onGround,
      facingRight: vx > 0 ? true : vx < 0 ? false : state.facingRight,
      contacts: {
        floor: onGround,
        leftWall: result.contacts.leftWall !== undefined,
        rightWall: result.contacts.rightWall !== undefined,
        ceiling: result.contacts.ceiling !== undefined,
      },
      checkpointsReached,
      elapsed: state.elapsed + deltaSeconds,
      ticks: state.ticks + 1,
      // The cut fires only on the very first update after create().
      spawnCut: false,
    };
  },
  snapshot: ({ state }): PlatformerLabSnapshot => ({
    body: state.body,
    onGround: state.onGround,
    facingRight: state.facingRight,
    contacts: state.contacts,
    checkpoints: PLATFORMER_LAB_CONFIG.checkpoints.map((x, index) => ({
      x,
      reached: state.checkpointsReached[index]!,
    })),
    elapsed: state.elapsed,
    ticks: state.ticks,
  }),
});

export const platformerLabDefinition = defineGame({
  viewport: {
    logicalSize: { width: PLATFORMER_LAB_CONFIG.logicalWidth, height: PLATFORMER_LAB_CONFIG.logicalHeight },
    mode: 'fit',
  },
  assets: platformerLabAssets,
  input: {
    left: { type: 'button', description: 'Walk left' },
    right: { type: 'button', description: 'Walk right' },
    jump: { type: 'button', description: 'Jump' },
    drop: { type: 'button', description: 'Drop through one-way planks' },
  },
  events: platformerLabEvents,
  scenes: {
    lab: platformerLabScene,
  },
  initialScene: 'lab',
});

// ---------------------------------------------------------------------------
// Camera binding: presented camera follows the player, clamped to the world
// ---------------------------------------------------------------------------

const INITIAL_CAMERA: Camera2D = createCamera2D({
  center: {
    x: PLAYER_SPAWN.x + PLAYER_SPAWN.width / 2,
    y: PLAYER_SPAWN.y,
  },
});

/** Clamp the follow center so the view never leaves the level bounds. */
export function followCenterFor(center: { x: number; y: number }): { x: number; y: number } {
  return clampCameraBounds2D(
    { ...INITIAL_CAMERA, center },
    PLATFORMER_LAB_WORLD,
    PLATFORMER_LAB_VIEW,
  ).center;
}

export function initialPlatformerCamera(): Camera2D {
  return INITIAL_CAMERA;
}

export function createPlatformerLabSession(): GameSession<
  typeof platformerLabDefinition['scenes'],
  typeof platformerLabDefinition['input']
> {
  return createGameSession(platformerLabDefinition);
}
