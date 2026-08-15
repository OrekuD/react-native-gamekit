/**
 * Swept collision queries (T11.3, repaired in T11-F2, allocation-disciplined
 * in T11-FF7).
 *
 * `time` is normalized to `[0, 1]` along the displacement. A starting
 * overlap returns `time: 0` with the static manifold normal; zero
 * displacement returns `undefined` (never NaN). At equal times the
 * candidate evaluated FIRST wins — the X face before the Y face, faces
 * before corners, corners in index order (T11-TF1). Misses allocate
 * nothing.
 *
 * Circle-AABB sweeps raycast against the exact Minkowski geometry: the
 * target expanded by the radius with ROUNDED corners. Face candidates come
 * from the four expanded faces (valid only within the face's extent), and
 * corner candidates come from radius circles around each target corner
 * (valid only in the corner's exterior quadrant). AABB-AABB sweeps use the
 * asymmetric expansion for the moving AABB's top-left reference point —
 * the Minkowski sum of two AABBs is an AABB, so the slab method is exact.
 *
 * T11-FF7 allocation discipline: the four corner descriptors are derived
 * arithmetically from the corner index (no per-call arrays or predicate
 * closures), the two quadratic roots are evaluated as scalars, and the best
 * candidate is tracked in scalars; only the final public `SweepHit2D` is
 * allocated.
 */
import type { Aabb2D, Circle2D, Point2D, Vector2D } from '../geometry/types';
import {
  assertValidAabb2D,
  assertValidCircle2D,
  assertValidVector2D,
} from '../geometry/validation';
import { collideAabbAabb2D, collideCircleAabb2D, type CollisionHit2D } from './manifolds';
import { intersectsCircleAabb2D } from './intersections';
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

/**
 * Corner descriptors for index 0..3, derived arithmetically: bit 0 selects
 * the max-x face (else min-x) and bit 1 selects the max-y face (else
 * min-y). The quadrant validity of a hit point is the same bit test.
 */
function cornerFaceX(index: number, minX: number, maxX: number): number {
  return index & 1 ? maxX : minX;
}

function cornerFaceY(index: number, minY: number, maxY: number): number {
  return index & 2 ? maxY : minY;
}

function beyondFaceX(index: number, pointX: number, minX: number, maxX: number): boolean {
  return index & 1 ? pointX >= maxX : pointX <= minX;
}

function beyondFaceY(index: number, pointY: number, minY: number, maxY: number): boolean {
  return index & 2 ? pointY >= maxY : pointY <= minY;
}

/** Swept circle-AABB against the exact rounded-rectangle Minkowski shape. */
export function sweepCircleAabb2D(options: SweepCircleAabb2DOptions): SweepHit2D | undefined {
  const { circle, displacement, target } = options;
  assertValidCircle2D(circle);
  assertValidVector2D(displacement, 'displacement');
  assertValidAabb2D(target, 'target');

  // The starting-overlap check uses the allocation-free predicate; the
  // manifold (and its contact object) runs only after contact is confirmed
  // (T11-SF3).
  if (intersectsCircleAabb2D(circle, target)) {
    const overlap = collideCircleAabb2D(circle, target);
    if (overlap !== undefined) {
      return hitFromManifold(0, overlap);
    }
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

  // Scalar best-candidate tracking: nothing is allocated until a hit.
  let hasBest = false;
  let bestTime = 0;
  let bestNX = 0;
  let bestNY = 0;
  let bestPX = 0;
  let bestPY = 0;

  // Face candidates: the four expanded faces, valid within the face extent.
  // The accept logic is inlined as scalar updates (no local closure). A
  // candidate REPLACES only when strictly earlier; at equal times the
  // candidate evaluated first retains the result (T11-TF1).
  if (dx !== 0) {
    const faceX = dx > 0 ? minX - radius : maxX + radius;
    const time = (faceX - x0) / dx;
    const yAt = y0 + dy * time;
    if (yAt >= minY && yAt <= maxY && time >= 0 && time <= 1 && (!hasBest || bestTime > time)) {
      // The contact point is the closest point on the ORIGINAL target to
      // the impact position (both coordinates clamped).
      hasBest = true;
      bestTime = time;
      bestNX = dx > 0 ? -1 : 1;
      bestNY = 0;
      bestPX = clamp(faceX, minX, maxX);
      bestPY = clamp(yAt, minY, maxY);
    }
  }
  if (dy !== 0) {
    const faceY = dy > 0 ? minY - radius : maxY + radius;
    const time = (faceY - y0) / dy;
    const xAt = x0 + dx * time;
    if (xAt >= minX && xAt <= maxX && time >= 0 && time <= 1 && (!hasBest || bestTime > time)) {
      hasBest = true;
      bestTime = time;
      bestNX = 0;
      bestNY = dy > 0 ? -1 : 1;
      bestPX = clamp(xAt, minX, maxX);
      bestPY = clamp(faceY, minY, maxY);
    }
  }

  // Corner candidates: radius circles around each corner, valid in the
  // corner's exterior quadrant. The four descriptors are derived from the
  // corner index arithmetically; both quadratic roots are scalars.
  const a = dx * dx + dy * dy;
  for (let corner = 0; corner < 4; corner += 1) {
    const cornerX = cornerFaceX(corner, minX, maxX);
    const cornerY = cornerFaceY(corner, minY, maxY);
    const fx = x0 - cornerX;
    const fy = y0 - cornerY;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      continue;
    }
    const root = Math.sqrt(discriminant);
    const firstRoot = (-b - root) / (2 * a);
    const secondRoot = (-b + root) / (2 * a);
    for (let pass = 0; pass < 2; pass += 1) {
      const time = pass === 0 ? firstRoot : secondRoot;
      if (time < 0 || time > 1 || (hasBest && bestTime < time)) {
        continue;
      }
      const hitX = x0 + dx * time;
      const hitY = y0 + dy * time;
      if (!beyondFaceX(corner, hitX, minX, maxX) || !beyondFaceY(corner, hitY, minY, maxY)) {
        continue;
      }
      const outX = hitX - cornerX;
      const outY = hitY - cornerY;
      const outDistance = Math.hypot(outX, outY);
      const nx = outDistance === 0 ? 0 : outX / outDistance;
      const ny = outDistance === 0 ? 1 : outY / outDistance;
      if (!hasBest || time < bestTime) {
        hasBest = true;
        bestTime = time;
        bestNX = nx;
        bestNY = ny;
        bestPX = cornerX;
        bestPY = cornerY;
      }
    }
  }

  if (!hasBest) {
    return undefined;
  }
  return Object.freeze({
    time: bestTime,
    normal: Object.freeze({ x: bestNX, y: bestNY }),
    point: Object.freeze({ x: bestPX, y: bestPY }),
  });
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
