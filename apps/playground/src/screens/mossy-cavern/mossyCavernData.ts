/**
 * Mossy Cavern's authored data contracts: world geometry, assets, save data,
 * events, and the public render snapshot. The fixed-step scene lives in the
 * neighboring game module so this file remains declarative and auditable.
 */
import type { Aabb2D } from 'rn-gamekit/geometry';
import type { Camera2D } from 'rn-gamekit/camera2d';
import { defineAssets, image, spriteSheet } from 'rn-gamekit/assets';
import { defineGameEvents, gameEvent } from 'rn-gamekit/events';
import { createGameSaveStore, createGameStorageAdapter, defineGameSave } from 'rn-gamekit/storage';
import { defineTileMap2D, defineTileSet2D } from 'rn-gamekit/tilemap';

export const MOSSY_CAVERN_CONFIG = {
  logicalWidth: 360,
  logicalHeight: 640,
  cellSize: 64,
  mapColumns: 90,
  mapRows: 14,
  gravity: 1900,
  moveSpeed: 240,
  jumpVelocity: -820,
  dashSpeed: 520,
  dashDurationSeconds: 0.14,
  dashCooldownSeconds: 0.58,
  coyoteSeconds: 0.1,
  jumpBufferSeconds: 0.12,
  invulnerabilitySeconds: 1,
  floorSnapDistance: 5,
  maxHealth: 3,
  checkpoints: [24, 47, 70, 85],
  finishColumn: 87,
  cameraDeadZone: { x: -90, y: -150, width: 180, height: 300 },
  cameraShakeDurationSeconds: 0.22,
} as const;

const C = MOSSY_CAVERN_CONFIG.cellSize;
const PLAYER_WIDTH = 38;
const PLAYER_HEIGHT = 58;
const GROUND_TOP = (MOSSY_CAVERN_CONFIG.mapRows - 2) * C;

export const MOSSY_CAVERN_WORLD: Aabb2D = {
  x: 0,
  y: 0,
  width: MOSSY_CAVERN_CONFIG.mapColumns * C,
  height: MOSSY_CAVERN_CONFIG.mapRows * C,
};

export const MOSSY_CAVERN_VIEW: Aabb2D = {
  x: 0,
  y: 0,
  width: MOSSY_CAVERN_CONFIG.logicalWidth,
  height: MOSSY_CAVERN_CONFIG.logicalHeight,
};

export const MOSSY_CAVERN_SPAWN: Aabb2D = {
  x: 3 * C + 13,
  y: GROUND_TOP - PLAYER_HEIGHT,
  width: PLAYER_WIDTH,
  height: PLAYER_HEIGHT,
};

type FrameRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

function gridFrames(
  prefix: string,
  count: number,
  columns: number,
  width: number,
  height: number,
): Record<string, FrameRect> {
  const frames: Record<string, FrameRect> = {};
  for (let index = 0; index < count; index += 1) {
    frames[`${prefix}-${String(index).padStart(2, '0')}`] = {
      x: (index % columns) * width,
      y: Math.floor(index / columns) * height,
      width,
      height,
    };
  }
  return frames;
}

function frameNames(frames: Record<string, FrameRect>): string[] {
  return Object.keys(frames);
}

const playerIdleFrames = gridFrames('idle', 20, 5, 96, 96);
const playerWalkFrames = gridFrames('walk', 20, 5, 96, 96);
const playerJumpFrames = gridFrames('jump', 8, 4, 96, 96);
const playerDashFrames = gridFrames('dash', 16, 4, 96, 96);
const greenSlimeFrames = gridFrames('green', 30, 5, 96, 66);
const orangeSlimeFrames = gridFrames('orange', 30, 5, 96, 77);
const vineFrames = gridFrames('vine', 10, 5, 96, 96);
const poisonFrames = gridFrames('poison', 10, 5, 96, 96);

function loopingClip(frames: Record<string, FrameRect>, frameDurationMs: number) {
  return {
    frames: frameNames(frames),
    frameDurationMs,
    mode: 'loop' as const,
  };
}

/** All image/sprite-sheet descriptors use Metro's static require boundary. */
export const mossyCavernAssets = defineAssets({
  world: {
    tiles: spriteSheet(require('../../../assets/mossy-cavern/mossy-tiles.png'), {
      frames: {
        ground: { x: 0, y: 0, width: C, height: C },
        decor: { x: C, y: 0, width: C, height: C },
        wall: { x: C * 2, y: 0, width: C, height: C },
        platform: { x: C * 3, y: 0, width: C, height: C },
      },
      animations: {
        still: { frames: ['ground'], frameDurationMs: 1000, mode: 'loop' },
      },
    }),
    hill: image(require('../../../assets/mossy-cavern/mossy-hill.png')),
    playerIdle: spriteSheet(require('../../../assets/mossy-cavern/player-idle.png'), {
      frames: playerIdleFrames,
      animations: { play: loopingClip(playerIdleFrames, 100) },
    }),
    playerWalk: spriteSheet(require('../../../assets/mossy-cavern/player-walk.png'), {
      frames: playerWalkFrames,
      animations: { play: loopingClip(playerWalkFrames, 72) },
    }),
    playerJump: spriteSheet(require('../../../assets/mossy-cavern/player-jump.png'), {
      frames: playerJumpFrames,
      animations: { play: loopingClip(playerJumpFrames, 110) },
    }),
    playerDash: spriteSheet(require('../../../assets/mossy-cavern/player-dash.png'), {
      frames: playerDashFrames,
      animations: { play: loopingClip(playerDashFrames, 55) },
    }),
    slimeGreen: spriteSheet(require('../../../assets/mossy-cavern/slime-green.png'), {
      frames: greenSlimeFrames,
      animations: { bounce: loopingClip(greenSlimeFrames, 90) },
    }),
    slimeOrange: spriteSheet(require('../../../assets/mossy-cavern/slime-orange.png'), {
      frames: orangeSlimeFrames,
      animations: { bounce: loopingClip(orangeSlimeFrames, 105) },
    }),
    plantVine: spriteSheet(require('../../../assets/mossy-cavern/plant-vine.png'), {
      frames: vineFrames,
      animations: { sway: loopingClip(vineFrames, 130) },
    }),
    plantPoison: spriteSheet(require('../../../assets/mossy-cavern/plant-poison.png'), {
      frames: poisonFrames,
      animations: { sway: loopingClip(poisonFrames, 150) },
    }),
  },
});

// The foreground uses four cropped regions from the supplied Mossy tile atlas.
// A non-collidable decor layer lets the same tile renderer carry atmosphere.
export const mossyCavernTileset = defineTileSet2D({
  tiles: {
    ground: { frame: 'ground', collision: 'solid' },
    platform: { frame: 'platform', collision: 'one-way-up' },
    wall: { frame: 'wall', collision: 'solid' },
    decor: { frame: 'decor' },
  },
});

function buildTerrain(): number[] {
  const width = MOSSY_CAVERN_CONFIG.mapColumns;
  const height = MOSSY_CAVERN_CONFIG.mapRows;
  const data = new Array<number>(width * height).fill(0);
  const set = (x: number, y: number, id: number): void => {
    if (x >= 0 && x < width && y >= 0 && y < height) data[y * width + x] = id;
  };
  const gaps = [
    { min: 17, max: 22 },
    { min: 38, max: 41 },
    { min: 63, max: 66 },
    { min: 78, max: 81 },
  ];
  for (let x = 0; x < width; x += 1) {
    const gap = gaps.some((span) => x >= span.min && x <= span.max);
    if (!gap) {
      set(x, height - 2, 1);
      set(x, height - 1, 1);
    }
  }
  // Moss bridges make the long gaps fair while preserving the need to jump.
  // Their top is 128 units above the floor, inside the configured jump arc.
  for (let x = 15; x <= 24; x += 1) set(x, height - 4, 2);
  for (let x = 36; x <= 43; x += 1) set(x, height - 4, 2);
  for (let x = 61; x <= 68; x += 1) set(x, height - 4, 2);
  for (let x = 76; x <= 83; x += 1) set(x, height - 4, 2);
  // Optional high ledges reward the dash route and stage the crystal trail.
  for (let x = 26; x <= 30; x += 1) set(x, height - 7, 2);
  for (let x = 48; x <= 53; x += 1) set(x, height - 8, 2);
  for (let x = 57; x <= 60; x += 1) set(x, height - 6, 2);
  for (let x = 70; x <= 74; x += 1) set(x, height - 8, 2);
  return data;
}

function buildDecor(): number[] {
  const width = MOSSY_CAVERN_CONFIG.mapColumns;
  const height = MOSSY_CAVERN_CONFIG.mapRows;
  const data = new Array<number>(width * height).fill(0);
  const decorations = [
    [5, 4], [11, 2], [18, 3], [24, 5], [33, 2], [40, 4], [46, 3],
    [54, 2], [62, 4], [69, 3], [77, 2], [84, 4],
  ] as const;
  for (const [x, y] of decorations) data[y * width + x] = 4;
  return data;
}

export const mossyCavernLevel = defineTileMap2D({
  cellSize: { width: C, height: C },
  origin: { x: 0, y: 0 },
  tileset: mossyCavernTileset,
  layers: [
    {
      id: 'terrain',
      width: MOSSY_CAVERN_CONFIG.mapColumns,
      height: MOSSY_CAVERN_CONFIG.mapRows,
      data: buildTerrain(),
    },
    {
      id: 'decor',
      width: MOSSY_CAVERN_CONFIG.mapColumns,
      height: MOSSY_CAVERN_CONFIG.mapRows,
      collidable: false,
      data: buildDecor(),
    },
  ],
});

export interface MossyCavernSave {
  readonly checkpointIndex: number;
  readonly score: number;
  readonly crystals: number;
  readonly falls: number;
  readonly bestTimeSeconds: number;
}

export function validateMossySave(value: unknown): MossyCavernSave {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Mossy Cavern save must be an object');
  }
  const record = value as Record<string, unknown>;
  const integer = (key: string, minimum: number): number => {
    const candidate = record[key];
    if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < minimum) {
      throw new Error(`${key} must be an integer >= ${String(minimum)}`);
    }
    return candidate;
  };
  const finite = (key: string): number => {
    const candidate = record[key];
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
      throw new Error(`${key} must be a finite number >= 0`);
    }
    return candidate;
  };
  return {
    checkpointIndex: integer('checkpointIndex', -1),
    score: integer('score', 0),
    crystals: integer('crystals', 0),
    falls: integer('falls', 0),
    bestTimeSeconds: finite('bestTimeSeconds'),
  };
}

export const mossyCavernSaveSchema = defineGameSave<MossyCavernSave>({
  id: 'com.oreku.mossy-cavern.save',
  version: 1,
  createDefault: () => ({
    checkpointIndex: -1,
    score: 0,
    crystals: 0,
    falls: 0,
    bestTimeSeconds: 0,
  }),
  validate: validateMossySave,
  migrations: {},
});

/**
 * T20G-R2: narrow the slot's `startupSave` metadata into a validated durable
 * projection for the content layer. Anything that fails validation (or a
 * missing record) recovers through the content-side load.
 */
export function readStartupMossyCavernSave(startupSave: unknown): MossyCavernSave | null {
  if (startupSave === undefined || startupSave === null) return null;
  try {
    return validateMossySave(startupSave);
  } catch {
    return null;
  }
}

/**
 * T20F-R3: load and validate the persisted projection for session hydration.
 * Fail-open by contract: no storage, a missing save, an abort, or an I/O
 * error yields `undefined` and the shell constructs a fresh run.
 * T20G-R3: the one-shot store is always disposed — an aborted signal never
 * constructs one at all.
 */
export async function loadMossyCavernSave(signal?: AbortSignal): Promise<MossyCavernSave | undefined> {
  if (signal?.aborted) return undefined;
  const store = createGameSaveStore({
    schema: mossyCavernSaveSchema,
    adapter: createGameStorageAdapter(),
    namespace: 'mossy-cavern',
  });
  try {
    const result = await store.load('profile');
    if (signal?.aborted) return undefined;
    return result.status === 'default' ? undefined : result.data;
  } catch {
    return undefined;
  } finally {
    store.dispose();
  }
}

export type PlayerPose = 'idle' | 'walk' | 'jump' | 'dash';
export type EnemyKind = 'green' | 'orange';
export type PlantKind = 'vine' | 'poison';

export const mossyCavernEvents = defineGameEvents({
  jump: gameEvent<{ readonly x: number; readonly y: number }>(),
  dash: gameEvent<{ readonly x: number; readonly y: number }>(),
  crystal: gameEvent<{ readonly x: number; readonly y: number; readonly total: number }>(),
  'enemy-defeated': gameEvent<{ readonly x: number; readonly y: number; readonly kind: EnemyKind }>(),
  'player-hit': gameEvent<{
    readonly x: number;
    readonly y: number;
    readonly health: number;
    readonly reason: 'enemy' | 'poison' | 'fall';
  }>(),
  checkpoint: gameEvent<{
    readonly index: number;
    readonly x: number;
    readonly y: number;
    readonly save: MossyCavernSave;
  }>(),
  fall: gameEvent<{ readonly x: number; readonly y: number; readonly falls: number; readonly health: number }>(),
  finish: gameEvent<{
    readonly x: number;
    readonly y: number;
    readonly elapsedSeconds: number;
    readonly falls: number;
    readonly score: number;
    readonly crystals: number;
    readonly save: MossyCavernSave;
  }>(),
  'game-over': gameEvent<{
    readonly x: number;
    readonly y: number;
    readonly falls: number;
    readonly elapsedSeconds: number;
    readonly score: number;
    readonly crystals: number;
  }>(),
});

export interface MossyEnemySnapshot {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly frame: string;
  readonly defeated: boolean;
  readonly facingRight: boolean;
  readonly scale: number;
}

export interface MossyPlantSnapshot {
  readonly id: string;
  readonly kind: PlantKind;
  readonly x: number;
  readonly y: number;
  readonly frame: string;
  readonly scale: number;
  readonly hazard: boolean;
}

export interface MossyCollectibleSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly collected: boolean;
}

export interface MossyCheckpointSnapshot {
  readonly index: number;
  readonly x: number;
  readonly reached: boolean;
}

export interface MossyCavernSnapshot {
  readonly body: Aabb2D;
  readonly onGround: boolean;
  readonly facingRight: boolean;
  readonly pose: PlayerPose;
  readonly playerFrame: string;
  readonly enemies: readonly MossyEnemySnapshot[];
  readonly plants: readonly MossyPlantSnapshot[];
  readonly collectibles: readonly MossyCollectibleSnapshot[];
  readonly checkpoints: readonly MossyCheckpointSnapshot[];
  readonly checkpointIndex: number;
  readonly health: number;
  readonly crystals: number;
  readonly score: number;
  readonly falls: number;
  readonly elapsed: number;
  readonly bestTimeSeconds: number;
  readonly finished: boolean;
  readonly gameOver: boolean;
  readonly spawnCut: boolean;
  readonly ticks: number;
  readonly camera: Camera2D;
}

