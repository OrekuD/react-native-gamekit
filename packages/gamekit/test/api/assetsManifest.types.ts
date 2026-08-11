/**
 * Compile-time fixture: `defineAssets` manifest (Example 1).
 *
 * Type-checked by `pnpm typecheck` and must compile once the asset contract
 * lands (T7.2). It documents the accepted authoring surface:
 *
 * - groups of named assets; `image(...)` and `spriteSheet(...)` descriptors;
 * - static `require(...)` module handles only — a string/URL source is
 *   rejected (see `assetContractFailures.types.ts`);
 * - group, asset, frame, and clip names preserved as string literals;
 * - the returned manifest is deeply readonly.
 *
 * This file never executes; it imports only the headless root entry.
 */
import {
  defineAssets,
  image,
  spriteSheet,
  type GameAssetManifest,
  type ImageDescriptor,
  type SpriteSheetDescriptor,
} from '../../src/index';

// The static module handle is the number returned by `require(...)` in
// React Native (`image(require('./assets/logo.png'))`). This file is
// type-checked only, so the handles are plain numeric constants.
const logo = 42;
const playerSheet = 43;
const enemiesSheet = 44;

export const gameAssets = defineAssets({
  boot: {
    logo: image(logo),
  },
  gameplay: {
    player: spriteSheet(playerSheet, {
      frames: {
        'idle-0': { x: 0, y: 0, width: 32, height: 32 },
        'idle-1': { x: 32, y: 0, width: 32, height: 32 },
        'run-0': { x: 0, y: 32, width: 32, height: 32 },
        'run-1': { x: 32, y: 32, width: 32, height: 32 },
      },
      animations: {
        idle: {
          frames: ['idle-0', 'idle-1'],
          frameDurationMs: 140,
          mode: 'loop',
        },
        run: {
          frames: ['run-0', 'run-1'],
          frameDurationMs: 80,
          mode: 'loop',
        },
        jump: {
          frames: ['run-1'],
          frameDurationMs: 120,
          mode: 'once',
        },
      },
    }),
    enemies: spriteSheet(enemiesSheet, {
      frames: {
        'enemy-0': { x: 0, y: 0, width: 16, height: 16 },
        'enemy-1': { x: 16, y: 0, width: 16, height: 16 },
      },
      animations: {
        wander: {
          frames: ['enemy-0', 'enemy-1'],
          frameDurationMs: 200,
          mode: 'loop',
        },
      },
    }),
  },
});

// The manifest is a typed record of groups -> named descriptors.
gameAssets satisfies GameAssetManifest<typeof gameAssets>;
gameAssets satisfies Readonly<Record<string, Readonly<Record<string, ImageDescriptor | SpriteSheetDescriptor>>>>;

// Group names are inferred as string literals.
type GroupNames = keyof typeof gameAssets;
const bootGroup: GroupNames = 'boot';
const gameplayGroup: GroupNames = 'gameplay';
void bootGroup;
void gameplayGroup;

// Asset names are inferred as string literals.
type GameplayAssets = keyof (typeof gameAssets)['gameplay'];
const playerAsset: GameplayAssets = 'player';
const enemiesAsset: GameplayAssets = 'enemies';
void playerAsset;
void enemiesAsset;

// Frame names are inferred as string literals.
type PlayerFrames = keyof (typeof gameAssets)['gameplay']['player']['frames'];
const idle0: PlayerFrames = 'idle-0';
const run1: PlayerFrames = 'run-1';
void idle0;
void run1;

// Clip names are inferred as string literals.
type PlayerClips = keyof (typeof gameAssets)['gameplay']['player']['animations'];
const idleClip: PlayerClips = 'idle';
const runClip: PlayerClips = 'run';
void idleClip;
void runClip;

// The descriptor carries its typed frame and clip tables.
const player = gameAssets.gameplay.player satisfies SpriteSheetDescriptor;
const logoAsset = gameAssets.boot.logo satisfies ImageDescriptor;
void player;
void logoAsset;

// A second manifest is a distinct type: its descriptors cannot be passed to
// this manifest's loaded assets (asserted in `assetContractFailures`).
export const otherAssets = defineAssets({
  elsewhere: {
    logo: image(logo),
  },
});
