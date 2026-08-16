/**
 * `GameWorld2D` — the viewport + camera transform group (T7.6, T12.5).
 *
 * Applies the resolved viewport offset/scale to all child sprites, and —
 * when the game opts into a camera — composes the presented camera
 * transform BEFORE the viewport. The group's element list maps world ->
 * surface directly; `GameLayer2D` children consume the same camera through
 * the world context and apply only their parallax correction, so layers
 * never double-apply the camera.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { Group } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { CameraCut2D } from '../../camera2d';
import type { ResolvedViewport2D } from '../../viewport2d/types';

/**
 * The viewport transform as a Skia element list:
 * `T(offset) · S(scale)` — logical units map to surface points.
 */
export function viewportTransform(viewport: ResolvedViewport2D | undefined): readonly (
  | { readonly translateX: number }
  | { readonly translateY: number }
  | { readonly scaleX: number }
  | { readonly scaleY: number }
)[] {
  'worklet';
  if (viewport === undefined) {
    return [];
  }
  return [
    { translateX: viewport.offsetX },
    { translateY: viewport.offsetY },
    { scaleX: viewport.scale },
    { scaleY: viewport.scale },
  ];
}

/**
 * The composed camera + viewport transform (T12.5).
 *
 * Skia applies the element list last-first, so the list below is the
 * forward mapping `surface = viewport(L + rotate(P - C, -R) * Z)`:
 * translate(-C) -> scale(Z) -> rotate(-R) -> translate(L) -> viewport.
 */
export function cameraViewportTransform2D(
  camera: CameraCut2D | undefined,
  viewport: ResolvedViewport2D | undefined,
): readonly (
  | { readonly translateX: number }
  | { readonly translateY: number }
  | { readonly scaleX: number }
  | { readonly scaleY: number }
  | { readonly rotate: number }
)[] {
  'worklet';
  if (camera === undefined || viewport === undefined) {
    return [];
  }
  const { center, zoom, rotationRadians } = camera.camera;
  const view = viewport.visibleLogicalBounds;
  const logicalX = view.x + view.width / 2;
  const logicalY = view.y + view.height / 2;
  return [
    { translateX: viewport.offsetX },
    { translateY: viewport.offsetY },
    { scaleX: viewport.scale },
    { scaleY: viewport.scale },
    { translateX: logicalX },
    { translateY: logicalY },
    { rotate: -rotationRadians },
    { scaleX: zoom },
    { scaleY: zoom },
    { translateX: -center.x },
    { translateY: -center.y },
  ];
}

/**
 * The parallax correction for one layer (T12.5).
 *
 * A layer with factor p draws with the camera whose effective center is
 * `C' = L + (C - L) * p` per axis. Since zoom and rotation apply fully at
 * every factor, the correction relative to the parent camera is exactly a
 * translation by `(C - L) * (1 - p)` in world units.
 */
export function layerParallaxTransform2D(
  camera: CameraCut2D | undefined,
  viewport: ResolvedViewport2D | undefined,
  parallaxX: number,
  parallaxY: number,
): readonly ({ readonly translateX: number } | { readonly translateY: number })[] {
  'worklet';
  if (camera === undefined || viewport === undefined) {
    return [];
  }
  const view = viewport.visibleLogicalBounds;
  const logicalX = view.x + view.width / 2;
  const logicalY = view.y + view.height / 2;
  const dx = (camera.camera.center.x - logicalX) * (1 - parallaxX);
  const dy = (camera.camera.center.y - logicalY) * (1 - parallaxY);
  const elements: ({ readonly translateX: number } | { readonly translateY: number })[] = [];
  if (dx !== 0) {
    elements.push({ translateX: dx });
  }
  if (dy !== 0) {
    elements.push({ translateY: dy });
  }
  return elements;
}

/** The camera + viewport context provided by `GameWorld2D`. */
export interface GameWorldContextValue {
  readonly viewport: SharedValue<ResolvedViewport2D | undefined>;
  readonly camera: SharedValue<CameraCut2D | undefined> | undefined;
}

export const GameWorldContext = createContext<GameWorldContextValue | null>(null);

export function GameWorld2D({
  viewport,
  camera,
  children,
}: {
  /** The resolved viewport shared value supplied to the renderer. */
  readonly viewport: SharedValue<ResolvedViewport2D | undefined>;
  /** The presented camera shared value (T12.5); absent keeps the viewport-only path. */
  readonly camera?: SharedValue<CameraCut2D | undefined> | undefined;
  readonly children: ReactNode;
}) {
  const transform = useDerivedValue(() =>
    camera === undefined
      ? viewportTransform(viewport.value)
      : cameraViewportTransform2D(camera.value, viewport.value),
  );
  const context = { viewport, camera };
  return (
    <GameWorldContext.Provider value={context}>
      <Group transform={transform as never}>{children}</Group>
    </GameWorldContext.Provider>
  );
}

/** Consume the world context; throws outside `GameWorld2D`. */
export function useGameWorldContext(): GameWorldContextValue {
  const context = useContext(GameWorldContext);
  if (context === null) {
    throw new Error('GameLayer2D must be rendered inside a GameWorld2D');
  }
  return context;
}
