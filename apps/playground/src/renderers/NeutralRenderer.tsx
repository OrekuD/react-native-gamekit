import { Rect } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import type { GameRendererProps } from 'rn-gamekit/react';

/**
 * The neutral Home binding's renderer (T8.4).
 *
 * The persistent surface stays mounted after first use and shows a neutral
 * slot while Home is visible; this renderer paints the flat shell background
 * so the hidden surface never flashes a stale game frame.
 */
export function NeutralRenderer({ viewport }: GameRendererProps<never>) {
  const frame = useDerivedValue(() => {
    const surface = viewport.value;
    if (surface === undefined) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return surface.contentBounds;
  });
  // Skia consumes each scalar as a shared value, so nothing ever reads
  // `.value` on the JS thread during render.
  const x = useDerivedValue(() => frame.value.x);
  const y = useDerivedValue(() => frame.value.y);
  const width = useDerivedValue(() => frame.value.width);
  const height = useDerivedValue(() => frame.value.height);
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      color="#080b12"
    />
  );
}
