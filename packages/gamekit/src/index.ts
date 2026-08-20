export {
  clampCameraBounds2D,
  createCamera2D,
  filterCameraVisible2D,
  followCamera2D,
  getCameraVisibleBounds2D,
  interpolateCamera2D,
  intersectsCameraView2D,
  logicalToWorld2D,
  sampleCameraShake2D,
  surfaceToWorld2D,
  worldToLogical2D,
  worldToSurface2D,
} from './camera2d';
export type {
  Camera2D,
  CameraCut2D,
  CameraShakeOptions2D,
  CameraViewShape2D,
  FollowCamera2DOptions2D,
} from './camera2d';
export { createGameSession } from './core/session/createGameSession';
export { GameEventError } from './events/errors';
export { defineGameEvents, gameEvent } from './events/defineGameEvents';
export { seedGameEvent } from './events/seed';
export type {
  AnyGameEventEnvelope,
  GameEventDefinitions,
  GameEventDescriptor,
  GameEventEmitter,
  GameEventEnvelope,
  GameEventMap,
  InferGameEventMap,
} from './events/types';
export { GameSessionDisposedError, GameSessionLifecycleError } from './core/session/types';
export type {
  ButtonState,
  InputController,
  InputFrame,
  PointerState,
} from './core/input/types';
export type {
  DeepReadonly,
  CommitFrame,
  GameRenderFrame,
  GameSession,
  GameSessionStatus,
  GameSubscription,
} from './core/session/types';
export {
  advanceSpriteAnimation,
  pauseSpriteAnimation,
  playSpriteAnimation,
  resetSpriteAnimation,
  resumeSpriteAnimation,
  setSpriteAnimationSpeed,
  startSpriteAnimation,
} from './sprites/spriteAnimationState';
export {
  sampleSpriteClipFrame,
  sampleSpriteClipFrameName,
  spriteClipDurationMs,
} from './sprites/sampleSpriteClip';
export type { SpriteAnimationState, SpriteClipNames } from './sprites/spriteAnimationState';
export { defineAssets, image, spriteSheet } from './assets/defineAssets';
export { GameAssetError } from './assets/errors';
export type {
  AssetDescriptor,
  AssetGroup,
  AssetGroupMap,
  AssetSourceHandle,
  BrandedAssetDescriptor,
  GameAssetLease,
  GameAssetManifest,
  ImageDescriptor,
  LoadedAssets,
  LoadedImage,
  LoadedSpriteSheet,
  ManifestOf,
  SpriteAnimationMode,
  SpriteClip,
  SpriteFrameRect,
  SpriteSheetDescriptor,
} from './assets/types';
export { defineGame } from './definition/defineGame';
export type {
  ButtonInputAction,
  GameDefinition,
  InputAction,
  InputMap,
  PointerInputAction,
  SceneDefinitionMarker,
  SceneMap,
} from './definition/types';
export { PAYLOAD_LIMITS } from './events/payload';
export * from './geometry';
export * from './collision2d';
export { defineScene } from './scene/defineScene';
export type {
  SceneDefinition,
  SceneSnapshot,
  SceneSnapshotContext,
  SceneTransitionController,
  SceneUpdate,
} from './scene/types';
export {
  containsSurfacePoint,
  resolveViewport2D,
  surfaceToWorld,
  worldToSurface,
} from './viewport2d';
export type {
  LogicalSize,
  Rect,
  ResolvedViewport2D,
  SurfaceSize,
  Viewport,
  ViewportMode,
} from './viewport2d';
