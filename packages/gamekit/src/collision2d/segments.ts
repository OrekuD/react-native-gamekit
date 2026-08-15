/**
 * Segment queries (T11.3).
 *
 * Return the earliest crossing of a directed segment with a shape, with
 * `time` in `[0, 1]`. A segment starting inside a shape returns `time: 0`
 * with the deterministic nearest-face normal (same tie rule as the
 * manifolds: left, top, right, bottom for AABBs; the outward radial
 * direction for circles with the `(0, 1)` fallback at the center).
 */
import type { Aabb2D, Circle2D, Point2D, Segment2D, Vector2D } from '../geometry/types';
import {
  assertValidAabb2D,
  assertValidCircle2D,
  assertValidSegment2D,
} from '../geometry/validation';
import { pointInAabb2D, pointInCircle2D } from './intersections';

/** Earliest segment crossing of a shape. */
export interface SegmentHit2D {
  /** Normalized crossing time in `[0, 1]`. */
  readonly time: number;
  /** Unit normal at the crossed boundary (nearest-face rule inside). */
  readonly normal: Vector2D;
  /** Crossing point in world coordinates. */
  readonly point: Point2D;
}

/** Earliest crossing of a segment with an AABB (slab method). */
export function intersectSegmentAabb2D(segment: Segment2D, aabb: Aabb2D): SegmentHit2D | undefined {
  assertValidSegment2D(segment);
  assertValidAabb2D(aabb);

  if (pointInAabb2D(segment.start, aabb)) {
    return insideStart(segment.start, aabb);
  }

  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const minX = aabb.x;
  const maxX = aabb.x + aabb.width;
  const minY = aabb.y;
  const maxY = aabb.y + aabb.height;

  let tMin = 0;
  let tMax = 1;
  let entryAxis: 'x' | 'y' | undefined;
  let entrySign = 0;

  for (const axis of ['x', 'y'] as const) {
    const origin = axis === 'x' ? segment.start.x : segment.start.y;
    const delta = axis === 'x' ? dx : dy;
    const min = axis === 'x' ? minX : minY;
    const max = axis === 'x' ? maxX : maxY;
    if (delta === 0) {
      if (origin <= min || origin >= max) {
        // Parallel and outside the slab, or grazing exactly along a
        // boundary: neither is a crossing.
        return undefined;
      }
      continue;
    }
    const tMinFace = (min - origin) / delta;
    const tMaxFace = (max - origin) / delta;
    const t1 = Math.min(tMinFace, tMaxFace);
    const t2 = Math.max(tMinFace, tMaxFace);
    if (t1 > tMin) {
      tMin = t1;
      entryAxis = axis;
      // The outward normal of the face crossed first: the min face points
      // -axis, the max face points +axis.
      entrySign = t1 === tMinFace ? -1 : 1;
    }
    tMax = Math.min(tMax, t2);
    if (tMax < tMin) {
      return undefined;
    }
  }

  if (entryAxis === undefined) {
    return undefined; // The segment travels along the boundary without crossing.
  }
  const atX = segment.start.x + dx * tMin;
  const atY = segment.start.y + dy * tMin;
  const normal: Vector2D =
    entryAxis === 'x'
      ? Object.freeze({ x: entrySign, y: 0 })
      : Object.freeze({ x: 0, y: entrySign });
  return Object.freeze({
    time: tMin,
    normal,
    point: Object.freeze({ x: atX, y: atY }),
  });
}

/** A segment starting inside an AABB: time 0 with the nearest-face normal. */
function insideStart(point: Point2D, aabb: Aabb2D): SegmentHit2D {
  const left = point.x - aabb.x;
  const right = aabb.x + aabb.width - point.x;
  const top = point.y - aabb.y;
  const bottom = aabb.y + aabb.height - point.y;
  const minimum = Math.min(left, right, top, bottom);
  let normal: Vector2D;
  if (minimum === left) {
    normal = Object.freeze({ x: -1, y: 0 });
  } else if (minimum === top) {
    normal = Object.freeze({ x: 0, y: -1 });
  } else if (minimum === right) {
    normal = Object.freeze({ x: 1, y: 0 });
  } else {
    normal = Object.freeze({ x: 0, y: 1 });
  }
  return Object.freeze({
    time: 0,
    normal,
    point: Object.freeze({ x: point.x, y: point.y }),
  });
}

/** Earliest crossing of a segment with a circle. */
export function intersectSegmentCircle2D(
  segment: Segment2D,
  circle: Circle2D,
): SegmentHit2D | undefined {
  assertValidSegment2D(segment);
  assertValidCircle2D(circle);

  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const fx = segment.start.x - circle.x;
  const fy = segment.start.y - circle.y;

  if (pointInCircle2D(segment.start, circle)) {
    const distanceSquared = fx * fx + fy * fy;
    const distance = Math.sqrt(distanceSquared);
    const normal: Vector2D =
      distance === 0
        ? Object.freeze({ x: 0, y: 1 })
        : Object.freeze({ x: -fx / distance, y: -fy / distance });
    return Object.freeze({
      time: 0,
      normal,
      point: Object.freeze({ x: segment.start.x, y: segment.start.y }),
    });
  }

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - circle.radius * circle.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return undefined;
  }

  const root = Math.sqrt(discriminant);
  const t = (-b - root) / (2 * a);
  if (t < 0 || t > 1) {
    return undefined;
  }

  const atX = segment.start.x + dx * t;
  const atY = segment.start.y + dy * t;
  const outX = atX - circle.x;
  const outY = atY - circle.y;
  const outDistance = Math.hypot(outX, outY);
  const normal: Vector2D =
    outDistance === 0
      ? Object.freeze({ x: 0, y: 1 })
      : Object.freeze({ x: outX / outDistance, y: outY / outDistance });
  return Object.freeze({
    time: t,
    normal,
    point: Object.freeze({ x: atX, y: atY }),
  });
}
