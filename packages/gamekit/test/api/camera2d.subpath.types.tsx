/**
 * Compile fixture: preferred imports from `rn-gamekit/camera2d`.
 */
import {
  cameraHalfExtents2D,
  clampCameraBounds2D,
  createCamera2D,
  filterCameraVisible2D,
  followCamera2D,
  getCameraVisibleBounds2D,
  interpolateCamera2D,
  interpolateCameraScalar2D,
  intersectsCameraView2D,
  logicalToWorld2D,
  paddedCameraBounds2D,
  sampleCameraShake2D,
  shortestRotationDelta2D,
  surfaceToWorld2D,
  worldToLogical2D,
  worldToSurface2D,
  type Camera2D,
  type CameraCut2D,
  type CameraShakeOptions2D,
  type FollowCamera2DOptions2D,
} from 'rn-gamekit/camera2d';
import type { Aabb2D, Point2D } from 'rn-gamekit/geometry';
import type { ResolvedViewport2D } from 'rn-gamekit';

const view: Aabb2D = { x: -80, y: -120, width: 160, height: 240 };
const cam: Camera2D = createCamera2D({ center: { x: 0, y: 0 }, zoom: 1 });
const cut: CameraCut2D = { camera: cam, cutId: 1 };
void cut;

const p: Point2D = worldToLogical2D({ x: 0, y: 0 }, cam, view);
void logicalToWorld2D(p, cam, view);
void getCameraVisibleBounds2D(cam, view);
void surfaceToWorld2D(p, {} as ResolvedViewport2D, cam);
void worldToSurface2D(p, {} as ResolvedViewport2D, cam);
void followCamera2D(cam, { x: 10, y: 10 }, {}, 1 / 60);
void clampCameraBounds2D(cam, { x: 0, y: 0, width: 1000, height: 1000 }, view);
void cameraHalfExtents2D(cam, view);
void sampleCameraShake2D(cam, { seed: 1, elapsedSeconds: 0.1, durationSeconds: 1, amplitude: 4 });
void interpolateCamera2D(cut, cut, 0.5);
void interpolateCameraScalar2D(cut, cut, 0.5);
void shortestRotationDelta2D(0, Math.PI);
void filterCameraVisible2D(
  [{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } }],
  cam,
  view,
);
void intersectsCameraView2D({ kind: 'aabb', bounds: { x: 0, y: 0, width: 10, height: 10 } }, cam, view);
void paddedCameraBounds2D(cam, view, 8);

type _Shake = CameraShakeOptions2D;
type _Follow = FollowCamera2DOptions2D;
void null as unknown as _Shake;
void null as unknown as _Follow;
