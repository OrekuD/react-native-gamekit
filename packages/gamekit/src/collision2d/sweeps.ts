/**
 * Swept collision queries (T11.3).
 *
 * `time` is normalized to `[0, 1]` along the displacement. A starting
 * overlap returns `time: 0` with the static manifold normal; zero
 * displacement returns `undefined` (never NaN); ties resolve to the
 * earliest impact deterministically. Misses allocate nothing.
 */
import type { Aabb2D, Circle2D, Point2D, Vector2D } from '../geometry/types';
import {
  assertValidAabb2D,
  assertValidCircle2D,
  assertValidVector2D,
} from '../geometry/validation';
import { collideAabbAabb2D, collideCircleAabb2D, type CollisionHit2D } from './manifolds';
import { intersectSegmentAabb2D } from './segments';

/** Earliest impact of a swept circle against an AABB. */
export interface SweepCircleAabb2DOptions {
  /** The moving circle at the start of the step. */
  readonly circle: Circle2D;
  /** Displacement over the step (velocity times delta time). */
  readonly displacement: Vector2D;
  /** The stationary target. */
  readonly target: Aabb2D;
}

/** Earliest impact of a swept AABB against an AABB. */
export interface SweepAabbAabb2DOptions {
  /** The moving AABB at the start of the step. */
  readonly aabb: Aabb2D;
  /** Displacement over the step. */
  readonly displacement: Vector2D;
  /** The stationary target. */
  readonly target: Aabb2D;
}

/** Earliest impact of a swept shape against a target. */
export interface SweepHit2D {
  /** Normalized impact time in `[0, 1]`. */
  readonly time: number;
  /** Unit normal moving the swept shape out of the target. */
  readonly normal: Vector2D;
  /** Contact point on the target at impact. */
  readonly point: Point2D;
}

/** Swept circle-AABB using the expanded-target segment method. */
export function sweepCircleAabb2D(options: SweepCircleAabb2DOptions): SweepHit2D | undefined {
  const { circle, displacement, target } = options;
  assertValidCircle2D(circle);
  assertValidVector2D(displacement, 'displacement');
  assertValidAabb2D(target, 'target');

  const startingOverlap = collideCircleAabb2D(circle, target);
  if (startingOverlap !== undefined) {
    return hitFromManifold(0, startingOverlap);
  }
  if (displacement.x === 0 && displacement.y === 0) {
    return undefined;
  }

  // Expand the target by the circle radius and sweep the circle's center
  // point against the expanded box.
  const expanded: Aabb2D = {
    x: target.x - circle.radius,
    y: target.y - circle.radius,
    width: target.width + circle.radius * 2,
    height: target.height + circle.radius * 2,
  };
  const segmentHit = intersectSegmentAabb2D(
    { start: { x: circle.x, y: circle.y }, end: { x: circle.x + displacement.x, y: circle.y + displacement.y } },
    expanded,
  );
  if (segmentHit === undefined) {
    return undefined;
  }

  const centerAtImpact = {
    x: circle.x + displacement.x * segmentHit.time,
    y: circle.y + displacement.y * segmentHit.time,
  };
  return Object.freeze({
    time: segmentHit.time,
    normal: segmentHit.normal,
    // Contact point on the ORIGINAL target: the closest point to the
    // circle center at impact.
    point: Object.freeze({
      x: clamp(centerAtImpact.x, target.x, target.x + target.width),
      y: clamp(centerAtImpact.y, target.y, target.y + target.height),
    }),
  });
}

/** Swept AABB-AABB using the expanded-target segment method. */
export function sweepAabbAabb2D(options: SweepAabbAabb2DOptions): SweepHit2D | undefined {
  const { aabb, displacement, target } = options;
  assertValidAabb2D(aabb, 'aabb');
  assertValidVector2D(displacement, 'displacement');
  assertValidAabb2D(target, 'target');

  const startingOverlap = collideAabbAabb2D(aabb, target);
  if (startingOverlap !== undefined) {
    return hitFromManifold(0, startingOverlap);
  }
  if (displacement.x === 0 && displacement.y === 0) {
    return undefined;
  }

  // Expand the target by the swept AABB's size and sweep its top-left
  // reference point.
  const expanded: Aabb2D = {
    x: target.x - aabb.width,
    y: target.y - aabb.height,
    width: target.width + aabb.width * 2,
    height: target.height + aabb.height * 2,
  };
  const segmentHit = intersectSegmentAabb2D(
    { start: { x: aabb.x, y: aabb.y }, end: { x: aabb.x + displacement.x, y: aabb.y + displacement.y } },
    expanded,
  );
  if (segmentHit === undefined) {
    return undefined;
  }

  const originAtImpact = {
    x: aabb.x + displacement.x * segmentHit.time,
    y: aabb.y + displacement.y * segmentHit.time,
  };
  return Object.freeze({
    time: segmentHit.time,
    normal: segmentHit.normal,
    point: Object.freeze({
      x: clamp(originAtImpact.x, target.x, target.x + target.width),
      y: clamp(originAtImpact.y, target.y, target.y + target.height),
    }),
  });
}

function hitFromManifold(time: number, hit: CollisionHit2D): SweepHit2D {
  return Object.freeze({
    time,
    normal: hit.normal,
    point: hit.point,
  });
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
