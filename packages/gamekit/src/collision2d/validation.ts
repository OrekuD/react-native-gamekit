/** Internal collision boundary validation; public errors come from geometry. */
import {
  assertNonnegativeSize,
  assertRecordShape,
  assertUnsigned32Bits,
  assertValidAabb2D,
  assertValidCircle2D,
  assertValidPoint2D,
  assertValidVector2D,
  GeometryError,
} from '../geometry/validation';
import type { ColliderMetadata2D, LocalCollider2D, WorldCollider2D } from './colliders';
import type { CollisionFilter2D } from './filters';
import type { CollisionHit2D } from './manifolds';

export function assertValidCollisionFilter2D(filter: CollisionFilter2D, name: string): void {
  assertRecordShape(filter, name);
  assertUnsigned32Bits(filter.categoryBits, `${name}.categoryBits`);
  assertUnsigned32Bits(filter.maskBits, `${name}.maskBits`);
}

export function assertOptionalString(value: string | undefined, name: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new GeometryError('GEOMETRY_INVALID_SHAPE', name, 'expected a string');
  }
}

/** The containing record is checked by the caller before its fields are read. */
export function assertValidColliderMetadata2D(metadata: ColliderMetadata2D, name = ''): void {
  const prefix = name === '' ? '' : `${name}.`;
  if (metadata.filter !== undefined) {
    assertValidCollisionFilter2D(metadata.filter, `${prefix}filter`);
  }
  if (metadata.sensor !== undefined && typeof metadata.sensor !== 'boolean') {
    throw new GeometryError('GEOMETRY_INVALID_SHAPE', `${prefix}sensor`, 'expected a boolean');
  }
  assertOptionalString(metadata.id, `${prefix}id`);
}

function assertColliderTags(
  collider: LocalCollider2D | WorldCollider2D,
  space: 'local' | 'world',
  name: string,
): void {
  if (collider.space !== space) {
    throw new GeometryError('GEOMETRY_INVALID_SHAPE', `${name}.space`, `expected '${space}'`);
  }
  if (collider.shape !== 'aabb' && collider.shape !== 'circle') {
    throw new GeometryError('GEOMETRY_INVALID_SHAPE', `${name}.shape`, "expected 'aabb' or 'circle'");
  }
}

export function assertValidLocalCollider2D(local: LocalCollider2D, name = 'local'): void {
  assertRecordShape(local, name);
  assertColliderTags(local, 'local', name);
  assertValidVector2D(local.offset, `${name}.offset`);
  if (local.shape === 'aabb') {
    assertNonnegativeSize(local.width, `${name}.width`);
    assertNonnegativeSize(local.height, `${name}.height`);
  } else {
    assertNonnegativeSize(local.radius, `${name}.radius`);
  }
  assertValidColliderMetadata2D(local, name);
}

export function assertValidWorldCollider2D(world: WorldCollider2D, name = 'world'): void {
  assertRecordShape(world, name);
  assertColliderTags(world, 'world', name);
  if (world.shape === 'aabb') {
    assertValidAabb2D(world, name);
  } else {
    assertValidCircle2D(world, name);
  }
  assertValidColliderMetadata2D(world, name);
}

export function assertValidCollisionHit2D(hit: CollisionHit2D): void {
  assertRecordShape(hit, 'hit');
  assertValidPoint2D(hit.point, 'hit.point');
  assertValidVector2D(hit.normal, 'hit.normal');
  assertNonnegativeSize(hit.depth, 'hit.depth');
}
