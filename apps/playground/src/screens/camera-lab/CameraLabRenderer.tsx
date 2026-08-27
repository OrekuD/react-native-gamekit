/**
 * Camera Lab renderer (T12.8).
 *
 * One Path node draws the visible markers (built per commit from the
 * headless culling result), one stroke Rect outlines the conservative
 * visible world bounds, and one Circle shows the pointer crosshair. All
 * coordinates are world units inside the camera-aware `GameWorld2D`; the
 * node topology is fixed — only shared values change.
 */
import { Circle, Path, Rect, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { GameWorld2D, type GameRendererProps } from 'rn-gamekit/react';

import { cameraLabDefinition, type CameraLabSnapshot } from './cameraLabGame';

type RendererProps = GameRendererProps<typeof cameraLabDefinition['scenes']>;

export function CameraLabRenderer({ frame, viewport, camera }: RendererProps) {
  const markerPath = useDerivedValue(() => {
    'worklet';
    const envelope = frame.value;
    if (envelope.scene !== 'lab') {
      return '';
    }
    const snap = envelope.current as unknown as CameraLabSnapshot;
    const visible = new Set(snap.visibleMarkerIds);
    const builder = Skia.PathBuilder.Make();
    for (const marker of snap.markers) {
      if (!visible.has(marker.id)) {
        continue;
      }
      builder.addRect(Skia.XYWHRect(marker.x - 6, marker.y - 6, 12, 12));
    }
    return builder.build();
  });

  const boundsX = useDerivedValue(() => {
    'worklet';
    const snap = frame.value.current as unknown as CameraLabSnapshot;
    return snap.debug ? snap.visibleBounds.x : 0;
  });
  const boundsY = useDerivedValue(() => {
    'worklet';
    const snap = frame.value.current as unknown as CameraLabSnapshot;
    return snap.debug ? snap.visibleBounds.y : 0;
  });
  const boundsW = useDerivedValue(() => {
    'worklet';
    const snap = frame.value.current as unknown as CameraLabSnapshot;
    return snap.debug ? snap.visibleBounds.width : 0;
  });
  const boundsH = useDerivedValue(() => {
    'worklet';
    const snap = frame.value.current as unknown as CameraLabSnapshot;
    return snap.debug ? snap.visibleBounds.height : 0;
  });

  const crossX = useDerivedValue(() => {
    'worklet';
    const snap = frame.value.current as unknown as CameraLabSnapshot;
    return snap.pointerWorld?.x ?? -100;
  });
  const crossY = useDerivedValue(() => {
    'worklet';
    const snap = frame.value.current as unknown as CameraLabSnapshot;
    return snap.pointerWorld?.y ?? -100;
  });

  return (
    <GameWorld2D viewport={viewport} camera={camera}>
      <Path path={markerPath} color="#eab308" style="fill" opacity={0.9} />
      <Rect
        x={boundsX}
        y={boundsY}
        width={boundsW}
        height={boundsH}
        color="#22c55e"
        style="stroke"
        strokeWidth={2}
      />
      <Circle cx={crossX} cy={crossY} r={6} color="#f87171" />
    </GameWorld2D>
  );
}

export type CameraLabRendererProps = RendererProps & {
  readonly alpha: SharedValue<number>;
};
