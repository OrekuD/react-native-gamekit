/**
 * Shared rotated half-extent arithmetic (GS-CAMERA-03).
 *
 * The conservative enclosing half-extents of a rotated visible rect:
 * `ex = |hx·cosθ| + |hy·sinθ|`, `ey = |hx·sinθ| + |hy·cosθ|`.
 *
 * Trusted scalars only: no validation, no errors, worklet-safe. Callers
 * validate at their own boundary (headless paths with the camera
 * validators) or consume already-validated values (UI paths that must
 * never construct errors per frame). Padding, parallax, and centering
 * stay per-system and explicit.
 */
export function rotatedHalfExtents2D(
  halfWidth: number,
  halfHeight: number,
  rotationRadians: number,
): { readonly x: number; readonly y: number } {
  'worklet';
  const cos = Math.abs(Math.cos(rotationRadians));
  const sin = Math.abs(Math.sin(rotationRadians));
  return {
    x: halfWidth * cos + halfHeight * sin,
    y: halfWidth * sin + halfHeight * cos,
  };
}
