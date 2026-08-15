/**
 * Compile-time contract fixture (T11.0) for Collision2D.
 *
 * Typechecked only — never executed. Freezes the public call sites: static
 * contact, swept contact, filtering, broad-phase build/query, imported
 * sprite attachment with multiple named colliders, invalid-input rejection,
 * local-vs-world collider separation, and the headless root import.
 */
import {
  buildSpatialHash2D,
  canCollide2D,
  circleCollider2D,
  collideAabbAabb2D,
  collideCircleAabb2D,
  collideCircleCircle2D,
  collideWorldColliders2D,
  pointInAabb2D,
  pointInCircle2D,
  GeometryError,
  intersectSegmentAabb2D,
  intersectSegmentCircle2D,
  intersectsAabbAabb2D,
  intersectsCircleAabb2D,
  intersectsCircleCircle2D,
  placeCollider2D,
  querySpatialHash2D,
  rectangleCollider2D,
  sweepAabbAabb2D,
  sweepCircleAabb2D,
  type Aabb2D,
  type Circle2D,
  type CollisionFilter2D,
  type CollisionHit2D,
  type GeometryErrorCode,
  type LocalCollider2D,
  type Point2D,
  type Segment2D,
  type SegmentHit2D,
  type SweepHit2D,
  type Vector2D,
  type WorldCollider2D,
} from '../src/index';

// --- beginner static contact ------------------------------------------------

const ball: Circle2D = { x: 152, y: 80, radius: 6 };
const brick: Aabb2D = { x: 144, y: 72, width: 32, height: 12 };

const hit: CollisionHit2D | undefined = collideCircleAabb2D(ball, brick);
if (hit !== undefined) {
  hit.normal satisfies Vector2D;
  hit.depth satisfies number;
  hit.point satisfies Point2D;
  const resolved: Circle2D = {
    ...ball,
    x: ball.x + hit.normal.x * hit.depth,
    y: ball.y + hit.normal.y * hit.depth,
  };
  void resolved;
}

// Predicates stay usable without manifolds.
intersectsAabbAabb2D(brick, brick) satisfies boolean;
intersectsCircleCircle2D(ball, ball) satisfies boolean;
collideCircleCircle2D(ball, ball) satisfies CollisionHit2D | undefined;
collideAabbAabb2D(brick, brick) satisfies CollisionHit2D | undefined;
intersectsCircleAabb2D(ball, brick) satisfies boolean;
pointInAabb2D({ x: ball.x, y: ball.y }, brick) satisfies boolean;
pointInCircle2D({ x: ball.x, y: ball.y }, ball) satisfies boolean;

// --- swept contact ----------------------------------------------------------

const sweepHit: SweepHit2D | undefined = sweepCircleAabb2D({
  circle: ball,
  displacement: { x: 200, y: 0 },
  target: brick,
});
if (sweepHit !== undefined) {
  sweepHit.time satisfies number;
  sweepHit.normal satisfies Vector2D;
  sweepHit.point satisfies Point2D;
}
sweepAabbAabb2D({
  aabb: brick,
  displacement: { x: 40, y: 40 },
  target: brick,
}) satisfies SweepHit2D | undefined;

// --- segment queries --------------------------------------------------------

const ray: Segment2D = { start: { x: 0, y: 80 }, end: { x: 320, y: 80 } };
intersectSegmentAabb2D(ray, brick) satisfies SegmentHit2D | undefined;
intersectSegmentCircle2D(ray, ball) satisfies SegmentHit2D | undefined;

// --- filtering --------------------------------------------------------------

const playerFilter: CollisionFilter2D = { categoryBits: 0b1, maskBits: 0b10 };
const brickFilter: CollisionFilter2D = { categoryBits: 0b10, maskBits: 0b1 };
canCollide2D(playerFilter, brickFilter) satisfies boolean;

// --- collider attachment + placement ---------------------------------------

const player = {
  position: { x: 120, y: 80 } satisfies Point2D,
  sprite: {
    asset: 'assets.player',
    animation: 'walk',
    anchor: 'center',
  },
  colliders: {
    body: rectangleCollider2D({
      offset: { x: -10, y: -18 },
      width: 20,
      height: 36,
      filter: playerFilter,
    }),
    hurtbox: circleCollider2D({
      offset: { x: 0, y: -8 },
      radius: 12,
      filter: playerFilter,
      sensor: true,
    }),
  },
} as const;

player.colliders.body satisfies LocalCollider2D;
player.colliders.hurtbox satisfies LocalCollider2D;

const worldBody: WorldCollider2D = placeCollider2D(player.colliders.body, player.position);
const worldHurtbox: WorldCollider2D = placeCollider2D(player.colliders.hurtbox, player.position);
void worldBody;
void worldHurtbox;

// Placed colliders feed broad phase and queries.
const placed: readonly WorldCollider2D[] = [worldBody, worldHurtbox];
void placed;
collideWorldColliders2D(worldBody, worldHurtbox) satisfies CollisionHit2D | undefined;

// --- broad phase ------------------------------------------------------------

const index = buildSpatialHash2D({
  items: [
    { id: 'brick-0', bounds: brick },
    { id: 'ball', bounds: { x: ball.x - ball.radius, y: ball.y - ball.radius, width: 12, height: 12 } },
  ],
  cellSize: 32,
});
querySpatialHash2D(index, brick) satisfies readonly string[];

// --- errors ----------------------------------------------------------------

const geometryError: GeometryError = new GeometryError('GEOMETRY_INVALID_SIZE', 'width', '...');
geometryError.code satisfies GeometryErrorCode;

// --- expected failures ------------------------------------------------------

// @ts-expect-error world-only operations reject local colliders
placeCollider2D(worldBody, player.position);
// @ts-expect-error predicates take plain shapes, not local colliders
intersectsAabbAabb2D(player.colliders.body, brick);
// @ts-expect-error sweep options require the full shape
sweepCircleAabb2D({ circle: ball, displacement: { x: 1, y: 1 } });
// @ts-expect-error filters are explicit records, not booleans
canCollide2D(playerFilter, true);
// @ts-expect-error the geometry error code union is closed
new GeometryError('NOPE', 'x', '...');
// @ts-expect-error broad phase requires a positive cell size (runtime), and
// the options object is not optional
buildSpatialHash2D({ items: [] });

export {};
