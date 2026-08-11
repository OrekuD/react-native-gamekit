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
  startSpriteAnimation,
  type GameAssetManifest,
  type GameSession,
  type SpriteAnimationState,
} from 'react-native-gamekit';

export const spriteFieldAssets = defineAssets({
  boot: {
    background: image(require('../../assets/player.png')),
  },
  gameplay: {
    player: spriteSheet(require('../../assets/player.png'), {
      frames: {
        'idle-0': { x: 0, y: 0, width: 32, height: 32 },
        'idle-1': { x: 32, y: 0, width: 32, height: 32 },
        'run-0': { x: 0, y: 32, width: 32, height: 32 },
        'run-1': { x: 32, y: 32, width: 32, height: 32 },
      },
      animations: {
        idle: { frames: ['idle-0', 'idle-1'], frameDurationMs: 220, mode: 'loop' },
        run: { frames: ['run-0', 'run-1'], frameDurationMs: 110, mode: 'loop' },
      },
    }),
    enemies: spriteSheet(require('../../assets/enemies.png'), {
      frames: {
        'enemy-0': { x: 0, y: 0, width: 16, height: 16 },
        'enemy-1': { x: 16, y: 0, width: 16, height: 16 },
      },
      animations: {
        wander: { frames: ['enemy-0', 'enemy-1'], frameDurationMs: 260, mode: 'loop' },
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

export interface PlaySnapshot {
  readonly playerX: number;
  readonly playerY: number;
  readonly facing: 'left' | 'right';
  readonly animation: SpriteAnimationState<'idle' | 'run'>;
  readonly enemies: readonly EnemySnapshot[];
  readonly score: number;
  readonly elapsed: number;
}

export interface PlayState {
  readonly playerX: number;
  readonly playerY: number;
  readonly facing: 'left' | 'right';
  readonly animation: SpriteAnimationState<'idle' | 'run'>;
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
  for (let index = 0; index < SPRITE_FIELD_CONFIG.enemyCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    enemies.push({
      frame: 'enemy-0',
      x: WORLD_LEFT + 24 + column * SPRITE_FIELD_CONFIG.enemySpacing,
      y: WORLD_TOP + 40 + row * 34,
      rotation: 0,
      scale: 1,
      visible: true,
      animation: { clip: 'wander', elapsedMs: 0, paused: false, speed: 1, completed: false },
    });
  }
  return enemies;
}

/** Pick the clip from movement (deterministic scene rule). */
export function selectPlayerClip(
  moving: boolean,
  previous: SpriteAnimationState<'idle' | 'run'>,
): SpriteAnimationState<'idle' | 'run'> {
  const wanted = moving ? 'run' : 'idle';
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
  },
  scenes: {
    play: defineScene({
      actions: ['primary'],
      create: (): PlayState => ({
        playerX: 160,
        playerY: 420,
        facing: 'right',
        animation: { clip: 'idle', elapsedMs: 0, paused: false, speed: 1, completed: false },
        enemies: initialEnemies(),
        score: 0,
        elapsed: 0,
      }),
      update: ({ state, input, deltaSeconds }): PlayState => {
        const pointer = input.pointer('primary');
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
          selectPlayerClip(moving, state.animation),
          deltaSeconds,
        ) as SpriteAnimationState<'idle' | 'run'>;
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
          const elapsed = next.elapsedMs / 1000;
          const drift = Math.sin(state.elapsed * 0.8 + enemy.x * 0.05) * SPRITE_FIELD_CONFIG.enemyDrift;
          const frame = next.elapsedMs < 130 ? 'enemy-0' : 'enemy-1';
          return {
            ...enemy,
            frame,
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
