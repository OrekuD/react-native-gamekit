/**
 * Sprite Field — the Task 7 reference game definition.
 *
 * A small top-down scene: one controllable animated character (retained
 * `GameSprite`) and a bounded field of repeated enemies (`SpriteBatch`).
 * Animation state is deterministic scene state advanced from fixed-step
 * game time through the headless clip helpers; the renderer only presents
 * it. Gameplay uses only the public package API.
 */
import {
  advanceSpriteAnimation,
  createGameSession,
  defineAssets,
  defineGame,
  defineScene,
  image,
  spriteSheet,
  type GameAssetManifest,
  type GameSession,
  type SpriteAnimationState,
} from 'rn-gamekit';

export const spriteFieldAssets = defineAssets({
  boot: {
    background: image(require('../../../assets/kenney/tiny-farm.png')),
  },
  gameplay: {
    player: spriteSheet(require('../../../assets/kenney/platformer-player.png'), {
      frames: {
        'idle-front': { x: 0, y: 196, width: 66, height: 92 },
        'idle-stand': { x: 67, y: 196, width: 66, height: 92 },
        'run-01': { x: 0, y: 0, width: 72, height: 97 },
        'run-02': { x: 73, y: 0, width: 72, height: 97 },
        'run-03': { x: 146, y: 0, width: 72, height: 97 },
        'run-04': { x: 0, y: 98, width: 72, height: 97 },
        'run-05': { x: 73, y: 98, width: 72, height: 97 },
        'run-06': { x: 146, y: 98, width: 72, height: 97 },
        'run-07': { x: 219, y: 0, width: 72, height: 97 },
        'run-08': { x: 292, y: 0, width: 72, height: 97 },
        'run-09': { x: 219, y: 98, width: 72, height: 97 },
        'run-10': { x: 365, y: 0, width: 72, height: 97 },
        'run-11': { x: 292, y: 98, width: 72, height: 97 },
        jump: { x: 438, y: 93, width: 67, height: 94 },
        duck: { x: 365, y: 98, width: 69, height: 71 },
        hurt: { x: 438, y: 0, width: 69, height: 92 },
      },
      animations: {
        idle: {
          frames: ['idle-front', 'idle-stand'],
          frameDurationMs: 420,
          mode: 'loop',
        },
        walk: {
          frames: [
            'run-01',
            'run-02',
            'run-03',
            'run-04',
            'run-05',
            'run-06',
            'run-07',
            'run-08',
            'run-09',
            'run-10',
            'run-11',
          ],
          frameDurationMs: 75,
          mode: 'loop',
        },
        jump: { frames: ['jump'], frameDurationMs: 500, mode: 'once' },
        duck: { frames: ['duck'], frameDurationMs: 500, mode: 'loop' },
        hurt: { frames: ['hurt'], frameDurationMs: 500, mode: 'once' },
      },
    }),
    enemies: spriteSheet(require('../../../assets/kenney/tiny-farm.png'), {
      frames: {
        sheep: { x: 0, y: 160, width: 16, height: 16 },
        cow: { x: 16, y: 160, width: 16, height: 16 },
        chicken: { x: 32, y: 160, width: 16, height: 16 },
      },
      animations: {
        wander: { frames: ['sheep'], frameDurationMs: 260, mode: 'loop' },
      },
    }),
  },
});

export const SPRITE_FIELD_CONFIG = {
  logicalWidth: 320,
  logicalHeight: 480,
  playerSpeed: 90, // logical units per second
  enemyCount: 24,
  enemyDrift: 14, // logical units per second
  enemySpacing: 56,
} as const;

export interface EnemySnapshot {
  readonly frame: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly visible: boolean;
  readonly animation: SpriteAnimationState<'wander'>;
}

export const PLAYER_ANIMATION_MODES = [
  'auto',
  'idle',
  'walk',
  'jump',
  'duck',
  'hurt',
] as const;

export type PlayerAnimationMode = (typeof PLAYER_ANIMATION_MODES)[number];
export type PlayerAnimationClip = Exclude<PlayerAnimationMode, 'auto'>;

export function nextPlayerAnimationMode(current: PlayerAnimationMode): PlayerAnimationMode {
  const index = PLAYER_ANIMATION_MODES.indexOf(current);
  return PLAYER_ANIMATION_MODES[(index + 1) % PLAYER_ANIMATION_MODES.length] ?? 'auto';
}

export interface PlaySnapshot {
  readonly playerX: number;
  readonly playerY: number;
  readonly facing: 'left' | 'right';
  readonly animationMode: PlayerAnimationMode;
  readonly animation: SpriteAnimationState<PlayerAnimationClip>;
  readonly enemies: readonly EnemySnapshot[];
  readonly score: number;
  readonly elapsed: number;
}

export interface PlayState {
  readonly playerX: number;
  readonly playerY: number;
  readonly facing: 'left' | 'right';
  readonly animationMode: PlayerAnimationMode;
  readonly animation: SpriteAnimationState<PlayerAnimationClip>;
  readonly enemies: readonly EnemySnapshot[];
  readonly score: number;
  readonly elapsed: number;
}

const WORLD_TOP = 24;
const WORLD_BOTTOM = 456;
const WORLD_LEFT = 16;
const WORLD_RIGHT = 304;

function initialEnemies(): readonly EnemySnapshot[] {
  const enemies: EnemySnapshot[] = [];
  const columns = 6;
  const animalFrames = ['sheep', 'cow', 'chicken'] as const;
  for (let index = 0; index < SPRITE_FIELD_CONFIG.enemyCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    enemies.push({
      frame: animalFrames[index % animalFrames.length] ?? 'sheep',
      x: WORLD_LEFT + 24 + column * SPRITE_FIELD_CONFIG.enemySpacing,
      y: WORLD_TOP + 40 + row * 34,
      rotation: 0,
      scale: 2,
      visible: true,
      animation: { clip: 'wander', elapsedMs: 0, paused: false, speed: 1, completed: false },
    });
  }
  return enemies;
}

/** Pick the clip from movement (deterministic scene rule). */
export function selectPlayerClip(
  moving: boolean,
  mode: PlayerAnimationMode,
  previous: SpriteAnimationState<PlayerAnimationClip>,
): SpriteAnimationState<PlayerAnimationClip> {
  const wanted: PlayerAnimationClip = mode === 'auto' ? (moving ? 'walk' : 'idle') : mode;
  return previous.clip === wanted
    ? previous
    : { ...previous, clip: wanted, elapsedMs: 0, completed: false };
}

export const spriteFieldDefinition = defineGame({
  viewport: {
    logicalSize: {
      width: SPRITE_FIELD_CONFIG.logicalWidth,
      height: SPRITE_FIELD_CONFIG.logicalHeight,
    },
    mode: 'fit',
  },
  assets: spriteFieldAssets,
  input: {
    primary: { type: 'pointer', description: 'Move the player toward the pointer' },
    cycleAnimation: { type: 'button', description: 'Show the next player animation' },
  },
  scenes: {
    play: defineScene({
      actions: ['primary', 'cycleAnimation'],
      create: (): PlayState => ({
        playerX: 160,
        playerY: 420,
        facing: 'right',
        animationMode: 'auto',
        animation: { clip: 'idle', elapsedMs: 0, paused: false, speed: 1, completed: false },
        enemies: initialEnemies(),
        score: 0,
        elapsed: 0,
      }),
      update: ({ state, input, deltaSeconds }): PlayState => {
        const pointer = input.pointer('primary');
        const animationMode = input.button('cycleAnimation').pressed
          ? nextPlayerAnimationMode(state.animationMode)
          : state.animationMode;
        let playerX = state.playerX;
        let playerY = state.playerY;
        let moving = false;
        if (pointer.active && pointer.position !== undefined) {
          const dx = pointer.position.x - state.playerX;
          const dy = pointer.position.y - state.playerY;
          const distance = Math.hypot(dx, dy);
          if (distance > 4) {
            moving = true;
            const step = Math.min(SPRITE_FIELD_CONFIG.playerSpeed * deltaSeconds, distance);
            playerX += (dx / distance) * step;
            playerY += (dy / distance) * step;
            playerX = Math.min(WORLD_RIGHT, Math.max(WORLD_LEFT, playerX));
            playerY = Math.min(WORLD_BOTTOM, Math.max(WORLD_TOP, playerY));
          }
        }
        const animation = advanceSpriteAnimation(
          spriteFieldAssets.gameplay.player as never,
          selectPlayerClip(moving, animationMode, state.animation),
          deltaSeconds,
        ) as SpriteAnimationState<PlayerAnimationClip>;
        const facing: 'left' | 'right' =
          pointer.position !== undefined && pointer.position.x < state.playerX - 2
            ? 'left'
            : state.facing;
        const enemies = state.enemies.map((enemy) => {
          const next = advanceSpriteAnimation(
            spriteFieldAssets.gameplay.enemies as never,
            enemy.animation,
            deltaSeconds,
          ) as SpriteAnimationState<'wander'>;
          const drift = Math.sin(state.elapsed * 0.8 + enemy.x * 0.05) * SPRITE_FIELD_CONFIG.enemyDrift;
          return {
            ...enemy,
            x: enemy.x + drift * deltaSeconds * 2,
            animation: next,
          };
        });
        // Score: distance walked (deterministic; no wall-clock reads).
        const score = state.score + (moving ? 1 : 0);
        return {
          playerX,
          playerY,
          facing,
          animationMode,
          animation,
          enemies,
          score,
          elapsed: state.elapsed + deltaSeconds,
        };
      },
      snapshot: (context): PlaySnapshot => ({
        playerX: context.state.playerX,
        playerY: context.state.playerY,
        facing: context.state.facing,
        animationMode: context.state.animationMode,
        animation: { ...context.state.animation },
        enemies: context.state.enemies.map((enemy) => ({ ...enemy, animation: { ...enemy.animation } })),
        score: context.state.score,
        elapsed: context.state.elapsed,
      }),
    }),
  },
  initialScene: 'play',
});

export type SpriteFieldDefinition = typeof spriteFieldDefinition;
export type SpriteFieldSession = GameSession<
  SpriteFieldDefinition['scenes'],
  SpriteFieldDefinition['input']
>;
export type SpriteFieldManifest = GameAssetManifest<typeof spriteFieldAssets>;

export function createSpriteFieldSession(): SpriteFieldSession {
  return createGameSession(spriteFieldDefinition);
}
