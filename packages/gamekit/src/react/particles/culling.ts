/** Conservative world-space AABB used for presentation-only culling. */
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
  const t = cam.rotationRadians;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const ex = Math.abs(hx * cos) + Math.abs(hy * sin) + pad;
  const ey = Math.abs(hx * sin) + Math.abs(hy * cos) + pad;
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

export function visibleInBounds(x: number, y: number, b: WorldAabb | undefined): boolean {
  'worklet';
  if (b === undefined) return false;
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

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
