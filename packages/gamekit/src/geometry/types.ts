/**
 * Canonical 2D geometry values (T11.1).
 *
 * All shapes are immutable plain data in Gamekit's logical world
 * coordinates (positive x right, positive y down). `Aabb2D.x/y` identify the
 * minimum/top-left corner. Width, height, and radius are finite and
 * nonnegative; malformed values throw `GeometryError` at the public
 * operation boundary and never masquerade as "no collision".
 */

/** A plain 2D point in logical/world or surface coordinate space. */
export interface Point2D {
  /** Horizontal coordinate. */
  readonly x: number;
  /** Vertical coordinate. */
  readonly y: number;
}

/** A plain 2D vector (translation, displacement, or direction). */
export interface Vector2D {
  /** Horizontal component. */
  readonly x: number;
  /** Vertical component. */
  readonly y: number;
}

/**
 * An axis-aligned rectangle in logical world units.
 *
 * `x`/`y` are the top-left corner (the minimum corner in Gamekit's
 * positive-down convention). Shape-compatible with the viewport `Rect`
 * type: any `Rect` is also a valid `Aabb2D` by shape, and vice versa.
 */
export interface Aabb2D {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width, finite and nonnegative. */
  readonly width: number;
  /** Height, finite and nonnegative. */
  readonly height: number;
}

/** A circle in logical world units. */
export interface Circle2D {
  /** Center x. */
  readonly x: number;
  /** Center y. */
  readonly y: number;
  /** Radius, finite and nonnegative. */
  readonly radius: number;
}

/** A directed segment (ray-style query input). */
export interface Segment2D {
  /** Segment start point. */
  readonly start: Point2D;
  /** Segment end point. */
  readonly end: Point2D;
}
