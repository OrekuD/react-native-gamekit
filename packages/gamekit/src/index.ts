export { createGameSession } from './core/session/createGameSession';
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
export type { Point2D } from './geometry/types';
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
