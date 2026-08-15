/**
 * Contact manifolds (T11.2).
 *
 * A `CollisionHit2D` reports geometry only: the normal that moves the FIRST
 * argument out of the SECOND, the nonnegative penetration depth, and a
 * stable contact point. Applying `first += normal * depth` resolves an
 * ordinary overlap within documented floating-point tolerance. Misses
 * return `undefined` and allocate nothing.
 *
 * Conventions (locked in T11.0):
 * - Boundary contact counts as intersection and may return a zero-depth hit.
 * - Circle-AABB: the contact point is the closest point on the AABB to the
 *   circle center; when the center is inside the AABB, the minimum
 *   penetration face wins with ties in the order left, top, right, bottom.
 * - Circle-circle: the contact point is on the first circle's boundary
 *   toward the second; coincident centers use the fallback normal `(0, 1)`
 *   (straight down the positive-y axis) with zero-depth resolution depth.
 * - AABB-AABB: the contact point is the center of the overlap rectangle;
 *   exact corner ties use the normal `(0, 1)`.
 */
import type { Aabb2D, Circle2D, Point2D, Vector2D } from '../geometry/types';
import {
  assertValidAabb2D,
  assertValidCircle2D,
} from '../geometry/validation';
import { closestPointOnAabb2D } from './intersections';

/** One contact between two shapes, in the first shape's local resolution. */
export interface CollisionHit2D {
  /** Unit normal moving the first argument out of the second. */
  readonly normal: Vector2D;
  /** Nonnegative penetration depth in logical world units. */
  readonly depth: number;
  /** Stable contact point in world coordinates. */
  readonly point: Point2D;
}

/** Resolution tolerance used by tests: relative to the shape size. */
export const RESOLUTION_TOLERANCE = 1e-9;

/** AABB-AABB contact manifold. `undefined` when the shapes do not touch. */
export function collideAabbAabb2D(first: Aabb2D, second: Aabb2D): CollisionHit2D | undefined {
  assertValidAabb2D(first, 'first');
  assertValidAabb2D(second, 'second');

  const firstMaxX = first.x + first.width;
  const firstMaxY = first.y + first.height;
  const secondMaxX = second.x + second.width;
  const secondMaxY = second.y + second.height;

  const overlapX = Math.min(firstMaxX, secondMaxX) - Math.max(first.x, second.x);
  const overlapY = Math.min(firstMaxY, secondMaxY) - Math.max(first.y, second.y);
  if (overlapX < 0 || overlapY < 0) {
    return undefined;
  }

  const firstCenterX = first.x + first.width / 2;
  const firstCenterY = first.y + first.height / 2;
  const secondCenterX = second.x + second.width / 2;
  const secondCenterY = second.y + second.height / 2;

  let normal: Vector2D;
  let depth: number;
  if (overlapX === 0 && overlapY === 0) {
    // Exact corner touch: locked deterministic tie rule.
    normal = Object.freeze({ x: 0, y: 1 });
    depth = 0;
  } else if (overlapX < overlapY) {
    normal = Object.freeze({
      x: firstCenterX < secondCenterX ? -1 : 1,
      y: 0,
    });
    depth = overlapX;
  } else {
    normal = Object.freeze({
      x: 0,
      y: firstCenterY < secondCenterY ? -1 : 1,
    });
    depth = overlapY;
  }

  return Object.freeze({
    normal,
    depth,
    point: Object.freeze({
      x: (Math.max(first.x, second.x) + Math.min(firstMaxX, secondMaxX)) / 2,
      y: (Math.max(first.y, second.y) + Math.min(firstMaxY, secondMaxY)) / 2,
    }),
  });
}

/** Circle-circle contact manifold. `undefined` when the circles do not touch. */
export function collideCircleCircle2D(
  first: Circle2D,
  second: Circle2D,
): CollisionHit2D | undefined {
  assertValidCircle2D(first, 'first');
  assertValidCircle2D(second, 'second');

  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const radiusSum = first.radius + second.radius;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared > radiusSum * radiusSum) {
    return undefined;
  }

  const distance = Math.sqrt(distanceSquared);
  if (distance === 0) {
    // Coincident centers: locked fallback normal (straight up), full
    // overlap depth, contact point on the first circle's boundary along
    // the normal.
    return Object.freeze({
      normal: Object.freeze({ x: 0, y: 1 }),
      depth: radiusSum,
      point: Object.freeze({ x: first.x, y: first.y + first.radius }),
    });
  }

  // From the second center toward the first: moves the first argument out
  // of the second.
  const normal: Vector2D = Object.freeze({ x: dx / distance, y: dy / distance });
  // Contact point: on the first circle's boundary, on the side facing the
  // second circle (opposite the push-out normal).
  return Object.freeze({
    normal,
    depth: radiusSum - distance,
    point: Object.freeze({
      x: first.x - normal.x * first.radius,
      y: first.y - normal.y * first.radius,
    }),
  });
}

/** Circle-AABB contact manifold. `undefined` when they do not touch. */
export function collideCircleAabb2D(circle: Circle2D, aabb: Aabb2D): CollisionHit2D | undefined {
  assertValidCircle2D(circle);
  assertValidAabb2D(aabb);

  const closest = closestPointOnAabb2D(circle, aabb);
  const dx = circle.x - closest.x;
  const dy = circle.y - closest.y;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared > circle.radius * circle.radius) {
    return undefined;
  }

  if (distanceSquared === 0) {
    // The circle center is inside the AABB: push out along the nearest
    // face; ties resolve left, top, right, bottom (locked).
    const left = circle.x - aabb.x;
    const right = aabb.x + aabb.width - circle.x;
    const top = circle.y - aabb.y;
    const bottom = aabb.y + aabb.height - circle.y;
    const minimum = Math.min(left, right, top, bottom);

    let normal: Vector2D;
    let point: Point2D;
    if (minimum === left) {
      normal = Object.freeze({ x: -1, y: 0 });
      point = Object.freeze({ x: aabb.x, y: circle.y });
    } else if (minimum === top) {
      normal = Object.freeze({ x: 0, y: -1 });
      point = Object.freeze({ x: circle.x, y: aabb.y });
    } else if (minimum === right) {
      normal = Object.freeze({ x: 1, y: 0 });
      point = Object.freeze({ x: aabb.x + aabb.width, y: circle.y });
    } else {
      normal = Object.freeze({ x: 0, y: 1 });
      point = Object.freeze({ x: circle.x, y: aabb.y + aabb.height });
    }
    return Object.freeze({
      normal,
      depth: minimum + circle.radius,
      point,
    });
  }

  const distance = Math.sqrt(distanceSquared);
  // From the closest AABB point toward the circle center: moves the circle
  // (the first argument) out of the AABB.
  const normal: Vector2D = Object.freeze({ x: dx / distance, y: dy / distance });
  return Object.freeze({
    normal,
    depth: circle.radius - distance,
    point: closest,
  });
}
