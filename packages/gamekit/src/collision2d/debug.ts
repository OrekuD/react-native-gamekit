/**
 * Headless debug projections (T11.6).
 *
 * Immutable debug primitives a renderer can draw without importing Skia
 * into the collision module. Colors and labels are optional presentation
 * metadata, never gameplay semantics. Production collision results never
 * allocate debug data; projection is opt-in.
 */
import type { Point2D, Vector2D } from '../geometry/types';
import { assertValidPoint2D, assertValidVector2D } from '../geometry/validation';
import type { CollisionHit2D } from './manifolds';
import type { WorldCollider2D } from './colliders';

/** Optional presentation metadata. */
export interface DebugStyle2D {
  /** Optional presentation color (renderer-specific encoding). */
  readonly color?: string;
  /** Optional author label (collider names, for example). */
  readonly label?: string;
}

/** Debug AABB. */
export interface DebugAabb2D extends DebugStyle2D {
  readonly kind: 'aabb';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Debug circle. */
export interface DebugCircle2D extends DebugStyle2D {
  readonly kind: 'circle';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Debug segment (sweep paths, rays). */
export interface DebugSegment2D extends DebugStyle2D {
  readonly kind: 'segment';
  readonly start: Point2D;
  readonly end: Point2D;
}

/** Debug point (contact points). */
export interface DebugPoint2D extends DebugStyle2D {
  readonly kind: 'point';
  readonly x: number;
  readonly y: number;
}

/** Debug vector (normals), drawn from `(x, y)` along `(dx, dy)`. */
export interface DebugVector2D extends DebugStyle2D {
  readonly kind: 'vector';
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

/** Any headless debug primitive. */
export type DebugPrimitive2D =
  | DebugAabb2D
  | DebugCircle2D
  | DebugSegment2D
  | DebugPoint2D
  | DebugVector2D;

/** Project a world collider into a debug primitive, preserving its id. */
export function projectWorldCollider2D(world: WorldCollider2D): DebugAabb2D | DebugCircle2D {
  const style = world.id === undefined ? {} : { label: world.id };
  if (world.shape === 'aabb') {
    return Object.freeze({
      kind: 'aabb',
      x: world.x,
      y: world.y,
      width: world.width,
      height: world.height,
      ...style,
    });
  }
  return Object.freeze({
    kind: 'circle',
    x: world.x,
    y: world.y,
    radius: world.radius,
    ...style,
  });
}

/** Project a contact hit into its contact point and normal arrow. */
export function projectHit2D(hit: CollisionHit2D): {
  readonly point: DebugPoint2D;
  readonly normal: DebugVector2D;
} {
  return Object.freeze({
    point: Object.freeze({ kind: 'point', x: hit.point.x, y: hit.point.y }),
    normal: Object.freeze({
      kind: 'vector',
      x: hit.point.x,
      y: hit.point.y,
      dx: hit.normal.x,
      dy: hit.normal.y,
    }),
  });
}

/** Project a sweep path (start to end of the swept reference point). */
export function projectSweepPath2D(start: Point2D, end: Point2D, label?: string): DebugSegment2D {
  assertValidPoint2D(start, 'start');
  assertValidPoint2D(end, 'end');
  return Object.freeze({
    kind: 'segment',
    start: Object.freeze({ x: start.x, y: start.y }),
    end: Object.freeze({ x: end.x, y: end.y }),
    ...(label === undefined ? {} : { label }),
  });
}

/** Project a plain vector arrow (for example a velocity). */
export function projectVector2D(origin: Point2D, vector: Vector2D, label?: string): DebugVector2D {
  assertValidPoint2D(origin, 'origin');
  assertValidVector2D(vector, 'vector');
  return Object.freeze({
    kind: 'vector',
    x: origin.x,
    y: origin.y,
    dx: vector.x,
    dy: vector.y,
    ...(label === undefined ? {} : { label }),
  });
}
