/**
 * Mossy Cavern 2 — a self-contained GameKit platformer.
 *
 * This file deliberately does not depend on any of the playground's other
 * platformer implementations. The only runtime authority is the GameKit
 * session below: React observes its compact snapshots and routes touch
 * controls/effects back into the session's semantic input/events surface.
 */
import {
  createGameSession,
  defineGame,
  defineScene,
  type GameSession,
} from 'rn-gamekit';
import { defineAssets, image, spriteSheet } from 'rn-gamekit/assets';
import {
  clampCameraBounds2D,
  createCamera2D,
  followCamera2D,
  sampleCameraShake2D,
  type Camera2D,
} from 'rn-gamekit/camera2d';
import { intersectsAabbAabb2D } from 'rn-gamekit/collision2d';
import { defineGameEvents, gameEvent } from 'rn-gamekit/events';
import type { Aabb2D } from 'rn-gamekit/geometry';
import type { MossyCavern2Profile } from './mossyCavern2Save.ts';
import {
  defineTileMap2D,
  defineTileSet2D,
  movePlatformerBody2D,
} from 'rn-gamekit/tilemap';


export const MOSSY_CAVERN_2_CONFIG = {
  logicalWidth: 360,
  logicalHeight: 640,
  worldWidth: 3840,
  worldHeight: 1152,
  tileSize: 64,
  playerWidth: 30,
  playerHeight: 50,
  spawn: { x: 96, y: 910 },
  runSpeed: 184,
  runAcceleration: 1_500,
  gravity: 1_280,
  jumpVelocity: -470,
  maxFallSpeed: 620,
  dashSpeed: 760,
  dashDuration: 0.2,
  dashCooldown: 0.36,
  gateX: 3_570,
} as const;

/**
 * The source art came as individual character frames. The pose images keep
 * the render tree stable while still letting the GameKit sprite layer select
 * a meaningful authored state.
 */
export const mossyCavern2Assets = defineAssets({
  world: {
    hills: image(require('../../../assets/mossy-cavern-2/hills.png')),
    backgroundDecoration: image(
      require('../../../assets/mossy-cavern-2/background-decoration.png'),
    ),
    floatingPlatforms: image(
      require('../../../assets/mossy-cavern-2/floating-platforms.png'),
    ),
    decorationsHazards: image(
      require('../../../assets/mossy-cavern-2/decorations-hazards.png'),
    ),
    hangingPlants: image(require('../../../assets/mossy-cavern-2/hanging-plants.png')),
    poisonPlant: image(require('../../../assets/mossy-cavern-2/poison-plant.png')),
    windPlant: image(require('../../../assets/mossy-cavern-2/wind-plant.png')),
    wizardIdle: image(require('../../../assets/mossy-cavern-2/wizard-idle.png')),
    wizardWalk: image(require('../../../assets/mossy-cavern-2/wizard-walk.png')),
    wizardJump: image(require('../../../assets/mossy-cavern-2/wizard-jump.png')),
    wizardDash: image(require('../../../assets/mossy-cavern-2/wizard-dash.png')),
    slimeGreen: image(require('../../../assets/mossy-cavern-2/slime-green.png')),
    slimeOrange: image(require('../../../assets/mossy-cavern-2/slime-orange.png')),
    tileAtlas: spriteSheet(require('../../../assets/mossy-cavern-2/tile-atlas.png'), {
      frames: {
        moss: { x: 0, y: 0, width: 64, height: 64 },
        stone: { x: 64, y: 0, width: 64, height: 64 },
        ledge: { x: 128, y: 0, width: 64, height: 64 },
        relic: { x: 192, y: 0, width: 64, height: 64 },
      },
      animations: {
        still: { frames: ['moss'], frameDurationMs: 500, mode: 'loop' },
      },
    }),
  },
});

/** Static audio module handles consumed lazily by rn-gamekit/audio. */
export const MOSSY_CAVERN_2_AUDIO_SOURCES = {
  music: require('../../../assets/mossy-cavern-2/audio/music.wav'),
  jump: require('../../../assets/mossy-cavern-2/audio/jump.wav'),
  dash: require('../../../assets/mossy-cavern-2/audio/dash.wav'),
  relic: require('../../../assets/mossy-cavern-2/audio/relic.wav'),
  checkpoint: require('../../../assets/mossy-cavern-2/audio/checkpoint.wav'),
  slime: require('../../../assets/mossy-cavern-2/audio/slime.wav'),
  damage: require('../../../assets/mossy-cavern-2/audio/damage.wav'),
  complete: require('../../../assets/mossy-cavern-2/audio/complete.wav'),
  fanfare: require('../../../assets/mossy-cavern-2/audio/fanfare.wav'),
} as const;

/** Artwork from the supplied controller prompt pack, used as an honest hint. */
export const MOSSY_CAVERN_2_PROMPTS = {
  keyboard: require('../../../assets/mossy-cavern-2/prompts/keyboard.png'),
  xbox: require('../../../assets/mossy-cavern-2/prompts/xbox.png'),
  playstation: require('../../../assets/mossy-cavern-2/prompts/playstation.png'),
  switch: require('../../../assets/mossy-cavern-2/prompts/switch.png'),
} as const;

const TILE_COLUMNS = MOSSY_CAVERN_2_CONFIG.worldWidth / MOSSY_CAVERN_2_CONFIG.tileSize;
const TILE_ROWS = MOSSY_CAVERN_2_CONFIG.worldHeight / MOSSY_CAVERN_2_CONFIG.tileSize;
const FLOOR_ROW = 15;

const mossyCavern2TileSet = defineTileSet2D({
  tiles: {
    moss: { frame: 'moss', collision: 'solid' },
    stone: { frame: 'stone', collision: 'solid' },
    ledge: { frame: 'ledge', collision: 'one-way-up' },
    glow: { frame: 'relic' },
  },
});

function makeTileData(
  paint: (set: (column: number, row: number, tile: keyof typeof mossyCavern2TileSet.idOfName) => void) => void,
): number[] {
  const data = Array.from({ length: TILE_COLUMNS * TILE_ROWS }, () => 0);
  const set = (column: number, row: number, tile: keyof typeof mossyCavern2TileSet.idOfName): void => {
    if (column < 0 || column >= TILE_COLUMNS || row < 0 || row >= TILE_ROWS) return;
    data[row * TILE_COLUMNS + column] = mossyCavern2TileSet.idOfName[tile];
  };
  paint(set);
  return data;
}

const terrainData = makeTileData((set) => {
  for (let column = 0; column < TILE_COLUMNS; column += 1) {
    set(column, FLOOR_ROW, 'moss');
    set(column, FLOOR_ROW + 1, 'stone');
    set(column, FLOOR_ROW + 2, 'stone');
  }
  // The raised blocks create optional jump routes without obstructing the
  // opening onboarding stretch or the headless test path.
  for (const [column, height] of [
    [17, 2],
    [28, 3],
    [39, 2],
    [49, 4],
    [55, 2],
  ] as const) {
    for (let row = FLOOR_ROW - height; row < FLOOR_ROW; row += 1) {
      set(column, row, 'moss');
    }
  }
});

const shelfData = makeTileData((set) => {
  for (const [column, row] of [
    [11, 11],
    [12, 11],
    [21, 9],
    [22, 9],
    [33, 10],
    [34, 10],
    [44, 8],
    [45, 8],
  ] as const) {
    set(column, row, 'ledge');
  }
});

export const mossyCavern2TileMap = defineTileMap2D({
  cellSize: {
    width: MOSSY_CAVERN_2_CONFIG.tileSize,
    height: MOSSY_CAVERN_2_CONFIG.tileSize,
  },
  tileset: mossyCavern2TileSet,
  layers: [
    { id: 'terrain', width: TILE_COLUMNS, height: TILE_ROWS, data: terrainData },
    { id: 'shelves', width: TILE_COLUMNS, height: TILE_ROWS, data: shelfData },
  ],
});

export const MOSSY_CAVERN_2_CAMERA_VIEW = {
  x: 0,
  y: 0,
  width: MOSSY_CAVERN_2_CONFIG.logicalWidth,
  height: MOSSY_CAVERN_2_CONFIG.logicalHeight,
} as const;

export const MOSSY_CAVERN_2_WORLD_BOUNDS = {
  x: 0,
  y: 0,
  width: MOSSY_CAVERN_2_CONFIG.worldWidth,
  height: MOSSY_CAVERN_2_CONFIG.worldHeight,
} as const;

type Facing = 'left' | 'right';
type PlayerPose = 'idle' | 'walk' | 'jump' | 'dash';
type SlimeHue = 'green' | 'orange';

export interface MossyCavern2PlayerSnapshot {
  readonly body: Aabb2D;
  readonly velocity: { readonly x: number; readonly y: number };
  readonly onGround: boolean;
  readonly facing: Facing;
  readonly pose: PlayerPose;
  readonly dashRemaining: number;
  readonly invulnerableRemaining: number;
}

export interface MossyCavern2SlimeSnapshot {
  readonly id: string;
  readonly body: Aabb2D;
  readonly hue: SlimeHue;
  readonly facing: Facing;
  readonly alive: boolean;
}

export interface MossyCavern2RelicSnapshot {
  readonly id: string;
  readonly body: Aabb2D;
  readonly collected: boolean;
}

export interface MossyCavern2Snapshot {
  readonly player: MossyCavern2PlayerSnapshot;
  readonly slimes: readonly MossyCavern2SlimeSnapshot[];
  readonly greenSlimes: readonly MossyCavern2SlimeSnapshot[];
  readonly orangeSlimes: readonly MossyCavern2SlimeSnapshot[];
  readonly relics: readonly MossyCavern2RelicSnapshot[];
  readonly relicCount: number;
  readonly checkpointIndex: number;
  readonly elapsedSeconds: number;
  readonly status: 'exploring' | 'complete';
  readonly camera: Camera2D;
  /** Tells the GameView-owned binding to cut after a respawn. */
  readonly cameraCut: boolean;
}

interface PlayerState extends MossyCavern2PlayerSnapshot {
  readonly coyoteRemaining: number;
  readonly dashCooldownRemaining: number;
}

interface SlimeState extends MossyCavern2SlimeSnapshot {
  readonly patrol: { readonly minX: number; readonly maxX: number; readonly speed: number };
}

type RelicState = MossyCavern2RelicSnapshot;

interface Checkpoint {
  readonly id: string;
  readonly index: number;
  readonly trigger: Aabb2D;
  readonly spawn: { readonly x: number; readonly y: number };
}

interface CameraShakeState {
  readonly seed: number;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly amplitude: number;
}

interface MossyCavern2State {
  readonly player: PlayerState;
  readonly slimes: readonly SlimeState[];
  readonly relics: readonly RelicState[];
  readonly checkpointIndex: number;
  readonly elapsedSeconds: number;
  readonly status: 'exploring' | 'complete';
  readonly cameraBase: Camera2D;
  readonly camera: Camera2D;
  readonly shake: CameraShakeState | undefined;
  readonly cameraCut: boolean;
}

const RELIC_STARTS: readonly RelicState[] = [
  { id: 'dew-relic', body: { x: 176, y: 900, width: 24, height: 34 }, collected: false },
  { id: 'fern-relic', body: { x: 1_430, y: 900, width: 24, height: 34 }, collected: false },
  { id: 'moon-relic', body: { x: 2_930, y: 900, width: 24, height: 34 }, collected: false },
];

const SLIME_STARTS: readonly SlimeState[] = [
  {
    id: 'root-slime',
    body: { x: 238, y: 924, width: 38, height: 36 },
    hue: 'green',
    facing: 'left',
    alive: true,
    patrol: { minX: 226, maxX: 276, speed: 22 },
  },
  {
    id: 'amber-slime',
    body: { x: 818, y: 924, width: 38, height: 36 },
    hue: 'orange',
    facing: 'right',
    alive: true,
    patrol: { minX: 774, maxX: 866, speed: 30 },
  },
  {
    id: 'ledge-slime',
    body: { x: 1_638, y: 924, width: 38, height: 36 },
    hue: 'green',
    facing: 'left',
    alive: true,
    patrol: { minX: 1_594, maxX: 1_688, speed: 34 },
  },
  {
    id: 'shrine-slime',
    body: { x: 3_314, y: 924, width: 38, height: 36 },
    hue: 'orange',
    facing: 'right',
    alive: true,
    patrol: { minX: 3_264, maxX: 3_356, speed: 38 },
  },
];

const CHECKPOINTS: readonly Checkpoint[] = [
  {
    id: 'entrance',
    index: 0,
    trigger: { x: 88, y: 850, width: 54, height: 110 },
    spawn: MOSSY_CAVERN_2_CONFIG.spawn,
  },
  {
    id: 'moss-bridge',
    index: 1,
    trigger: { x: 1_160, y: 850, width: 48, height: 110 },
    spawn: { x: 1_124, y: 910 },
  },
  {
    id: 'rootwell',
    index: 2,
    trigger: { x: 2_450, y: 850, width: 48, height: 110 },
    spawn: { x: 2_418, y: 910 },
  },
];

const HAZARDS: readonly Aabb2D[] = [
  { x: 696, y: 936, width: 72, height: 24 },
  { x: 1_882, y: 936, width: 84, height: 24 },
  { x: 2_718, y: 936, width: 76, height: 24 },
];

export const mossyCavern2Events = defineGameEvents({
  jump: gameEvent<{ readonly position: { readonly x: number; readonly y: number } }>(),
  dash: gameEvent<{ readonly position: { readonly x: number; readonly y: number }; readonly facing: Facing }>(),
  'slime-cleared': gameEvent<{ readonly id: string; readonly position: { readonly x: number; readonly y: number } }>(),
  'relic-collected': gameEvent<{
    readonly id: string;
    readonly collected: number;
    readonly position: { readonly x: number; readonly y: number };
  }>(),
  checkpoint: gameEvent<{ readonly id: string; readonly index: number; readonly position: { readonly x: number; readonly y: number } }>(),
  damage: gameEvent<{ readonly cause: 'slime' | 'poison'; readonly position: { readonly x: number; readonly y: number } }>(),
  complete: gameEvent<{ readonly elapsedSeconds: number; readonly relics: number }>(),
});

function createPlayer(spawn: { readonly x: number; readonly y: number }): PlayerState {
  return {
    body: {
      x: spawn.x,
      y: spawn.y,
      width: MOSSY_CAVERN_2_CONFIG.playerWidth,
      height: MOSSY_CAVERN_2_CONFIG.playerHeight,
    },
    velocity: { x: 0, y: 0 },
    onGround: true,
    facing: 'right',
    pose: 'idle',
    dashRemaining: 0,
    dashCooldownRemaining: 0,
    invulnerableRemaining: 0.65,
    coyoteRemaining: 0.1,
  };
}

function initialCamera(): Camera2D {
  return clampCameraBounds2D(
    createCamera2D({
      center: {
        x: MOSSY_CAVERN_2_CONFIG.logicalWidth / 2,
        y: MOSSY_CAVERN_2_CONFIG.logicalHeight / 2,
      },
    }),
    MOSSY_CAVERN_2_WORLD_BOUNDS,
    MOSSY_CAVERN_2_CAMERA_VIEW,
  );
}

/**
 * T20F-R3: the authored spawn point for one checkpoint index (clamped to the
 * authored range). Single source of truth for hydration and tests.
 */
export function mossyCavern2CheckpointSpawn(checkpointIndex: number): { readonly x: number; readonly y: number } {
  const last = CHECKPOINTS.length - 1;
  const index = Math.min(Math.max(Math.trunc(checkpointIndex), 0), last);
  return currentSpawn(index);
}

function createState(profile?: MossyCavern2Profile): MossyCavern2State {
  const camera = initialCamera();
  // T20F-R3: hydrate the run from the validated profile projection — the
  // checkpoint index seeds the respawn point. The aggregate relic count is
  // intentionally lossy, so relic entities respawn fresh (same semantics as
  // the checkpoint respawn itself).
  const checkpointIndex =
    profile !== undefined && Number.isSafeInteger(profile.checkpointsReached)
      ? Math.min(Math.max(profile.checkpointsReached, 0), CHECKPOINTS.length - 1)
      : 0;
  return {
    player: createPlayer(mossyCavern2CheckpointSpawn(checkpointIndex)),
    slimes: SLIME_STARTS.map((slime) => ({
      ...slime,
      body: { ...slime.body },
      patrol: { ...slime.patrol },
    })),
    relics: RELIC_STARTS.map((relic) => ({ ...relic, body: { ...relic.body } })),
    checkpointIndex,
    elapsedSeconds: 0,
    status: 'exploring',
    cameraBase: camera,
    camera,
    shake: undefined,
    cameraCut: false,
  };
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
}

function centerOf(body: Aabb2D): { readonly x: number; readonly y: number } {
  return { x: body.x + body.width / 2, y: body.y + body.height / 2 };
}

function updateSlime(slime: SlimeState, deltaSeconds: number): SlimeState {
  if (!slime.alive) return slime;
  const direction = slime.facing === 'right' ? 1 : -1;
  let nextX = slime.body.x + direction * slime.patrol.speed * deltaSeconds;
  let facing = slime.facing;
  if (nextX <= slime.patrol.minX) {
    nextX = slime.patrol.minX;
    facing = 'right';
  } else if (nextX >= slime.patrol.maxX) {
    nextX = slime.patrol.maxX;
    facing = 'left';
  }
  return { ...slime, body: { ...slime.body, x: nextX }, facing };
}

function updateShake(
  shake: CameraShakeState | undefined,
  deltaSeconds: number,
): CameraShakeState | undefined {
  if (shake === undefined) return undefined;
  const elapsedSeconds = shake.elapsedSeconds + deltaSeconds;
  return elapsedSeconds >= shake.durationSeconds ? undefined : { ...shake, elapsedSeconds };
}

function shakeFrom(tick: number, amplitude: number, durationSeconds: number): CameraShakeState {
  return {
    seed: tick * 7_919 + Math.round(amplitude * 101),
    elapsedSeconds: 0,
    durationSeconds,
    amplitude,
  };
}

function updateCamera(
  base: Camera2D,
  player: PlayerState,
  shake: CameraShakeState | undefined,
  deltaSeconds: number,
): { readonly cameraBase: Camera2D; readonly camera: Camera2D } {
  const followed = followCamera2D(
    base,
    centerOf(player.body),
    {
      deadZone: { x: -58, y: -102, width: 116, height: 204 },
      dampingHalfLifeSeconds: 0.11,
    },
    deltaSeconds,
  );
  const cameraBase = clampCameraBounds2D(
    followed,
    MOSSY_CAVERN_2_WORLD_BOUNDS,
    MOSSY_CAVERN_2_CAMERA_VIEW,
  );
  const sampledCamera =
    shake === undefined
      ? cameraBase
      : sampleCameraShake2D(cameraBase, {
          seed: shake.seed,
          elapsedSeconds: shake.elapsedSeconds,
          durationSeconds: shake.durationSeconds,
          amplitude: shake.amplitude,
          frequency: 30,
        });
  // A shake is presentation feedback, not permission for the camera to show
  // outside the authored finite world. Keep the same camera bounds contract
  // at the edge of the cavern as in normal follow movement.
  const camera = clampCameraBounds2D(
    sampledCamera,
    MOSSY_CAVERN_2_WORLD_BOUNDS,
    MOSSY_CAVERN_2_CAMERA_VIEW,
  );
  return { cameraBase, camera };
}

function playerPose(player: Pick<PlayerState, 'dashRemaining' | 'onGround' | 'velocity'>): PlayerPose {
  if (player.dashRemaining > 0) return 'dash';
  if (!player.onGround) return 'jump';
  return Math.abs(player.velocity.x) > 18 ? 'walk' : 'idle';
}

function currentSpawn(checkpointIndex: number): { readonly x: number; readonly y: number } {
  return CHECKPOINTS[checkpointIndex]?.spawn ?? MOSSY_CAVERN_2_CONFIG.spawn;
}

function snapshot(state: MossyCavern2State): MossyCavern2Snapshot {
  const slimes = state.slimes.map(({ patrol: _patrol, ...slime }) => slime);
  const greenSlimes = slimes.filter((slime) => slime.hue === 'green');
  const orangeSlimes = slimes.filter((slime) => slime.hue === 'orange');
  return {
    player: state.player,
    slimes,
    greenSlimes,
    orangeSlimes,
    relics: state.relics,
    relicCount: state.relics.filter((relic) => relic.collected).length,
    checkpointIndex: state.checkpointIndex,
    elapsedSeconds: state.elapsedSeconds,
    status: state.status,
    camera: state.camera,
    cameraCut: state.cameraCut,
  };
}

/** T20F-R3: build the definition for one session generation (see createState). */
export function createMossyCavern2Definition(profile?: MossyCavern2Profile) {
  return defineGame({
    viewport: {
    logicalSize: {
      width: MOSSY_CAVERN_2_CONFIG.logicalWidth,
      height: MOSSY_CAVERN_2_CONFIG.logicalHeight,
    },
    mode: 'fit',
  },
  assets: mossyCavern2Assets,
  input: {
    left: { type: 'button', description: 'Walk left' },
    right: { type: 'button', description: 'Walk right' },
    jump: { type: 'button', description: 'Jump' },
    dash: { type: 'button', description: 'Dash through slimes' },
  },
  events: mossyCavern2Events,
  scenes: {
    expedition: defineScene({
      actions: ['left', 'right', 'jump', 'dash'],
      emits: [
        'jump',
        'dash',
        'slime-cleared',
        'relic-collected',
        'checkpoint',
        'damage',
        'complete',
      ],
      events: mossyCavern2Events,
      create: () => createState(profile),
      update: ({ state, input, deltaSeconds, tick, events }): MossyCavern2State => {
        if (state.status === 'complete') return state;

        const left = input.button('left');
        const right = input.button('right');
        const jump = input.button('jump');
        const dash = input.button('dash');
        const axis = right.held === left.held ? 0 : right.held ? 1 : -1;
        const elapsedSeconds = state.elapsedSeconds + deltaSeconds;

        let facing: Facing = axis === 0 ? state.player.facing : axis > 0 ? 'right' : 'left';
        let dashRemaining = Math.max(0, state.player.dashRemaining - deltaSeconds);
        let dashCooldownRemaining = Math.max(0, state.player.dashCooldownRemaining - deltaSeconds);
        let invulnerableRemaining = Math.max(0, state.player.invulnerableRemaining - deltaSeconds);
        let coyoteRemaining = state.player.onGround
          ? 0.1
          : Math.max(0, state.player.coyoteRemaining - deltaSeconds);
        let velocity = { ...state.player.velocity };
        let shake = updateShake(state.shake, deltaSeconds);

        if (jump.pressed && coyoteRemaining > 0 && dashRemaining <= 0) {
          velocity = { ...velocity, y: MOSSY_CAVERN_2_CONFIG.jumpVelocity };
          coyoteRemaining = 0;
          events.emit('jump', { position: centerOf(state.player.body) });
        }

        if (dash.pressed && dashCooldownRemaining <= 0) {
          dashRemaining = MOSSY_CAVERN_2_CONFIG.dashDuration;
          dashCooldownRemaining = MOSSY_CAVERN_2_CONFIG.dashCooldown;
          velocity = {
            x: (facing === 'right' ? 1 : -1) * MOSSY_CAVERN_2_CONFIG.dashSpeed,
            y: 0,
          };
          shake = shakeFrom(tick, 4.5, 0.16);
          events.emit('dash', { position: centerOf(state.player.body), facing });
        }

        if (dashRemaining > 0) {
          velocity = {
            x: (facing === 'right' ? 1 : -1) * MOSSY_CAVERN_2_CONFIG.dashSpeed,
            y: 0,
          };
        } else {
          velocity = {
            x: approach(
              velocity.x,
              axis * MOSSY_CAVERN_2_CONFIG.runSpeed,
              MOSSY_CAVERN_2_CONFIG.runAcceleration * deltaSeconds,
            ),
            y: Math.min(
              MOSSY_CAVERN_2_CONFIG.maxFallSpeed,
              velocity.y + MOSSY_CAVERN_2_CONFIG.gravity * deltaSeconds,
            ),
          };
        }

        const movement = movePlatformerBody2D({
          body: state.player.body,
          velocity,
          deltaSeconds,
          map: mossyCavern2TileMap,
          collisionLayers: ['terrain', 'shelves'],
          floorSnapDistance: 5,
        });
        const onGround = movement.contacts.floor !== undefined;
        let player: PlayerState = {
          ...state.player,
          body: movement.body,
          velocity: movement.velocity,
          onGround,
          facing,
          dashRemaining,
          dashCooldownRemaining,
          invulnerableRemaining,
          coyoteRemaining: onGround ? 0.1 : coyoteRemaining,
          pose: 'idle',
        };
        player = { ...player, pose: playerPose(player) };

        let slimes = state.slimes.map((slime) => updateSlime(slime, deltaSeconds));
        let relics = state.relics;
        let checkpointIndex = state.checkpointIndex;
        let cameraCut = false;

        for (const relic of relics) {
          if (!relic.collected && intersectsAabbAabb2D(player.body, relic.body)) {
            relics = relics.map((candidate) =>
              candidate.id === relic.id ? { ...candidate, collected: true } : candidate,
            );
            const collected = relics.filter((candidate) => candidate.collected).length;
            shake = shakeFrom(tick + collected, 3.2, 0.18);
            events.emit('relic-collected', {
              id: relic.id,
              collected,
              position: centerOf(relic.body),
            });
          }
        }

        for (const checkpoint of CHECKPOINTS) {
          if (
            checkpoint.index > checkpointIndex &&
            intersectsAabbAabb2D(player.body, checkpoint.trigger)
          ) {
            checkpointIndex = checkpoint.index;
            events.emit('checkpoint', {
              id: checkpoint.id,
              index: checkpoint.index,
              position: centerOf(checkpoint.trigger),
            });
          }
        }

        let damageCause: 'slime' | 'poison' | undefined;
        for (const slime of slimes) {
          if (!slime.alive || !intersectsAabbAabb2D(player.body, slime.body)) continue;
          if (player.dashRemaining > 0) {
            slimes = slimes.map((candidate) =>
              candidate.id === slime.id ? { ...candidate, alive: false } : candidate,
            );
            shake = shakeFrom(tick + 31, 6, 0.2);
            events.emit('slime-cleared', { id: slime.id, position: centerOf(slime.body) });
          } else if (player.invulnerableRemaining <= 0) {
            damageCause = 'slime';
          }
        }
        if (damageCause === undefined && player.invulnerableRemaining <= 0) {
          if (HAZARDS.some((hazard) => intersectsAabbAabb2D(player.body, hazard))) {
            damageCause = 'poison';
          }
        }

        if (damageCause !== undefined) {
          const position = centerOf(player.body);
          player = createPlayer(currentSpawn(checkpointIndex));
          player = { ...player, invulnerableRemaining: 0.75 };
          shake = shakeFrom(tick + 97, 7, 0.24);
          cameraCut = true;
          events.emit('damage', { cause: damageCause, position });
        }

        const relicCount = relics.filter((relic) => relic.collected).length;
        const completed =
          relicCount === relics.length &&
          player.body.x + player.body.width >= MOSSY_CAVERN_2_CONFIG.gateX;
        if (completed) {
          shake = shakeFrom(tick + 193, 8, 0.42);
          events.emit('complete', { elapsedSeconds, relics: relicCount });
        }

        const cameraState = updateCamera(state.cameraBase, player, shake, deltaSeconds);
        return {
          player,
          slimes,
          relics,
          checkpointIndex,
          elapsedSeconds,
          status: completed ? 'complete' : 'exploring',
          cameraBase: cameraState.cameraBase,
          camera: cameraState.camera,
          shake,
          cameraCut,
        };
      },
      snapshot: ({ state }): MossyCavern2Snapshot => snapshot(state),
    }),
  },
  initialScene: 'expedition',
  });
}

export const mossyCavern2Definition = createMossyCavern2Definition();

export type MossyCavern2Definition = ReturnType<typeof createMossyCavern2Definition>;
export type MossyCavern2Session = GameSession<
  MossyCavern2Definition['scenes'],
  MossyCavern2Definition['input'],
  typeof mossyCavern2Events
>;

/** Create one session, hydrating from a prepared profile when provided (T20F-R3). */
export function createMossyCavern2Session(profile?: MossyCavern2Profile): MossyCavern2Session {
  return createGameSession(createMossyCavern2Definition(profile));
}

// Retain the authored hazard positions as a renderer-facing constant without
// making the simulation read React state or a render-only structure.
export const mossyCavern2Hazards = HAZARDS;
