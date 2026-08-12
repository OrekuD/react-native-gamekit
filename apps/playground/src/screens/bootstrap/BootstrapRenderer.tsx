import { Circle } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import { type GameRendererProps } from 'react-native-gamekit/react';
import { bootstrapDefinition } from './bootstrapGame';

/**
 * Renderer authoring only logical coordinates; the shared viewport supplies
 * the scale and letterbox offset so drawing and hit testing agree.
 */
export function BootstrapRenderer({ frame, alpha, viewport }: GameRendererProps<typeof bootstrapDefinition['scenes']>) {
  const x = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    const worldX =
      value.previous.ball.x +
      (value.current.ball.x - value.previous.ball.x) * alpha.value;
    return worldX * surface.scale + surface.offsetX;
  });
  const y = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.ball.y * surface.scale + surface.offsetY;
  });
  const radius = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    return surface === undefined || value.scene !== 'play'
      ? 0
      : value.current.ball.radius * surface.scale;
  });
  const color = useDerivedValue(() => {
    const value = frame.value;
    return value.scene === 'play' ? value.current.ball.color : '#000000';
  });

  return <Circle cx={x} cy={y} r={radius} color={color} />;
}

/**
 * First end-to-end GameKit runtime and Skia playground.
 *
 * The screen owns one session for its lifetime: created on mount and disposed
 * exactly once on unmount.
 */
