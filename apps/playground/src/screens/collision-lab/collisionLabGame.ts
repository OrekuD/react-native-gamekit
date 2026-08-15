/**
 * Collision Lab — the Task 11 reference example (T11.8).
 *
 * A headless diagnostic scene that computes static and swept contacts with
 * the public Collision2D API and publishes the results (normal, depth,
 * point, sweep time, candidate counts) in its snapshot, so the renderer and
 * HUD only present them. Pair, sweep, and filter toggles are buttons on the
 * content side; the scene stays deterministic.
 */
import {
  buildSpatialHash2D,
  canCollide2D,
  collideAabbAabb2D,
  collideCircleAabb2D,
  collideCircleCircle2D,
  createGameSession,
  defineGame,
  defineScene,
  querySpatialHash2D,
  sweepCircleAabb2D,
  type CollisionHit2D,
  type GameSession,
} from 'rn-gamekit';

export const COLLISION_LAB_CONFIG = {
  logicalWidth: 320,
  logicalHeight: 480,
  ball: { x: 210, y: 210, radius: 14 },
  box: { x: 200, y: 220, width: 60, height: 40 },
  projectile: { x: 24, y: 60, vx: 160, radius: 8 },
  target: { x: 240, y: 60, width: 30, height: 12 },
  player: { x: 160, y: 400 },
  cellSize: 64,
  // The demo filters EXCLUDE each other: A masks only category 0b100, so
  // B's category 0b10 is never eligible when filtering is on.
  filterA: { categoryBits: 0b1, maskBits: 0b100 },
  filterB: { categoryBits: 0b10, maskBits: 0b1 },
} as const;

export type LabPairId = 'circleAabb' | 'aabbAabb' | 'circleCircle';

export interface CollisionLabSnapshot {
  readonly pair: LabPairId;
  readonly swept: boolean;
  readonly filterEnabled: boolean;
  /** Static contact result for the selected pair. */
  readonly staticHit: CollisionHit2D | undefined;
  /** Swept projectile result against the thin target. */
  readonly sweptHit: { readonly time: number } | undefined;
  /** Broad-phase candidates for the ball's cell region. */
  readonly candidates: readonly string[];
  readonly player: { readonly x: number; readonly y: number };
  readonly ball: { readonly x: number; readonly y: number; readonly radius: number };
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly projectile: { readonly x: number; readonly y: number; readonly radius: number };
  readonly target: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

const labScene = defineScene({
  actions: ['cycle-pair', 'toggle-sweep', 'toggle-filter'],
  create: () => ({
    pair: 'circleAabb' as LabPairId,
    swept: false,
    filterEnabled: false,
    projectileTicks: 0,
  }),
  update: ({ state, input, deltaSeconds }) => {
    const pair: LabPairId =
      state.pair === 'circleAabb' ? 'aabbAabb' : state.pair === 'aabbAabb' ? 'circleCircle' : 'circleAabb';
    const swept = input.button('toggle-sweep').pressed ? !state.swept : state.swept;
    const filterEnabled = input.button('toggle-filter').pressed ? !state.filterEnabled : state.filterEnabled;
    const projectileTicks = swept ? state.projectileTicks + 1 : state.projectileTicks;
    void deltaSeconds;
    return {
      pair: input.button('cycle-pair').pressed ? pair : state.pair,
      swept,
      filterEnabled,
      projectileTicks,
    };
  },
  snapshot: ({ state }): CollisionLabSnapshot => {
    const { ball, box, projectile, target, player, cellSize, filterA, filterB } = COLLISION_LAB_CONFIG;
    const stepSeconds = 1 / 60;
    const travelled = projectile.vx * stepSeconds * state.projectileTicks;
    const projectileX = projectile.x + (travelled % (COLLISION_LAB_CONFIG.logicalWidth + 40));

    // Static contact for the selected pair (circle-circle reuses the box
    // center as a second circle so the toggle always has a case).
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
      staticHit = undefined; // Filtered pairs stay visible but report nothing.
    }

    // Swept projectile against the thin target.
    const sweptHit =
      state.swept && state.projectileTicks > 0
        ? sweepCircleAabb2D({
            circle: { x: projectile.x, y: projectile.y, radius: projectile.radius },
            displacement: {
              x: projectileX - projectile.x,
              y: 0,
            },
            target,
          })
        : undefined;

    // Broad phase: candidates for the ball's region, deterministic order.
    const index = buildSpatialHash2D({
      items: [
        {
          id: 'ball',
          bounds: { x: ball.x - ball.radius, y: ball.y - ball.radius, width: ball.radius * 2, height: ball.radius * 2 },
        },
        { id: 'box', bounds: { x: box.x, y: box.y, width: box.width, height: box.height } },
        {
          id: 'projectile',
          bounds: {
            x: projectileX - projectile.radius,
            y: projectile.y - projectile.radius,
            width: projectile.radius * 2,
            height: projectile.radius * 2,
          },
        },
      ],
      cellSize,
    });
    const candidates = querySpatialHash2D(index, {
      x: ball.x - 1,
      y: ball.y - 1,
      width: 2,
      height: 2,
    });

    return {
      pair: state.pair,
      swept: state.swept,
      filterEnabled: state.filterEnabled,
      staticHit,
      sweptHit: sweptHit === undefined ? undefined : { time: sweptHit.time },
      candidates,
      player: { x: player.x, y: player.y },
      ball: { x: ball.x, y: ball.y, radius: ball.radius },
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      projectile: { x: projectileX, y: projectile.y, radius: projectile.radius },
      target: { x: target.x, y: target.y, width: target.width, height: target.height },
    };
  },
});

export const collisionLabDefinition = defineGame({
  viewport: {
    logicalSize: { width: COLLISION_LAB_CONFIG.logicalWidth, height: COLLISION_LAB_CONFIG.logicalHeight },
    mode: 'fit',
  },
  input: {
    primary: { type: 'pointer', description: 'Probe the lab' },
    'cycle-pair': { type: 'button', description: 'Cycle the shape pair' },
    'toggle-sweep': { type: 'button', description: 'Toggle the swept projectile' },
    'toggle-filter': { type: 'button', description: 'Toggle collision filtering' },
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
