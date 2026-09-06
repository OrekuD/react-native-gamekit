/** Conservative world-space AABB used for presentation-only culling. */
import { rotatedHalfExtents2D } from '../../camera2d/extents';
import type { ParticleEffectDefinition } from '../../particles/types';
export interface WorldAabb {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const PARTICLE_CULL_PADDING = 16;

/**
 * The world region visible through the PRESENTED camera (T15-RF2).
 *
 * The logical viewport rectangle is rotated/zoomed by the camera, so its
 * axis-aligned world bounds are the center plus the rotated half-extents:
 *
 *   ex = |hx·cosθ| + |hy·sinθ|, ey = |hx·sinθ| + |hy·cosθ|
 *
 * which is the exact AABB of the rotated view rect. Padding is applied in
 * world units. Worklet-safe; shared by the shape Picture and Atlas paths so
 * their culling results cannot diverge.
 */
export function cameraVisibleWorldBounds(
  camera: SharedCamera | null,
  viewport: SharedViewport | null,
  pad: number,
): WorldAabb | undefined {
  'worklet';
  if (camera === null || viewport === null) return undefined;
  const view = viewport.value?.visibleLogicalBounds;
  const cam = camera.value?.camera;
  if (view === undefined || cam === undefined) return undefined;
  const hx = view.width / (2 * cam.zoom);
  const hy = view.height / (2 * cam.zoom);
  const extent = rotatedHalfExtents2D(hx, hy, cam.rotationRadians);
  const ex = extent.x + pad;
  const ey = extent.y + pad;
  return {
    minX: cam.center.x - ex,
    minY: cam.center.y - ey,
    maxX: cam.center.x + ex,
    maxY: cam.center.y + ey,
  };
}

export function screenVisibleBounds(
  width: number,
  height: number,
  pad: number,
): WorldAabb {
  'worklet';
  return { minX: -pad, minY: -pad, maxX: width + pad, maxY: height + pad };
}

/**
 * Viewport-only world bounds for presentation without a presented camera
 * (GS-PARTICLE-02): the tile layer's viewport-only path — the resolved
 * logical bounds expanded by world-unit padding. World particles inside an
 * ordinary viewport-only GameWorld2D render instead of failing closed.
 */
export function viewportWorldBounds(
  viewport: SharedViewport | null,
  pad: number,
): WorldAabb | undefined {
  'worklet';
  const view = viewport?.value?.visibleLogicalBounds;
  if (view === undefined) return undefined;
  return {
    minX: view.x - pad,
    minY: view.y - pad,
    maxX: view.x + view.width + pad,
    maxY: view.y + view.height + pad,
  };
}

/**
 * Circle-vs-bounds visibility (GS-PARTICLE-02): the particle's
 * conservative extent (bounding radius from geometry and scale endpoints)
 * expands the bounds, so partially crossing shapes stay visible while
 * fully outside shapes cull. Extra overscan stays in the bounds padding —
 * never folded into the shape extent. A missing bounds still hides.
 */
export function visibleInBounds(
  x: number,
  y: number,
  extent: number,
  b: WorldAabb | undefined,
): boolean {
  'worklet';
  if (b === undefined) return false;
  return x >= b.minX - extent && x <= b.maxX + extent && y >= b.minY - extent && y <= b.maxY + extent;
}

/**
 * Conservative per-effect cull extent (GS-PARTICLE-02): the bounding
 * radius of the authored geometry times the largest scale endpoint, so
 * rotation can never push drawn pixels past the culled region. Circles
 * use radius; rectangles and sprites use half the diagonal; absent
 * dimensions fall back to the render defaults. The legacy scale range
 * contributes its maximum; definitions without scale use 1.
 */
export function maxParticleExtent(definition: ParticleEffectDefinition): number {
  'worklet';
  let maxScale = 1;
  const scale = (definition as { scale?: { start: { max: number }; end: { max: number } } }).scale;
  if (scale !== undefined) {
    if (scale.start.max > maxScale) maxScale = scale.start.max;
    if (scale.end.max > maxScale) maxScale = scale.end.max;
  }
  const legacy = (
    definition as { scaleOverLife?: { max: number } }
  ).scaleOverLife;
  if (legacy !== undefined && legacy.max > maxScale) maxScale = legacy.max;
  const particle = definition.particle;
  if (particle.kind === 'sprite') {
    return (Math.hypot(particle.size.width, particle.size.height) / 2) * maxScale;
  }
  if (particle.shape === 'circle') {
    return (particle.radius ?? 3) * maxScale;
  }
  return (Math.hypot(particle.width ?? 6, particle.height ?? 6) / 2) * maxScale;
}
// keeping this pure module free of Reanimated/RN imports while accepting
// real SharedValue<CameraCut2D|ResolvedViewport2D> instances.
// Minimal structural mirrors of the shared refs the view layer passes in,
// keeping this pure module free of Reanimated/RN imports while accepting
// real SharedValue<CameraCut2D|ResolvedViewport2D> instances.
interface SharedCamera {
  readonly value?:
    | {
        readonly camera?: {
          readonly center: { readonly x: number; readonly y: number };
          readonly zoom: number;
          readonly rotationRadians: number;
        };
      }
    | undefined;
}
interface SharedViewport {
  readonly value?:
    | { readonly visibleLogicalBounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }
    | undefined;
}
