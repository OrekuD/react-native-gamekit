/**
 * `GameWorld2D` — the viewport transform group (T7.6).
 *
 * Applies the resolved viewport offset/scale exactly once to all child
 * sprites. It adds no camera state, subscribes no React per frame, and is
 * not a camera API. Raw Skia nodes may be nested inside.
 */
import type { ReactNode } from 'react';
import { Group } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

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

export function GameWorld2D({
  viewport,
  children,
}: {
  /** The resolved viewport shared value supplied to the renderer. */
  readonly viewport: SharedValue<ResolvedViewport2D | undefined>;
  readonly children: ReactNode;
}) {
  const transform = useDerivedValue(() => viewportTransform(viewport.value));
  return <Group transform={transform as never}>{children}</Group>;
}
