import type { ResolvedViewport2D } from 'react-native-gamekit';

/** A logical world point mapped onto the surface. */
export interface SurfacePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Map a logical world point onto the surface through the resolved viewport.
 *
 * The renderer applies this mapping once to a parent `Group` as
 * `translate(offsetX, offsetY)` then `scale(scale)` — the transform order is
 * pinned here so a transform-order mistake in the renderer fails loudly.
 */
export function surfacePoint(
  logical: { readonly x: number; readonly y: number },
  viewport: ResolvedViewport2D,
): SurfacePoint {
  return {
    x: logical.x * viewport.scale + viewport.offsetX,
    y: logical.y * viewport.scale + viewport.offsetY,
  };
}
