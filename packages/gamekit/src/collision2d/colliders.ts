/**
 * Attachable collider records and placement (T11.4).
 *
 * A `LocalCollider2D` is immutable local-space data: its `offset` and shape
 * dimensions are relative to an authored object position. `placeCollider2D`
 * is the ONLY local -> world path; world colliders feed broad-phase,
 * collider-pair, and debug operations. Placement preserves filter, sensor,
 * identifier, and author metadata and never mutates the source.
 *
 * Translation only: a rectangle stays axis-aligned and a circle stays a
 * circle. There is no general transform, and rendering never owns gameplay
 * collision state.
 */
import type { Aabb2D, Circle2D, Point2D, Vector2D } from '../geometry/types';
import {
  assertValidAabb2D,
  assertValidCircle2D,
  assertValidPoint2D,
  assertUnsigned32Bits,
} from '../geometry/validation';
import type { CollisionFilter2D } from './filters';
import { canCollide2D } from './filters';
import {
  collideAabbAabb2D,
  collideCircleAabb2D,
  collideCircleCircle2D,
  type CollisionHit2D,
} from './manifolds';

/** Shared collider metadata. */
export interface ColliderMetadata2D {
  /** Optional collision filter; absent means eligible with everything. */
  readonly filter?: CollisionFilter2D;
  /** True marks detection intent; never changes geometry results. */
  readonly sensor?: boolean;
  /** Stable user/entity identifier, independent of array indexes. */
  readonly id?: string;
}

/** A local-space AABB collider. */
export interface LocalAabbCollider2D extends ColliderMetadata2D {
  readonly space: 'local';
  readonly shape: 'aabb';
  /** Offset of the AABB's top-left corner from the authored object position. */
  readonly offset: Vector2D;
  /** Local width in logical world units. */
  readonly width: number;
  /** Local height in logical world units. */
  readonly height: number;
}

/** A local-space circle collider. */
export interface LocalCircleCollider2D extends ColliderMetadata2D {
  readonly space: 'local';
  readonly shape: 'circle';
  /** Offset of the circle's center from the authored object position. */
  readonly offset: Vector2D;
  /** Local radius in logical world units. */
  readonly radius: number;
}

/** A collider definition in the authored object's local space. */
export type LocalCollider2D = LocalAabbCollider2D | LocalCircleCollider2D;

/** A world-space AABB collider (already placed). */
export interface WorldAabbCollider2D extends ColliderMetadata2D {
  readonly space: 'world';
  readonly shape: 'aabb';
  /** World top-left corner. */
  readonly x: number;
  /** World top-left corner. */
  readonly y: number;
  /** World width. */
  readonly width: number;
  /** World height. */
  readonly height: number;
}

/** A world-space circle collider (already placed). */
export interface WorldCircleCollider2D extends ColliderMetadata2D {
  readonly space: 'world';
  readonly shape: 'circle';
  /** World center x. */
  readonly x: number;
  /** World center y. */
  readonly y: number;
  /** World radius. */
  readonly radius: number;
}

/** A collider placed in world space. */
export type WorldCollider2D = WorldAabbCollider2D | WorldCircleCollider2D;

/** Options for the beginner rectangle collider constructor. */
export interface RectangleCollider2DOptions {
  /** Offset of the top-left corner from the object position. */
  readonly offset: Vector2D;
  /** Local width. */
  readonly width: number;
  /** Local height. */
  readonly height: number;
  readonly filter?: CollisionFilter2D;
  readonly sensor?: boolean;
  readonly id?: string;
}

/** Options for the beginner circle collider constructor. */
export interface CircleCollider2DOptions {
  /** Offset of the center from the object position. */
  readonly offset: Vector2D;
  /** Local radius. */
  readonly radius: number;
  readonly filter?: CollisionFilter2D;
  readonly sensor?: boolean;
  readonly id?: string;
}

function validateMetadata(metadata: ColliderMetadata2D): void {
  if (metadata.filter !== undefined) {
    assertUnsigned32Bits(metadata.filter.categoryBits, 'filter.categoryBits');
    assertUnsigned32Bits(metadata.filter.maskBits, 'filter.maskBits');
  }
}

/** Create an immutable local AABB collider. */
export function rectangleCollider2D(options: RectangleCollider2DOptions): LocalAabbCollider2D {
  const collider: LocalAabbCollider2D = {
    space: 'local',
    shape: 'aabb',
    offset: Object.freeze({ x: options.offset.x, y: options.offset.y }),
    width: options.width,
    height: options.height,
    ...(options.filter === undefined ? {} : { filter: options.filter }),
    ...(options.sensor === undefined ? {} : { sensor: options.sensor }),
    ...(options.id === undefined ? {} : { id: options.id }),
  };
  validateMetadata(collider);
  assertValidAabb2D(
    {
      x: options.offset.x,
      y: options.offset.y,
      width: options.width,
      height: options.height,
    },
    'collider',
  );
  return Object.freeze(collider);
}

/** Create an immutable local circle collider. */
export function circleCollider2D(options: CircleCollider2DOptions): LocalCircleCollider2D {
  const collider: LocalCircleCollider2D = {
    space: 'local',
    shape: 'circle',
    offset: Object.freeze({ x: options.offset.x, y: options.offset.y }),
    radius: options.radius,
    ...(options.filter === undefined ? {} : { filter: options.filter }),
    ...(options.sensor === undefined ? {} : { sensor: options.sensor }),
    ...(options.id === undefined ? {} : { id: options.id }),
  };
  validateMetadata(collider);
  assertValidCircle2D(
    { x: options.offset.x, y: options.offset.y, radius: options.radius },
    'collider',
  );
  return Object.freeze(collider);
}

/**
 * Place a local collider at an authored object position, returning an
 * immutable world-space collider. Rejects local colliders at compile time.
 */
export function placeCollider2D(local: LocalCollider2D, position: Point2D): WorldCollider2D {
  assertValidPoint2D(position, 'position');
  const worldX = position.x + local.offset.x;
  const worldY = position.y + local.offset.y;
  const metadata = {
    ...(local.filter === undefined ? {} : { filter: local.filter }),
    ...(local.sensor === undefined ? {} : { sensor: local.sensor }),
    ...(local.id === undefined ? {} : { id: local.id }),
  };
  if (local.shape === 'aabb') {
    const world: WorldAabbCollider2D = {
      space: 'world',
      shape: 'aabb',
      x: worldX,
      y: worldY,
      width: local.width,
      height: local.height,
      ...metadata,
    };
    assertValidAabb2D(world, 'world');
    return Object.freeze(world);
  }
  const world: WorldCircleCollider2D = {
    space: 'world',
    shape: 'circle',
    x: worldX,
    y: worldY,
    radius: local.radius,
    ...metadata,
  };
  assertValidCircle2D(world, 'world');
  return Object.freeze(world);
}

/** World-space AABB view of a collider (for broad-phase bounds). */
export function worldColliderBounds2D(world: WorldCollider2D): Aabb2D {
  if (world.shape === 'aabb') {
    return Object.freeze({
      x: world.x,
      y: world.y,
      width: world.width,
      height: world.height,
    });
  }
  return Object.freeze({
    x: world.x - world.radius,
    y: world.y - world.radius,
    width: world.radius * 2,
    height: world.radius * 2,
  });
}

/** World-space circle view of a collider (for narrow-phase pairs). */
export function worldColliderCircle2D(world: WorldCollider2D): Circle2D | undefined {
  if (world.shape === 'circle') {
    return Object.freeze({ x: world.x, y: world.y, radius: world.radius });
  }
  return undefined;
}

/**
 * Narrow-phase contact between two placed world colliders.
 *
 * Applies the colliders' filters symmetrically (an absent filter is
 * eligible with everything), then dispatches on the shape pair. Returns
 * the same manifold conventions as the shape-level functions.
 */
export function collideWorldColliders2D(
  first: WorldCollider2D,
  second: WorldCollider2D,
): CollisionHit2D | undefined {
  if (
    first.filter !== undefined &&
    second.filter !== undefined &&
    !canCollide2D(first.filter, second.filter)
  ) {
    return undefined;
  }
  if (first.shape === 'aabb' && second.shape === 'aabb') {
    return collideAabbAabb2D(
      { x: first.x, y: first.y, width: first.width, height: first.height },
      { x: second.x, y: second.y, width: second.width, height: second.height },
    );
  }
  if (first.shape === 'circle' && second.shape === 'circle') {
    return collideCircleCircle2D(
      { x: first.x, y: first.y, radius: first.radius },
      { x: second.x, y: second.y, radius: second.radius },
    );
  }
  const circle =
    first.shape === 'circle'
      ? (first as WorldCircleCollider2D)
      : (second as WorldCircleCollider2D);
  const aabb =
    first.shape === 'aabb'
      ? (first as WorldAabbCollider2D)
      : (second as WorldAabbCollider2D);
  return collideCircleAabb2D(
    { x: circle.x, y: circle.y, radius: circle.radius },
    { x: aabb.x, y: aabb.y, width: aabb.width, height: aabb.height },
  );
}
