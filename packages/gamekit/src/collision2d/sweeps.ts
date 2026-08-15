/**
 * Swept collision queries (T11.3, repaired in T11-F2).
 *
 * `time` is normalized to `[0, 1]` along the displacement. A starting
 * overlap returns `time: 0` with the static manifold normal; zero
 * displacement returns `undefined` (never NaN); ties resolve to the
 * earliest impact deterministically. Misses allocate nothing.
 *
 * Circle-AABB sweeps raycast against the exact Minkowski geometry: the
 * target expanded by the radius with ROUNDED corners. Face candidates come
 * from the four expanded faces (valid only within the face's extent), and
 * corner candidates come from radius circles around each target corner
 * (valid only in the corner's exterior quadrant). AABB-AABB sweeps use the
 * asymmetric expansion for the moving AABB's top-left reference point —
 * the Minkowski sum of two AABBs is an AABB, so the slab method is exact.
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

interface Candidate {
  readonly time: number;
  readonly normal: Vector2D;
  readonly point: Point2D;
}

/** Swept circle-AABB against the exact rounded-rectangle Minkowski shape. */
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

  const radius = circle.radius;
  const minX = target.x;
  const maxX = target.x + target.width;
  const minY = target.y;
  const maxY = target.y + target.height;
  const x0 = circle.x;
  const y0 = circle.y;
  const dx = displacement.x;
  const dy = displacement.y;

  let best: Candidate | undefined;

  // Face candidates: the four expanded faces, valid within the face extent.
  const considerFace = (time: number, x: number, y: number, normal: Vector2D): void => {
    if (time < 0 || time > 1) {
      return;
    }
    if (best !== undefined && best.time < time) {
      return;
    }
    const candidate: Candidate = {
      time,
      normal,
      point: Object.freeze({ x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) }),
    };
    best = best === undefined || time < best.time ? candidate : best;
  };
  if (dx !== 0) {
    const faceX = dx > 0 ? minX - radius : maxX + radius;
    const t = (faceX - x0) / dx;
    const yAt = y0 + dy * t;
    if (yAt >= minY && yAt <= maxY) {
      considerFace(t, faceX, yAt, Object.freeze({ x: dx > 0 ? -1 : 1, y: 0 }));
    }
  }
  if (dy !== 0) {
    const faceY = dy > 0 ? minY - radius : maxY + radius;
    const t = (faceY - y0) / dy;
    const xAt = x0 + dx * t;
    if (xAt >= minX && xAt <= maxX) {
      considerFace(t, xAt, faceY, Object.freeze({ x: 0, y: dy > 0 ? -1 : 1 }));
    }
  }

  // Corner candidates: radius circles around each corner, valid in the
  // corner's exterior quadrant.
  const corners: ReadonlyArray<{ readonly x: number; readonly y: number; readonly outsideX: (p: number) => boolean; readonly outsideY: (p: number) => boolean }> = [
    { x: minX, y: minY, outsideX: (p) => p <= minX, outsideY: (p) => p <= minY },
    { x: maxX, y: minY, outsideX: (p) => p >= maxX, outsideY: (p) => p <= minY },
    { x: minX, y: maxY, outsideX: (p) => p <= minX, outsideY: (p) => p >= maxY },
    { x: maxX, y: maxY, outsideX: (p) => p >= maxX, outsideY: (p) => p >= maxY },
  ];
  for (const corner of corners) {
    const fx = x0 - corner.x;
    const fy = y0 - corner.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      continue;
    }
    const root = Math.sqrt(discriminant);
    for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
      if (t < 0 || t > 1 || (best !== undefined && best.time < t)) {
        continue;
      }
      const hitX = x0 + dx * t;
      const hitY = y0 + dy * t;
      if (!corner.outsideX(hitX) || !corner.outsideY(hitY)) {
        continue;
      }
      const outX = hitX - corner.x;
      const outY = hitY - corner.y;
      const outDistance = Math.hypot(outX, outY);
      const normal: Vector2D =
        outDistance === 0
          ? Object.freeze({ x: 0, y: 1 })
          : Object.freeze({ x: outX / outDistance, y: outY / outDistance });
      const candidate: Candidate = {
        time: t,
        normal,
        point: Object.freeze({ x: corner.x, y: corner.y }),
      };
      if (best === undefined || t < best.time) {
        best = candidate;
      }
    }
  }

  if (best === undefined) {
    return undefined;
  }
  return Object.freeze({ time: best.time, normal: best.normal, point: best.point });
}

/** Swept AABB-AABB with the exact asymmetric reference expansion. */
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

  // Top-left reference: the valid x interval is [target.min - w, target.max]
  // and the valid y interval is [target.min - h, target.max] (asymmetric).
  const expanded: Aabb2D = {
    x: target.x - aabb.width,
    y: target.y - aabb.height,
    width: target.width + aabb.width,
    height: target.height + aabb.height,
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
