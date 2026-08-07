import type { Point2D } from '../src/geometry/types';
import type { ResolvedViewport2D } from '../src/viewport2d/index';

declare const point: Point2D;
point.x satisfies number;
point.y satisfies number;
// @ts-expect-error points are readonly
point.x = 0;

declare const viewport: ResolvedViewport2D;
viewport.scale satisfies number;
viewport.offsetX satisfies number;
viewport.offsetY satisfies number;
viewport.surfaceSize.width satisfies number;
viewport.logicalBounds.width satisfies number;
viewport.visibleLogicalBounds.height satisfies number;
viewport.contentBounds.x satisfies number;
// @ts-expect-error resolved viewport values are readonly
viewport.scale = 2;
// @ts-expect-error resolved viewport values are readonly
viewport.contentBounds.x = 0;
// @ts-expect-error resolved viewport values are readonly
viewport.surfaceSize.width = 390;

// Docs example: `resolveViewport2D` returns undefined until the surface has
// positive size, so the possibly-undefined result must be narrowed before use.
import { resolveViewport2D, surfaceToWorld } from '../src/viewport2d/index';

const docsViewport = resolveViewport2D(
  { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  { width: 390, height: 844 },
);
if (docsViewport !== undefined) {
  const world = surfaceToWorld(docsViewport, { x: 195, y: 400 });
  world.x satisfies number;
  world.y satisfies number;
}
