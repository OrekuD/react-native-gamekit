/**
 * Mossy Cavern — a fixed-step, side-scrolling platformer built from the
 * public rn-gamekit APIs.
 *
 * Simulation owns physics, collisions, enemies, collectibles, checkpoints,
 * camera authoring, and typed events. The renderer presents immutable commit
 * snapshots; the screen binds the event-driven audio, haptics, particles, and
 * save effects.
 */
import { createGameSession, defineGame, defineScene, type GameSession } from 'rn-gamekit';
import type { Aabb2D } from 'rn-gamekit/geometry';
import {
  clampCameraBounds2D,
  createCamera2D,
  sampleCameraShake2D,
  followCamera2D,
  type Camera2D,
} from 'rn-gamekit/camera2d';
import type { SpriteAnimationState } from 'rn-gamekit/sprites';
import { advanceSpriteAnimation, sampleSpriteClipFrameName } from 'rn-gamekit/sprites';
import { movePlatformerBody2D } from 'rn-gamekit/tilemap';

import {
  MOSSY_CAVERN_CONFIG,
  MOSSY_CAVERN_SPAWN,
  MOSSY_CAVERN_VIEW,
  MOSSY_CAVERN_WORLD,
  mossyCavernAssets,
  mossyCavernEvents,
  mossyCavernLevel,
  type EnemyKind,
  type MossyCavernSave,
  type MossyCavernSnapshot,
  type PlantKind,
  type PlayerPose,
} from './mossyCavernData.ts';
import type {
  CameraShakeState,
  MossyCavernState,
  MossyCollectibleState,
  MossyEnemyState,
  MossyPlantState,
} from './mossyCavernState.ts';

export * from './mossyCavernData.ts';

const C = MOSSY_CAVERN_CONFIG.cellSize;
const PLAYER_WIDTH = 38;
const PLAYER_HEIGHT = 58;
const GROUND_TOP = (MOSSY_CAVERN_CONFIG.mapRows - 2) * C;
const INITIAL_CAMERA = createCamera2D({
  center: {
    x: MOSSY_CAVERN_SPAWN.x + PLAYER_WIDTH / 2,
    y: MOSSY_CAVERN_SPAWN.y + PLAYER_HEIGHT / 2,
  },
});

const CHECKPOINT_BODIES: readonly Aabb2D[] = MOSSY_CAVERN_CONFIG.checkpoints.map((column) => ({
  x: column * C + 13,
  y: GROUND_TOP - PLAYER_HEIGHT,
  width: PLAYER_WIDTH,
  height: PLAYER_HEIGHT,
}));

const PLAYER_SHEETS: Record<PlayerPose, unknown> = {
  idle: mossyCavernAssets.world.playerIdle,
  walk: mossyCavernAssets.world.playerWalk,
  jump: mossyCavernAssets.world.playerJump,
  dash: mossyCavernAssets.world.playerDash,
};

const ENEMY_SHEETS: Record<EnemyKind, unknown> = {
  green: mossyCavernAssets.world.slimeGreen,
  orange: mossyCavernAssets.world.slimeOrange,
};

const PLANT_SHEETS: Record<PlantKind, unknown> = {
  vine: mossyCavernAssets.world.plantVine,
  poison: mossyCavernAssets.world.plantPoison,
};

function animationFrame(sheet: unknown, clip: string, elapsedMs: number): string {
  const descriptor = sheet as {
    readonly animations: Readonly<Record<string, { readonly frames: readonly string[]; readonly frameDurationMs: number; readonly mode: 'loop' | 'once' }>>;
  };
  const animation = descriptor.animations[clip];
  if (animation === undefined) return '';
  return sampleSpriteClipFrameName(animation, elapsedMs);
}

function nextAnimation(sheet: unknown, state: SpriteAnimationState<string>, deltaSeconds: number): SpriteAnimationState<string> {
  return advanceSpriteAnimation(sheet as never, state as never, deltaSeconds) as SpriteAnimationState<string>;
}

function aabbIntersects(first: Aabb2D, second: Aabb2D): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function enemyBounds(enemy: MossyEnemyState): Aabb2D {
  return { x: enemy.x, y: enemy.y, width: enemy.width, height: enemy.height };
}

function plantBounds(plant: MossyPlantState): Aabb2D {
  return {
    x: plant.x - (plant.kind === 'poison' ? 28 : 18),
    y: plant.y - (plant.kind === 'poison' ? 56 : 48),
    width: plant.kind === 'poison' ? 56 : 36,
    height: plant.kind === 'poison' ? 56 : 48,
  };
}

function collectibleBounds(collectible: MossyCollectibleState): Aabb2D {
  return {
    x: collectible.x - collectible.width / 2,
    y: collectible.y - collectible.height / 2,
    width: collectible.width,
    height: collectible.height,
  };
}

function makeEnemies(): readonly MossyEnemyState[] {
  const definitions: readonly {
    readonly id: string;
    readonly kind: EnemyKind;
    readonly x: number;
    readonly platformY: number;
    readonly minX: number;
    readonly maxX: number;
    readonly speed: number;
  }[] = [
    { id: 'green-0', kind: 'green', x: 26 * C, platformY: GROUND_TOP, minX: 25 * C, maxX: 30 * C, speed: 38 },
    { id: 'green-1', kind: 'green', x: 23 * C, platformY: GROUND_TOP, minX: 22 * C, maxX: 30 * C, speed: 42 },
    { id: 'orange-0', kind: 'orange', x: 32 * C, platformY: GROUND_TOP, minX: 30 * C, maxX: 35 * C, speed: 48 },
    { id: 'orange-1', kind: 'orange', x: 45 * C, platformY: GROUND_TOP, minX: 44 * C, maxX: 48 * C, speed: 52 },
    { id: 'green-2', kind: 'green', x: 54 * C, platformY: GROUND_TOP - C * 2, minX: 48 * C, maxX: 54 * C, speed: 40 },
    { id: 'green-3', kind: 'green', x: 68 * C, platformY: GROUND_TOP, minX: 67 * C, maxX: 74 * C, speed: 46 },
    { id: 'orange-2', kind: 'orange', x: 75 * C, platformY: GROUND_TOP - C * 2, minX: 70 * C, maxX: 75 * C, speed: 56 },
    { id: 'orange-3', kind: 'orange', x: 84 * C, platformY: GROUND_TOP, minX: 83 * C, maxX: 88 * C, speed: 58 },
  ];
  return definitions.map((definition) => {
    const width = definition.kind === 'green' ? 48 : 52;
    const height = definition.kind === 'green' ? 34 : 40;
    const animation: SpriteAnimationState<'bounce'> = {
      clip: 'bounce', elapsedMs: 0, paused: false, speed: 1, completed: false,
    };
    return {
      ...definition,
      x: definition.x,
      y: definition.platformY - height,
      width,
      height,
      frame: animationFrame(ENEMY_SHEETS[definition.kind], 'bounce', 0),
      defeated: false,
      facingRight: true,
      scale: definition.kind === 'green' ? 0.8 : 0.72,
      animation,
    };
  });
}

function makePlants(): readonly MossyPlantState[] {
  const definitions: readonly {
    readonly id: string;
    readonly kind: PlantKind;
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly hazard: boolean;
  }[] = [
    { id: 'vine-0', kind: 'vine', x: 7 * C, y: GROUND_TOP, scale: 0.7, hazard: false },
    { id: 'vine-1', kind: 'vine', x: 15 * C, y: GROUND_TOP - C * 2, scale: 0.62, hazard: false },
    { id: 'poison-0', kind: 'poison', x: 29 * C, y: GROUND_TOP, scale: 0.62, hazard: true },
    { id: 'vine-2', kind: 'vine', x: 43 * C, y: GROUND_TOP - C * 2, scale: 0.65, hazard: false },
    { id: 'poison-1', kind: 'poison', x: 51 * C, y: GROUND_TOP - C * 2, scale: 0.58, hazard: true },
    { id: 'vine-3', kind: 'vine', x: 61 * C, y: GROUND_TOP, scale: 0.68, hazard: false },
    { id: 'poison-2', kind: 'poison', x: 73 * C, y: GROUND_TOP - C * 2, scale: 0.6, hazard: true },
    { id: 'vine-4', kind: 'vine', x: 82 * C, y: GROUND_TOP, scale: 0.7, hazard: false },
  ];
  return definitions.map((definition) => {
    const animation: SpriteAnimationState<'sway'> = {
      clip: 'sway', elapsedMs: 0, paused: false, speed: 1, completed: false,
    };
    return {
      ...definition,
      frame: animationFrame(PLANT_SHEETS[definition.kind], 'sway', 0),
      animation,
    };
  });
}

function makeCollectibles(): readonly MossyCollectibleState[] {
  const points = [
    [12 * C, GROUND_TOP - 110],
    [19 * C, GROUND_TOP - C * 3],
    [28 * C, GROUND_TOP - C * 4],
    [40 * C, GROUND_TOP - C * 3],
    [51 * C, GROUND_TOP - C * 5],
    [59 * C, GROUND_TOP - C * 3],
    [65 * C, GROUND_TOP - C * 3],
    [72 * C, GROUND_TOP - C * 5],
    [80 * C, GROUND_TOP - C * 3],
    [86 * C, GROUND_TOP - 116],
  ] as const;
  return points.map(([x, y], index) => ({
    id: `crystal-${String(index)}`,
    x,
    y,
    width: 28,
    height: 34,
    collected: false,
  }));
}

export function projectMossyCavernSave(state: Pick<MossyCavernState, 'checkpointIndex' | 'score' | 'crystals' | 'falls' | 'bestTimeSeconds'>): MossyCavernSave {
  return {
    checkpointIndex: state.checkpointIndex,
    score: state.score,
    crystals: state.crystals,
    falls: state.falls,
    bestTimeSeconds: state.bestTimeSeconds,
  };
}

function cameraForTarget(baseCamera: Camera2D, body: Aabb2D): { readonly base: Camera2D; readonly presented: Camera2D } {
  const target = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
  const followed = followCamera2D(baseCamera, target, { deadZone: MOSSY_CAVERN_CONFIG.cameraDeadZone });
  const base = clampCameraBounds2D(followed, MOSSY_CAVERN_WORLD, MOSSY_CAVERN_VIEW);
  return { base, presented: base };
}

function applyShake(base: Camera2D, shake: CameraShakeState): Camera2D {
  return shake.duration > 0 && shake.elapsed < shake.duration
    ? sampleCameraShake2D(base, {
        seed: shake.seed,
        elapsedSeconds: shake.elapsed,
        durationSeconds: shake.duration,
        amplitude: shake.amplitude,
      })
    : base;
}

/**
 * T20F-R3: the authored respawn body for one checkpoint index (clamped to
 * the authored range). Single source of truth for hydration and tests.
 */
export function mossyCavernCheckpointSpawn(checkpointIndex: number): Aabb2D {
  const last = MOSSY_CAVERN_CONFIG.checkpoints.length - 1;
  const index = Math.min(Math.max(Math.trunc(checkpointIndex), 0), last);
  return CHECKPOINT_BODIES[index] ?? MOSSY_CAVERN_SPAWN;
}

function makeState(save?: MossyCavernSave): MossyCavernState {
  const initialPlayerAnimation: SpriteAnimationState<'play'> = {
    clip: 'play', elapsedMs: 0, paused: false, speed: 1, completed: false,
  };
  // T20F-R3: hydrate from the validated projection — spawn at the saved
  // checkpoint and restore the aggregate stats. The lossy projection stores
  // no per-collectible state, so collectibles respawn fresh (documented).
  const checkpointIndex =
    save !== undefined && Number.isSafeInteger(save.checkpointIndex) && save.checkpointIndex >= 0
      ? Math.min(save.checkpointIndex, MOSSY_CAVERN_CONFIG.checkpoints.length - 1)
      : -1;
  const spawnBody = checkpointIndex >= 0 ? mossyCavernCheckpointSpawn(checkpointIndex) : MOSSY_CAVERN_SPAWN;
  const camera = cameraForTarget(INITIAL_CAMERA, spawnBody);
  return {
    body: spawnBody,
    vx: 0,
    vy: 0,
    onGround: false,
    facingRight: true,
    pose: 'idle',
    playerFrame: animationFrame(PLAYER_SHEETS.idle, 'play', 0),
    playerAnimation: initialPlayerAnimation,
    enemies: makeEnemies(),
    plants: makePlants(),
    collectibles: makeCollectibles(),
    checkpointsReached: MOSSY_CAVERN_CONFIG.checkpoints.map((_column, index) => checkpointIndex >= 0 && index <= checkpointIndex),
    checkpointIndex,
    respawnBody: spawnBody,
    health: MOSSY_CAVERN_CONFIG.maxHealth,
    crystals: save?.crystals ?? 0,
    score: save?.score ?? 0,
    falls: save?.falls ?? 0,
    elapsed: 0,
    bestTimeSeconds: save?.bestTimeSeconds ?? 0,
    finished: false,
    gameOver: false,
    spawnCut: true,
    ticks: 0,
    coyoteRemaining: 0,
    jumpBufferRemaining: 0,
    dashRemaining: 0,
    dashCooldown: 0,
    invulnerableRemaining: 0,
    baseCamera: camera.base,
    camera: camera.presented,
    shake: { seed: 0, elapsed: 0, duration: 0, amplitude: 0 },
  };
}

function animateEnemies(enemies: readonly MossyEnemyState[], deltaSeconds: number): readonly MossyEnemyState[] {
  return enemies.map((enemy) => {
    const animation = nextAnimation(ENEMY_SHEETS[enemy.kind], enemy.animation, deltaSeconds) as SpriteAnimationState<'bounce'>;
    if (enemy.defeated) return { ...enemy, animation, frame: animationFrame(ENEMY_SHEETS[enemy.kind], 'bounce', animation.elapsedMs) };
    let x = enemy.x + (enemy.facingRight ? enemy.speed : -enemy.speed) * deltaSeconds;
    let facingRight = enemy.facingRight;
    if (x < enemy.minX) {
      x = enemy.minX;
      facingRight = true;
    } else if (x > enemy.maxX) {
      x = enemy.maxX;
      facingRight = false;
    }
    return {
      ...enemy,
      x,
      facingRight,
      animation,
      frame: animationFrame(ENEMY_SHEETS[enemy.kind], 'bounce', animation.elapsedMs),
    };
  });
}

function animatePlants(plants: readonly MossyPlantState[], deltaSeconds: number): readonly MossyPlantState[] {
  return plants.map((plant) => {
    const animation = nextAnimation(PLANT_SHEETS[plant.kind], plant.animation, deltaSeconds) as SpriteAnimationState<'sway'>;
    return {
      ...plant,
      animation,
      frame: animationFrame(PLANT_SHEETS[plant.kind], 'sway', animation.elapsedMs),
    };
  });
}

function snapshotOf(state: MossyCavernState): MossyCavernSnapshot {
  return {
    body: state.body,
    onGround: state.onGround,
    facingRight: state.facingRight,
    pose: state.pose,
    playerFrame: state.playerFrame,
    enemies: state.enemies.map(({ minX: _minX, maxX: _maxX, speed: _speed, animation: _animation, ...enemy }) => enemy),
    plants: state.plants.map(({ animation: _animation, ...plant }) => plant),
    collectibles: state.collectibles.map(({ width: _width, height: _height, ...collectible }) => collectible),
    checkpoints: MOSSY_CAVERN_CONFIG.checkpoints.map((x, index) => ({
      index,
      x: x * C,
      reached: state.checkpointsReached[index] ?? false,
    })),
    checkpointIndex: state.checkpointIndex,
    health: state.health,
    crystals: state.crystals,
    score: state.score,
    falls: state.falls,
    elapsed: state.elapsed,
    bestTimeSeconds: state.bestTimeSeconds,
    finished: state.finished,
    gameOver: state.gameOver,
    spawnCut: state.spawnCut,
    ticks: state.ticks,
    camera: state.camera,
  };
}

function frozenRun(state: MossyCavernState, deltaSeconds: number): MossyCavernState {
  const nextElapsed = state.elapsed + deltaSeconds;
  return {
    ...state,
    elapsed: nextElapsed,
    ticks: state.ticks + 1,
    spawnCut: false,
    plants: animatePlants(state.plants, deltaSeconds),
    enemies: animateEnemies(state.enemies, deltaSeconds),
  };
}

// ---------------------------------------------------------------------------
// Fixed-step scene
// ---------------------------------------------------------------------------

const mossyCavernScene = defineScene({
  actions: ['left', 'right', 'jump', 'dash', 'drop'] as const,
  transitions: [] as const,
  emits: [
    'jump', 'dash', 'crystal', 'enemy-defeated', 'player-hit', 'checkpoint',
    'fall', 'finish', 'game-over',
  ] as const,
  events: mossyCavernEvents,
  create: makeState,
  update: ({ state, input, events, deltaSeconds, tick }): MossyCavernState => {
    if (state.finished || state.gameOver) return frozenRun(state, deltaSeconds);

    const left = input.button('left').held === true;
    const right = input.button('right').held === true;
    const drop = input.button('drop').held === true;
    const jumpPressed = input.button('jump').pressed;
    const dashPressed = input.button('dash').pressed;
    const elapsed = state.elapsed + deltaSeconds;

    const coyoteRemaining = state.onGround
      ? MOSSY_CAVERN_CONFIG.coyoteSeconds
      : Math.max(0, state.coyoteRemaining - deltaSeconds);
    let jumpBufferRemaining = jumpPressed
      ? MOSSY_CAVERN_CONFIG.jumpBufferSeconds
      : Math.max(0, state.jumpBufferRemaining - deltaSeconds);
    let dashRemaining = Math.max(0, state.dashRemaining - deltaSeconds);
    const dashCooldown = Math.max(0, state.dashCooldown - deltaSeconds);
    let invulnerableRemaining = Math.max(0, state.invulnerableRemaining - deltaSeconds);
    let facingRight = state.facingRight;
    if (right && !left) facingRight = true;
    if (left && !right) facingRight = false;

    const moving = left !== right;
    const horizontalVelocity = moving
      ? (right ? 1 : -1) * MOSSY_CAVERN_CONFIG.moveSpeed
      : 0;
    let vx = horizontalVelocity;
    let vy = state.vy + MOSSY_CAVERN_CONFIG.gravity * deltaSeconds;
    let dashStarted = false;

    if (dashRemaining > 0) {
      vx = (facingRight ? 1 : -1) * MOSSY_CAVERN_CONFIG.dashSpeed;
      vy = 0;
    } else if (dashPressed && dashCooldown <= 0) {
      dashStarted = true;
      dashRemaining = MOSSY_CAVERN_CONFIG.dashDurationSeconds;
      vx = (facingRight ? 1 : -1) * MOSSY_CAVERN_CONFIG.dashSpeed;
      vy = 0;
      events.emit('dash', {
        x: state.body.x + state.body.width / 2,
        y: state.body.y + state.body.height,
      });
    }

    const wantsJump = jumpBufferRemaining > 0;
    if (!dashStarted && dashRemaining <= 0 && wantsJump && (state.onGround || coyoteRemaining > 0)) {
      vy = MOSSY_CAVERN_CONFIG.jumpVelocity;
      jumpBufferRemaining = 0;
      events.emit('jump', {
        x: state.body.x + state.body.width / 2,
        y: state.body.y + state.body.height,
      });
    }

    const movement = movePlatformerBody2D({
      body: state.body,
      velocity: { x: vx, y: vy },
      deltaSeconds,
      map: mossyCavernLevel,
      collisionLayers: ['terrain'],
      dropThroughOneWay: drop,
      floorSnapDistance: MOSSY_CAVERN_CONFIG.floorSnapDistance,
    });
    const nextBody = movement.body;
    const nextOnGround = movement.contacts.floor !== undefined;
    const nextEnemies = animateEnemies(state.enemies, deltaSeconds);
    const nextPlants = animatePlants(state.plants, deltaSeconds);
    let enemies = nextEnemies;
    let collectibles = state.collectibles;
    let score = state.score;
    let crystals = state.crystals;
    let nextHealth = state.health;
    let nextVy = nextOnGround ? 0 : movement.velocity.y;
    let nextRespawnBody = state.respawnBody;
    let nextCheckpointIndex = state.checkpointIndex;
    let checkpointsReached = state.checkpointsReached;
    let finished = false;
    let gameOver = false;
    let spawnCut = false;
    let nextInvulnerability = invulnerableRemaining;
    let shake: CameraShakeState = state.shake.duration > 0
      ? { ...state.shake, elapsed: state.shake.elapsed + deltaSeconds }
      : state.shake;

    const bodyBottom = nextBody.y + nextBody.height;
    const fallen = nextBody.y > MOSSY_CAVERN_WORLD.height + C * 2;

    // A stomp is resolved before ordinary enemy damage. The one-way bridges
    // make the landing plane explicit, so a descending body can defeat a slime
    // without giving the player invulnerability for free.
    const defeatedIds = new Set<string>();
    let stomped = false;
    if (!fallen) {
      for (const enemy of nextEnemies) {
        if (enemy.defeated || !aabbIntersects(nextBody, enemyBounds(enemy))) continue;
        const wasAbove = state.body.y + state.body.height <= enemy.y + 12;
        if (state.vy > 0 && wasAbove && bodyBottom >= enemy.y) {
          defeatedIds.add(enemy.id);
          stomped = true;
          score += 100;
          events.emit('enemy-defeated', { x: enemy.x + enemy.width / 2, y: enemy.y, kind: enemy.kind });
        }
      }
    }
    if (defeatedIds.size > 0) {
      enemies = nextEnemies.map((enemy) => defeatedIds.has(enemy.id) ? { ...enemy, defeated: true } : enemy);
      nextVy = -420;
      shake = { seed: tick, elapsed: 0, duration: MOSSY_CAVERN_CONFIG.cameraShakeDurationSeconds * 0.8, amplitude: 3 };
    }

    // Collectibles are immutable records with a presentation-only collected
    // flag; the event carries the exact committed total to effect consumers.
    collectibles = state.collectibles.map((collectible) => {
      if (collectible.collected || !aabbIntersects(nextBody, collectibleBounds(collectible))) return collectible;
      crystals += 1;
      score += 25;
      events.emit('crystal', { x: collectible.x, y: collectible.y, total: crystals });
      return { ...collectible, collected: true };
    });

    let damageReason: 'enemy' | 'poison' | 'fall' | undefined;
    if (!fallen && invulnerableRemaining <= 0 && !stomped) {
      if (nextEnemies.some((enemy) => !enemy.defeated && aabbIntersects(nextBody, enemyBounds(enemy)))) {
        damageReason = 'enemy';
      } else if (nextPlants.some((plant) => plant.hazard && aabbIntersects(nextBody, plantBounds(plant)))) {
        damageReason = 'poison';
      }
    }

    if (fallen || damageReason !== undefined) {
      if (fallen) {
        const falls = state.falls + 1;
        nextHealth = Math.max(0, state.health - 1);
        events.emit('fall', {
          x: state.body.x + state.body.width / 2,
          y: state.body.y + state.body.height,
          falls,
          health: nextHealth,
        });
        events.emit('player-hit', {
          x: state.body.x + state.body.width / 2,
          y: state.body.y + state.body.height,
          health: nextHealth,
          reason: 'fall',
        });
        if (nextHealth <= 0) {
          gameOver = true;
          events.emit('game-over', {
            x: state.body.x,
            y: state.body.y,
            falls,
            elapsedSeconds: elapsed,
            score,
            crystals,
          });
        }
        const respawn = nextHealth > 0 ? state.respawnBody : MOSSY_CAVERN_SPAWN;
        const camera = cameraForTarget(state.baseCamera, respawn);
        return {
          ...state,
          body: respawn,
          vx: 0,
          vy: 0,
          onGround: false,
          facingRight: true,
          pose: gameOver ? 'idle' : 'jump',
          playerAnimation: { ...state.playerAnimation, elapsedMs: 0, completed: false },
          playerFrame: animationFrame(PLAYER_SHEETS[gameOver ? 'idle' : 'jump'], 'play', 0),
          enemies,
          plants: nextPlants,
          collectibles,
          health: nextHealth,
          falls,
          elapsed,
          finished: false,
          gameOver,
          spawnCut: true,
          ticks: state.ticks + 1,
          coyoteRemaining: 0,
          jumpBufferRemaining: 0,
          dashRemaining: 0,
          dashCooldown: MOSSY_CAVERN_CONFIG.dashCooldownSeconds,
          invulnerableRemaining: gameOver ? 0 : MOSSY_CAVERN_CONFIG.invulnerabilitySeconds,
          baseCamera: camera.base,
          camera: camera.presented,
          shake: { seed: tick, elapsed: 0, duration: MOSSY_CAVERN_CONFIG.cameraShakeDurationSeconds, amplitude: 7 },
        };
      }

      nextHealth = Math.max(0, state.health - 1);
      const reason = damageReason ?? 'enemy';
      events.emit('player-hit', {
        x: nextBody.x + nextBody.width / 2,
        y: nextBody.y + nextBody.height / 2,
        health: nextHealth,
        reason,
      });
      shake = { seed: tick, elapsed: 0, duration: MOSSY_CAVERN_CONFIG.cameraShakeDurationSeconds, amplitude: 8 };
      nextInvulnerability = MOSSY_CAVERN_CONFIG.invulnerabilitySeconds;
      if (nextHealth <= 0) {
        gameOver = true;
        events.emit('game-over', {
          x: nextBody.x,
          y: nextBody.y,
          falls: state.falls,
          elapsedSeconds: elapsed,
          score,
          crystals,
        });
      } else {
        const camera = cameraForTarget(state.baseCamera, state.respawnBody);
        return {
          ...state,
          body: state.respawnBody,
          vx: 0,
          vy: 0,
          onGround: false,
          facingRight: true,
          pose: 'jump',
          playerAnimation: { ...state.playerAnimation, elapsedMs: 0, completed: false },
          playerFrame: animationFrame(PLAYER_SHEETS.jump, 'play', 0),
          enemies,
          plants: nextPlants,
          collectibles,
          health: nextHealth,
          elapsed,
          spawnCut: true,
          ticks: state.ticks + 1,
          coyoteRemaining: 0,
          jumpBufferRemaining: 0,
          dashRemaining: 0,
          dashCooldown: MOSSY_CAVERN_CONFIG.dashCooldownSeconds,
          invulnerableRemaining: nextInvulnerability,
          baseCamera: camera.base,
          camera: camera.presented,
          shake,
        };
      }
    }

    if (!gameOver) {
      const nextCheckpoints = state.checkpointsReached.slice() as boolean[];
      for (let index = 0; index < MOSSY_CAVERN_CONFIG.checkpoints.length; index += 1) {
        const checkpointX = MOSSY_CAVERN_CONFIG.checkpoints[index]! * C;
        if (nextCheckpoints[index] || nextBody.x + nextBody.width / 2 < checkpointX) continue;
        nextCheckpoints[index] = true;
        nextCheckpointIndex = Math.max(nextCheckpointIndex, index);
        nextRespawnBody = CHECKPOINT_BODIES[index] ?? state.respawnBody;
        const save = projectMossyCavernSave({
          checkpointIndex: nextCheckpointIndex,
          score,
          crystals,
          falls: state.falls,
          bestTimeSeconds: state.bestTimeSeconds,
        });
        events.emit('checkpoint', {
          index,
          x: checkpointX,
          y: nextRespawnBody.y,
          save,
        });
      }
      checkpointsReached = nextCheckpoints;
      const allCheckpointsReached = nextCheckpoints.every(Boolean);
      if (allCheckpointsReached && nextBody.x + nextBody.width >= MOSSY_CAVERN_CONFIG.finishColumn * C) {
        finished = true;
        const bestTimeSeconds = state.bestTimeSeconds === 0
          ? elapsed
          : Math.min(state.bestTimeSeconds, elapsed);
        const save = projectMossyCavernSave({
          checkpointIndex: nextCheckpointIndex,
          score,
          crystals,
          falls: state.falls,
          bestTimeSeconds,
        });
        events.emit('finish', {
          x: nextBody.x + nextBody.width / 2,
          y: nextBody.y,
          elapsedSeconds: elapsed,
          falls: state.falls,
          score,
          crystals,
          save,
        });
      }
    }

    const pose: PlayerPose = dashRemaining > 0
      ? 'dash'
      : !nextOnGround
        ? 'jump'
        : moving
          ? 'walk'
          : 'idle';
    const playerAnimation = pose === state.pose
      ? nextAnimation(PLAYER_SHEETS[pose], state.playerAnimation, deltaSeconds) as SpriteAnimationState<'play'>
      : { ...state.playerAnimation, elapsedMs: 0, completed: false };
    const frame = animationFrame(PLAYER_SHEETS[pose], 'play', playerAnimation.elapsedMs);
    const cameraState = cameraForTarget(state.baseCamera, nextBody);
    const presentedCamera = applyShake(cameraState.base, shake);

    return {
      ...state,
      body: nextBody,
      vx: finished ? 0 : vx,
      vy: finished ? 0 : nextVy,
      onGround: nextOnGround,
      facingRight,
      pose,
      playerFrame: frame,
      playerAnimation,
      enemies,
      plants: nextPlants,
      collectibles,
      checkpointsReached,
      checkpointIndex: nextCheckpointIndex,
      respawnBody: nextRespawnBody,
      health: nextHealth,
      crystals,
      score,
      elapsed,
      finished,
      gameOver,
      spawnCut,
      ticks: state.ticks + 1,
      coyoteRemaining: nextOnGround ? MOSSY_CAVERN_CONFIG.coyoteSeconds : coyoteRemaining,
      jumpBufferRemaining,
      dashRemaining: Math.max(0, dashRemaining - deltaSeconds),
      dashCooldown: dashStarted ? MOSSY_CAVERN_CONFIG.dashCooldownSeconds : dashCooldown,
      invulnerableRemaining: nextInvulnerability,
      baseCamera: cameraState.base,
      camera: presentedCamera,
      shake,
    };
  },
  snapshot: ({ state }): MossyCavernSnapshot => snapshotOf(state),
});

/**
 * T20F-R3: build the definition for one session generation. With a prepared
 * save the scene's create() hydrates from the validated projection; without
 * one it is byte-for-byte the original fresh run.
 */
export function createMossyCavernDefinition(save?: MossyCavernSave) {
  return defineGame({
    viewport: {
      logicalSize: {
        width: MOSSY_CAVERN_CONFIG.logicalWidth,
        height: MOSSY_CAVERN_CONFIG.logicalHeight,
      },
      mode: 'fit',
    },
    assets: mossyCavernAssets,
    input: {
      left: { type: 'button', description: 'Move left' },
      right: { type: 'button', description: 'Move right' },
      jump: { type: 'button', description: 'Jump' },
      dash: { type: 'button', description: 'Dash through the cavern' },
      drop: { type: 'button', description: 'Drop through moss bridges' },
    },
    events: mossyCavernEvents,
    scenes: { cavern: { ...mossyCavernScene, create: () => makeState(save) } },
    initialScene: 'cavern',
  });
}

export const mossyCavernDefinition = createMossyCavernDefinition();

export type MossyCavernDefinition = ReturnType<typeof createMossyCavernDefinition>;
export type MossyCavernSession = GameSession<
  MossyCavernDefinition['scenes'],
  MossyCavernDefinition['input'],
  typeof mossyCavernEvents
>;

export function followMossyCavernCamera(center: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
  return clampCameraBounds2D({ ...INITIAL_CAMERA, center }, MOSSY_CAVERN_WORLD, MOSSY_CAVERN_VIEW).center;
}

/** Create one session, hydrating from a prepared save when provided (T20F-R3). */
export function createMossyCavernSession(save?: MossyCavernSave): MossyCavernSession {
  return createGameSession(createMossyCavernDefinition(save)) as MossyCavernSession;
}
