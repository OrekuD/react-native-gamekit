/**
 * Static intersection predicates (T11.2).
 *
 * Boundary contact counts as intersection. Invalid geometry throws
 * `GeometryError`; `false` means normal domain absence. All predicates
 * allocate nothing.
 */
import type { Aabb2D, Circle2D, Point2D } from '../geometry/types';
import {
  assertValidAabb2D,
  assertValidCircle2D,
  assertValidPoint2D,
} from '../geometry/validation';

/** True when `point` lies in or on `aabb` (boundary inclusive). */
export function pointInAabb2D(point: Point2D, aabb: Aabb2D): boolean {
  assertValidPoint2D(point, 'point');
  assertValidAabb2D(aabb);
  return (
    point.x >= aabb.x &&
    point.x <= aabb.x + aabb.width &&
    point.y >= aabb.y &&
    point.y <= aabb.y + aabb.height
  );
}

/** True when `point` lies in or on `circle` (boundary inclusive). */
export function pointInCircle2D(point: Point2D, circle: Circle2D): boolean {
  assertValidPoint2D(point, 'point');
  assertValidCircle2D(circle);
  const dx = point.x - circle.x;
  const dy = point.y - circle.y;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

/** True when the two AABBs intersect or touch. */
export function intersectsAabbAabb2D(first: Aabb2D, second: Aabb2D): boolean {
  assertValidAabb2D(first, 'first');
  assertValidAabb2D(second, 'second');
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
}

/** True when the two circles intersect or touch. */
export function intersectsCircleCircle2D(first: Circle2D, second: Circle2D): boolean {
  assertValidCircle2D(first, 'first');
  assertValidCircle2D(second, 'second');
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const radiusSum = first.radius + second.radius;
  return dx * dx + dy * dy <= radiusSum * radiusSum;
}

/** True when the circle intersects or touches the AABB. */
export function intersectsCircleAabb2D(circle: Circle2D, aabb: Aabb2D): boolean {
  assertValidCircle2D(circle);
  assertValidAabb2D(aabb);
  const closestX = clamp(circle.x, aabb.x, aabb.x + aabb.width);
  const closestY = clamp(circle.y, aabb.y, aabb.y + aabb.height);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

/** Closest point on the AABB to the circle center (shared by manifold code). */
export function closestPointOnAabb2D(
  point: Point2D,
  aabb: Aabb2D,
): { readonly x: number; readonly y: number } {
  return {
    x: clamp(point.x, aabb.x, aabb.x + aabb.width),
    y: clamp(point.y, aabb.y, aabb.y + aabb.height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
