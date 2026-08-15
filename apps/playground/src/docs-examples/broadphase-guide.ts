/**
 * The Detect-collisions guide's broad-phase example, kept in-tree so the
 * documented flow is compile-checked against the shipped API (T11-F8).
 *
 * The spatial hash indexes IDs only; the application owns the id -> collider
 * lookup, skips the moving object itself, and handles a missing id
 * explicitly instead of asserting non-null.
 */
import {
  buildSpatialHash2D,
  collideWorldColliders2D,
  circleCollider2D,
  placeCollider2D,
  querySpatialHash2D,
  rectangleCollider2D,
  worldColliderBounds2D,
  type CollisionHit2D,
  type WorldCollider2D,
} from 'rn-gamekit';

interface BroadPhaseExampleResult {
  readonly hits: readonly { readonly otherId: string; readonly hit: CollisionHit2D }[];
}

/** The documented application-owned lookup: id -> placed world collider. */
export function broadPhaseExample(): BroadPhaseExampleResult {
  // Application-owned colliders, keyed by stable id.
  const colliders = new Map<string, WorldCollider2D>();
  colliders.set('player', placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 10 }), { x: 60, y: 60 }));
  colliders.set('enemy', placeCollider2D(rectangleCollider2D({ offset: { x: 0, y: 0 }, width: 20, height: 20 }), { x: 66, y: 60 }));
  colliders.set('coin', placeCollider2D(circleCollider2D({ offset: { x: 0, y: 0 }, radius: 6 }), { x: 200, y: 40 }));

  // Spatial items are built from each collider's bounds.
  const items = [...colliders.entries()].map(([id, collider]) => ({
    id,
    bounds: worldColliderBounds2D(collider),
  }));
  const index = buildSpatialHash2D({ items, cellSize: 32 });

  // Per tick, for each moving object:
  const moving = colliders.get('player');
  const collected: { otherId: string; hit: CollisionHit2D }[] = [];
  if (moving === undefined) {
    return { hits: collected };
  }
  const candidates = querySpatialHash2D(index, worldColliderBounds2D(moving));
  for (const candidateId of candidates) {
    if (candidateId === 'player') {
      continue; // Never collide with yourself.
    }
    const other = colliders.get(candidateId);
    if (other === undefined) {
      // The index referenced an id the application no longer owns: skip it
      // explicitly rather than assuming it exists.
      continue;
    }
    const hit = collideWorldColliders2D(moving, other);
    if (hit !== undefined) {
      collected.push({ otherId: candidateId, hit });
    }
  }
  return { hits: collected };
}
