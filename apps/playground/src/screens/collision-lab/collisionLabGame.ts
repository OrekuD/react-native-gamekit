/**
 * Collision Lab — the Task 11 reference example (T11.8, T11-F9).
 *
 * A headless diagnostic scene that computes static and swept contacts with
 * the public Collision2D API, demonstrates the asset-attached workflow
 * (an imported sprite with named `body`/`hurtbox`/`attack`/`pickup`
 * colliders placed and projected through the public debug API), and proves
 * that changing the sprite animation never changes the colliders.
 */
import {
  buildSpatialHash2D,
  canCollide2D,
  circleCollider2D,
  collideAabbAabb2D,
  collideCircleAabb2D,
  collideCircleCircle2D,
  createGameSession,
  defineAssets,
  defineGame,
  defineScene,
  placeCollider2D,
  querySpatialHash2D,
  rectangleCollider2D,
  spriteSheet,
  sweepCircleAabb2D,
  type CollisionHit2D,
  type GameSession,
  type WorldCollider2D,
} from 'rn-gamekit';

export const labAssets = defineAssets({
  gameplay: {
    player: spriteSheet(require('../../../assets/kenney/platformer-player.png'), {
      frames: {
        idle: { x: 0, y: 196, width: 66, height: 92 },
        run: { x: 0, y: 0, width: 72, height: 97 },
      },
      animations: {
        idle: { frames: ['idle'], mode: 'once', frameDurationMs: 100 },
        run: { frames: ['run'], mode: 'once', frameDurationMs: 100 },
      },
    }),
  },
});

export const COLLISION_LAB_CONFIG = {
  logicalWidth: 320,
  logicalHeight: 480,
  ball: { x: 210, y: 210, radius: 14 },
  box: { x: 200, y: 220, width: 60, height: 40 },
  projectile: { x: 24, y: 60, vx: 160, radius: 8 },
  target: { x: 240, y: 60, width: 30, height: 12 },
  sprite: { x: 160, y: 400 },
  cellSize: 64,
  filterA: { categoryBits: 0b1, maskBits: 0b100 },
  filterB: { categoryBits: 0b10, maskBits: 0b1 },
  playerFilter: { categoryBits: 0b1, maskBits: 0b10 },
  enemyFilter: { categoryBits: 0b10, maskBits: 0b1 },
} as const;

export type LabPairId = 'circleAabb' | 'aabbAabb' | 'circleCircle';
export type LabAnimationId = 'idle' | 'run';

/**
 * Named local colliders on the imported sprite. The names describe author
 * intent only; no engine behavior attaches to them, and changing the
 * animation never replaces them.
 */
export const LAB_SPRITE_COLLIDERS = {
  body: rectangleCollider2D({
    offset: { x: -15, y: -46 },
    width: 30,
    height: 46,
    filter: COLLISION_LAB_CONFIG.playerFilter,
    id: 'body',
  }),
  hurtbox: circleCollider2D({
    offset: { x: 0, y: -34 },
    radius: 14,
    filter: COLLISION_LAB_CONFIG.playerFilter,
    sensor: true,
    id: 'hurtbox',
  }),
  attack: rectangleCollider2D({
    offset: { x: 12, y: -20 },
    width: 18,
    height: 14,
    filter: COLLISION_LAB_CONFIG.enemyFilter,
    sensor: true,
    id: 'attack',
  }),
  pickup: circleCollider2D({
    offset: { x: 0, y: 0 },
    radius: 6,
    filter: COLLISION_LAB_CONFIG.playerFilter,
    sensor: true,
    id: 'pickup',
  }),
} as const;

export interface CollisionLabSnapshot {
  readonly pair: LabPairId;
  readonly swept: boolean;
  readonly filterEnabled: boolean;
  readonly debugVisible: boolean;
  readonly animation: LabAnimationId;
  readonly staticHit: CollisionHit2D | undefined;
  readonly sweptHit: { readonly time: number } | undefined;
  readonly candidates: readonly string[];
  readonly sprite: { readonly x: number; readonly y: number };
  /** Placed world colliders for the sprite, unchanged by animation. */
  readonly colliders: readonly WorldCollider2D[];
  readonly projectileStart: { readonly x: number; readonly y: number };
  readonly projectile: { readonly x: number; readonly y: number; readonly radius: number };
  readonly target: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly ball: { readonly x: number; readonly y: number; readonly radius: number };
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

const labScene = defineScene({
  actions: ['cycle-pair', 'toggle-sweep', 'toggle-filter', 'cycle-anim', 'toggle-debug'],
  create: () => ({
    pair: 'circleAabb' as LabPairId,
    swept: false,
    filterEnabled: false,
    debugVisible: true,
    animation: 'idle' as LabAnimationId,
    projectileTicks: 0,
  }),
  update: ({ state, input }) => {
    const pair: LabPairId =
      state.pair === 'circleAabb' ? 'aabbAabb' : state.pair === 'aabbAabb' ? 'circleCircle' : 'circleAabb';
    const animation: LabAnimationId = state.animation === 'idle' ? 'run' : 'idle';
    const swept = input.button('toggle-sweep').pressed ? !state.swept : state.swept;
    return {
      pair: input.button('cycle-pair').pressed ? pair : state.pair,
      swept,
      filterEnabled: input.button('toggle-filter').pressed ? !state.filterEnabled : state.filterEnabled,
      debugVisible: input.button('toggle-debug').pressed ? !state.debugVisible : state.debugVisible,
      animation: input.button('cycle-anim').pressed ? animation : state.animation,
      // The projectile advances exactly one tick while swept and freezes
      // (keeps its position) when swept is off.
      projectileTicks: swept ? state.projectileTicks + 1 : state.projectileTicks,
    };
  },
  snapshot: ({ state }): CollisionLabSnapshot => {
    const { ball, box, projectile, target, sprite, cellSize, filterA, filterB } = COLLISION_LAB_CONFIG;
    const stepSeconds = 1 / 60;
    const travelled = projectile.vx * stepSeconds * state.projectileTicks;
    const projectileX = projectile.x + (travelled % (COLLISION_LAB_CONFIG.logicalWidth + 40));
    const projectileStart = {
      x: projectile.x + (Math.max(0, travelled - projectile.vx * stepSeconds) % (COLLISION_LAB_CONFIG.logicalWidth + 40)),
      y: projectile.y,
    };

    // Static contact for the selected pair.
    let staticHit: CollisionHit2D | undefined;
    if (state.pair === 'circleAabb') {
      staticHit = collideCircleAabb2D({ x: ball.x, y: ball.y, radius: ball.radius }, box);
    } else if (state.pair === 'aabbAabb') {
      staticHit = collideAabbAabb2D(
        { x: ball.x - ball.radius, y: ball.y - ball.radius, width: ball.radius * 2, height: ball.radius * 2 },
        box,
      );
    } else {
      staticHit = collideCircleCircle2D(
        { x: ball.x, y: ball.y, radius: ball.radius },
        { x: box.x, y: box.y, radius: 20 },
      );
    }
    if (state.filterEnabled && !canCollide2D(filterA, filterB)) {
      staticHit = undefined;
    }

    // Swept projectile against the thin target.
    const sweptHit =
      state.swept && state.projectileTicks > 0
        ? sweepCircleAabb2D({
            circle: { x: projectile.x, y: projectile.y, radius: projectile.radius },
            displacement: { x: projectileX - projectile.x, y: 0 },
            target,
          })
        : undefined;

    // Broad phase over the lab shapes.
    const index = buildSpatialHash2D({
      items: [
        { id: 'ball', bounds: { x: ball.x - ball.radius, y: ball.y - ball.radius, width: ball.radius * 2, height: ball.radius * 2 } },
        { id: 'box', bounds: { x: box.x, y: box.y, width: box.width, height: box.height } },
        { id: 'projectile', bounds: { x: projectileX - projectile.radius, y: projectile.y - projectile.radius, width: projectile.radius * 2, height: projectile.radius * 2 } },
      ],
      cellSize,
    });
    const candidates = querySpatialHash2D(index, { x: ball.x - 1, y: ball.y - 1, width: 2, height: 2 });

    // Asset-attached colliders: placed from the sprite position, unchanged
    // by the animation.
    const colliders = [
      placeCollider2D(LAB_SPRITE_COLLIDERS.body, sprite),
      placeCollider2D(LAB_SPRITE_COLLIDERS.hurtbox, sprite),
      placeCollider2D(LAB_SPRITE_COLLIDERS.attack, sprite),
      placeCollider2D(LAB_SPRITE_COLLIDERS.pickup, sprite),
    ];

    return {
      pair: state.pair,
      swept: state.swept,
      filterEnabled: state.filterEnabled,
      debugVisible: state.debugVisible,
      animation: state.animation,
      staticHit,
      sweptHit: sweptHit === undefined ? undefined : { time: sweptHit.time },
      candidates,
      sprite: { x: sprite.x, y: sprite.y },
      colliders,
      projectileStart,
      projectile: { x: projectileX, y: projectile.y, radius: projectile.radius },
      target: { x: target.x, y: target.y, width: target.width, height: target.height },
      ball: { x: ball.x, y: ball.y, radius: ball.radius },
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  },
});

export const collisionLabDefinition = defineGame({
  viewport: {
    logicalSize: { width: COLLISION_LAB_CONFIG.logicalWidth, height: COLLISION_LAB_CONFIG.logicalHeight },
    mode: 'fit',
  },
  assets: labAssets,
  input: {
    primary: { type: 'pointer', description: 'Probe the lab' },
    'cycle-pair': { type: 'button', description: 'Cycle the shape pair' },
    'toggle-sweep': { type: 'button', description: 'Toggle the swept projectile' },
    'toggle-filter': { type: 'button', description: 'Toggle collision filtering' },
    'cycle-anim': { type: 'button', description: 'Cycle the sprite animation' },
    'toggle-debug': { type: 'button', description: 'Toggle the debug overlays' },
  },
  scenes: {
    lab: labScene,
  },
  initialScene: 'lab',
});

export function createCollisionLabSession(): GameSession<
  typeof collisionLabDefinition['scenes'],
  typeof collisionLabDefinition['input']
> {
  return createGameSession(collisionLabDefinition);
}
