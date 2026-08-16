/**
 * Batch culling math (T12.6, T12-F5) — pure and worklet-safe, with no React
 * imports, so the benchmark and headless tests can import them directly.
 */
import type { CameraCut2D } from '../../camera2d';
import type { Aabb2D } from '../../geometry/types';
import type { ResolvedViewport2D } from '../../viewport2d/types';

/**
 * Conservative visible bounds for batch culling (T12.6).
 *
 * Worklet-safe inline version of the headless `paddedCameraBounds2D` —
 * the presented camera is already validated at the public boundary, so the
 * per-frame path allocates nothing and validates nothing.
 */
export function batchVisibleBounds2D(
  camera: CameraCut2D | undefined,
  viewport: ResolvedViewport2D | undefined,
  padding: number,
): Aabb2D | undefined {
  'worklet';
  if (camera === undefined || viewport === undefined) {
    return undefined;
  }
  const view = viewport.visibleLogicalBounds;
  const halfWidth = view.width / 2 / camera.camera.zoom;
  const halfHeight = view.height / 2 / camera.camera.zoom;
  const cos = Math.abs(Math.cos(camera.camera.rotationRadians));
  const sin = Math.abs(Math.sin(camera.camera.rotationRadians));
  const extentX = halfWidth * cos + halfHeight * sin + padding;
  const extentY = halfWidth * sin + halfHeight * cos + padding;
  return {
    x: camera.camera.center.x - extentX,
    y: camera.camera.center.y - extentY,
    width: extentX * 2,
    height: extentY * 2,
  };
}

/** Axis-aligned intersection test, worklet-safe (no validation).
 *
 * Inclusive comparisons, matching the public `intersectsAabbAabb2D`
 * contract (T12-F5): exact boundary contact IS an intersection, so a
 * sprite touching the camera edge is never culled.
 *
 * T12-RF6 malformed-bounds fail-safe: any non-finite field or negative
 * size in EITHER rect hides the item (returns false) before the
 * intersection test — invalid geometry is never drawn. Scalar and
 * allocation-free; no structured error construction on the UI path.
 */
export function intersectsBounds2D(first: Aabb2D, second: Aabb2D): boolean {
  'worklet';
  if (!isFiniteBounds(first) || !isFiniteBounds(second)) {
    return false;
  }
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
}

function isFiniteBounds(bounds: Aabb2D): boolean {
  'worklet';
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width >= 0 &&
    bounds.height >= 0
  );
}
