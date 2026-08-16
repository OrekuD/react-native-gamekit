/**
 * `GameLayer2D` — an ordered parallax layer (T12.5).
 *
 * A small rendering primitive, not a scene graph: the layer draws its
 * children with the presented camera whose center contribution is scaled
 * per axis by the parallax factor. JSX order is render order; no z-index
 * scheduler exists.
 *
 * Frozen policy: parallax scales only the camera center contribution. Zoom
 * and rotation apply fully at every factor; factor 1 is the primary layer,
 * factor 0 is camera-fixed on that axis. The correction is a pure
 * translation relative to the parent camera, so layers never double-apply
 * zoom or rotation.
 */
import type { ReactNode } from 'react';
import { Group } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import { layerParallaxTransform2D, useGameWorldContext } from '../sprites/GameWorld2D';

function assertFiniteParallax(value: number, axis: 'x' | 'y'): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`GameLayer2D parallax.${axis} must be finite, got ${String(value)}`);
  }
}

export function GameLayer2D({
  parallax = { x: 1, y: 1 },
  children,
}: {
  /** Per-axis parallax factor; defaults to the primary layer `{ x: 1, y: 1 }`. */
  readonly parallax?: { readonly x: number; readonly y: number };
  readonly children: ReactNode;
}) {
  assertFiniteParallax(parallax.x, 'x');
  assertFiniteParallax(parallax.y, 'y');
  const { viewport, camera } = useGameWorldContext();
  const transform = useDerivedValue(() => {
    'worklet';
    return layerParallaxTransform2D(camera?.value, viewport.value, parallax.x, parallax.y);
  });
  return <Group transform={transform as never}>{children}</Group>;
}
