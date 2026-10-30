/**
 * Collision filters (T11.4).
 *
 * Symmetric category/mask filtering with unsigned 32-bit bit sets,
 * following the Box2D convention: two colliders are eligible only when each
 * category is included by the other mask. No bit positions are reserved.
 */
import type { Vector2D } from '../geometry/types';
import { assertValidCollisionFilter2D } from './validation';

/** Two explicit unsigned 32-bit bit sets for collision eligibility. */
export interface CollisionFilter2D {
  /** The bits this collider belongs to. */
  readonly categoryBits: number;
  /** The category bits this collider can collide with. */
  readonly maskBits: number;
}

/**
 * True when the two filters allow a collision (symmetric check).
 *
 * Invalid (non-unsigned-32-bit) values throw `GeometryError` before any
 * comparison; `false` never implies malformed input.
 */
export function canCollide2D(first: CollisionFilter2D, second: CollisionFilter2D): boolean {
  assertValidCollisionFilter2D(first, 'first');
  assertValidCollisionFilter2D(second, 'second');
  return (
    (first.categoryBits & second.maskBits) !== 0 &&
    (second.categoryBits & first.maskBits) !== 0
  );
}

/** A collider without a filter: eligible with everything. */
export const ALL_FILTER2D: CollisionFilter2D = Object.freeze({
  categoryBits: 0xffffffff,
  maskBits: 0xffffffff,
});

/** A collider that collides with nothing. */
export const NONE_FILTER2D: CollisionFilter2D = Object.freeze({
  categoryBits: 0,
  maskBits: 0,
});

export type { Vector2D };
