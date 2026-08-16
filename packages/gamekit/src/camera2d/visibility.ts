/**
 * Camera2D visibility (T12.6).
 *
 * Presentation-only culling: computes what the camera can see and filters
 * render records without changing simulation. An off-screen entity keeps
 * simulating, colliding, and re-entering view. For rotated cameras the
 * broad test uses the conservative visible AABB (a superset of the actual
 * view polygon), so false positives are possible but false negatives are
 * not — a visible object can never pop out.
 */
import type { Aabb2D, Circle2D, Point2D } from '../geometry/types';
import { assertFiniteNumber, assertNonnegativeSize, GeometryError } from '../geometry/validation';
import { intersectsAabbAabb2D, intersectsCircleAabb2D, pointInAabb2D } from '../collision2d/index';
import { getCameraVisibleBounds2D } from './transform';
import type { Camera2D } from './types';
import { assertValidCamera2D, assertValidLogicalView, assertNonnegativePadding } from './validation';

function assertPointPayload(value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      field,
      `expected a point record, got ${value === null ? 'null' : typeof value}`,
    );
  }
  const typed = value as { x?: unknown; y?: unknown };
  assertFiniteNumber(typed.x as number, `${field}.x`);
  assertFiniteNumber(typed.y as number, `${field}.y`);
}

function assertShapeRecord(shape: unknown): asserts shape is CameraViewShape2D {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'shape',
      `expected a visibility shape record, got ${shape === null ? 'null' : typeof shape}`,
    );
  }
  const kind = (shape as { kind?: unknown }).kind;
  // T12-SF3: the payload is validated with Camera2D-prefixed nested paths
  // BEFORE any Collision2D predicate dereferences it.
  switch (kind) {
    case 'aabb':
      assertItemBounds((shape as { bounds?: unknown }).bounds, 'shape.bounds');
      return;
    case 'circle': {
      const circle = (shape as { circle?: unknown }).circle;
      if (typeof circle !== 'object' || circle === null || Array.isArray(circle)) {
        throw new GeometryError(
          'GEOMETRY_INVALID_NUMBER',
          'shape.circle',
          `expected a circle record, got ${circle === null ? 'null' : typeof circle}`,
        );
      }
      const typed = circle as { x?: unknown; y?: unknown; radius?: unknown };
      assertFiniteNumber(typed.x as number, 'shape.circle.x');
      assertFiniteNumber(typed.y as number, 'shape.circle.y');
      assertNonnegativeSize(typed.radius as number, 'shape.circle.radius');
      return;
    }
    case 'point':
      assertPointPayload((shape as { point?: unknown }).point, 'shape.point');
      return;
    default:
      throw new GeometryError(
        'GEOMETRY_INVALID_NUMBER',
        'shape.kind',
        `expected 'aabb' | 'circle' | 'point', got ${String(kind)}`,
      );
  }
}

function assertItemBounds(bounds: unknown, field = 'items.bounds'): asserts bounds is Aabb2D {
  if (typeof bounds !== 'object' || bounds === null || Array.isArray(bounds)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      field,
      `expected a rect record, got ${bounds === null ? 'null' : typeof bounds}`,
    );
  }
  const typed = bounds as Aabb2D;
  assertFiniteNumber(typed.x, `${field}.x`);
  assertFiniteNumber(typed.y, `${field}.y`);
  assertNonnegativeSize(typed.width, `${field}.width`);
  assertNonnegativeSize(typed.height, `${field}.height`);
}

function assertItemsArray(items: unknown): asserts items is readonly { readonly id: string; readonly bounds: Aabb2D }[] {
  if (!Array.isArray(items)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'items',
      `expected an array of indexed records, got ${items === null ? 'null' : typeof items}`,
    );
  }
  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new GeometryError('GEOMETRY_INVALID_NUMBER', 'items', 'expected item records');
    }
    const typed = item as { readonly id?: unknown; readonly bounds?: unknown };
    if (typeof typed.id !== 'string') {
      throw new GeometryError('GEOMETRY_INVALID_NUMBER', 'items.id', 'expected a string id');
    }
    assertItemBounds(typed.bounds);
  }
}

/** A shape queryable against the camera view. */
export type CameraViewShape2D =
  | { readonly kind: 'aabb'; readonly bounds: Aabb2D }
  | { readonly kind: 'circle'; readonly circle: Circle2D }
  | { readonly kind: 'point'; readonly point: Point2D };

/** The visible world bounds expanded by an optional padding. */
export function paddedCameraBounds2D(
  camera: Camera2D,
  logicalView: Aabb2D,
  padding = 0,
): Aabb2D {
  assertValidCamera2D(camera);
  assertValidLogicalView(logicalView);
  assertNonnegativePadding(padding);
  const bounds = getCameraVisibleBounds2D(camera, logicalView);
  return Object.freeze({
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  });
}

/**
 * Whether a shape intersects the camera's visible region.
 *
 * The test is conservative: it uses the visible world AABB (exact for
 * unrotated cameras, a superset for rotated ones). `padding` extends the
 * region in world units for sprites and effects that draw outside their
 * logical bounds.
 */
export function intersectsCameraView2D(
  shape: CameraViewShape2D,
  camera: Camera2D,
  logicalView: Aabb2D,
  padding = 0,
): boolean {
  assertShapeRecord(shape);
  const visible = paddedCameraBounds2D(camera, logicalView, padding);
  switch (shape.kind) {
    case 'aabb':
      return intersectsAabbAabb2D(shape.bounds, visible);
    case 'circle':
      return intersectsCircleAabb2D(shape.circle, visible);
    case 'point':
      return pointInAabb2D(shape.point, visible);
  }
}

/**
 * Filter indexed render records, preserving stable order.
 *
 * Returns a frozen copy containing only the records whose world bounds
 * intersect the visible region (plus `padding`). Off-screen records keep
 * their identity and order in the caller's array; nothing here mutates
 * them or changes simulation.
 */
export function filterCameraVisible2D<T extends { readonly id: string; readonly bounds: Aabb2D }>(
  items: readonly T[],
  camera: Camera2D,
  logicalView: Aabb2D,
  padding = 0,
): readonly T[] {
  assertItemsArray(items as unknown);
  const visible = paddedCameraBounds2D(camera, logicalView, padding);
  const kept: T[] = [];
  for (const item of items) {
    if (intersectsAabbAabb2D(item.bounds, visible)) {
      kept.push(item);
    }
  }
  return Object.freeze(kept);
}
