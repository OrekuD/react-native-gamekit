/** The logical size of the game viewport in design points. */
export interface LogicalSize {
  /** Logical width in points. */
  readonly width: number;
  /** Logical height in points. */
  readonly height: number;
}

/** How the authored logical viewport maps onto the mounted surface. */
export type ViewportMode = 'fit' | 'fill' | 'extend-world';

/** The authored viewport configuration of a game. */
export interface Viewport {
  /** The logical coordinate space the game is authored against. */
  readonly logicalSize: LogicalSize;
  /** How the authored viewport scales onto the mounted game surface. */
  readonly mode: ViewportMode;
}

/** The actual mounted size of a game surface in React Native layout points. */
export interface SurfaceSize {
  /** Surface width in points. */
  readonly width: number;
  /** Surface height in points. */
  readonly height: number;
}

/** An axis-aligned rectangle in a coordinate space. */
export interface Rect {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/**
 * A resolved, immutable viewport mapping between logical/world coordinates
 * and surface coordinates.
 *
 * The transformation is linear: `surface = world * scale + offset`. All
 * fields are plain data and are safe to share between drawing and hit
 * testing.
 */
export interface ResolvedViewport2D {
  /** The surface size this viewport was resolved against. */
  readonly surfaceSize: SurfaceSize;
  /** The authored logical bounds: `{ x: 0, y: 0, width, height }`. */
  readonly logicalBounds: Rect;
  /** The portion of the logical/world space visible on the surface. */
  readonly visibleLogicalBounds: Rect;
  /** The surface region covered by visible world content. */
  readonly contentBounds: Rect;
  /** The one uniform scale from world units to surface points. */
  readonly scale: number;
  /** Horizontal translation offset in surface points. */
  readonly offsetX: number;
  /** Vertical translation offset in surface points. */
  readonly offsetY: number;
}
