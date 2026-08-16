/**
 * Camera2D — the opt-in 2D camera system (Task 12).
 *
 * Pure, headless, native-free camera math shared by rendering and pointer
 * input: immutable camera values, forward and inverse transforms, follow,
 * bounds clamping, deterministic shake, presentation interpolation, and
 * conservative visibility culling. The React integration
 * (`defineGameCamera2D`, `GameView`, `GameWorld2D`, `GameLayer2D`) lives in
 * `src/react/`.
 */
export { createCamera2D, getCameraVisibleBounds2D, logicalToWorld2D, worldToLogical2D, worldToSurface2D, surfaceToWorld2D } from './transform';
export { interpolateCamera2D, interpolateCameraScalar2D, shortestRotationDelta2D } from './interpolation';
export { followCamera2D } from './follow';
export { clampCameraBounds2D, cameraHalfExtents2D } from './bounds';
export { sampleCameraShake2D } from './shake';
export {
  filterCameraVisible2D,
  intersectsCameraView2D,
  paddedCameraBounds2D,
  type CameraViewShape2D,
} from './visibility';
export type {
  Camera2D,
  CameraCut2D,
  CameraFollowAxisOptions2D,
  CameraShakeOptions2D,
  FollowCamera2DOptions2D,
} from './types';
