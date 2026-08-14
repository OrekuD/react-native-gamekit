import { Circle, Rect } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import type { GameRendererProps } from 'rn-gamekit/react';
import { paddleGame } from './game';

/**
 * Docs example renderer: draws the paddle and the ball in logical
 * coordinates, using the shared viewport for scale and letterbox offset.
 * The shared values are passed to Skia directly so they re-evaluate on the
 * UI runtime instead of triggering React re-renders.
 */
export function PaddleRenderer({
  frame,
  viewport,
}: GameRendererProps<typeof paddleGame['scenes']>) {
  const paddleX = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.paddle.x * surface.scale + surface.offsetX;
  });
  const paddleY = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.paddle.y * surface.scale + surface.offsetY;
  });
  const paddleWidth = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.paddle.width * surface.scale;
  });
  const paddleHeight = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.paddle.height * surface.scale;
  });

  const ballX = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.ball.x * surface.scale + surface.offsetX;
  });
  const ballY = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.ball.y * surface.scale + surface.offsetY;
  });
  const ballRadius = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.ball.radius * surface.scale;
  });

  return (
    <>
      <Rect
        x={paddleX}
        y={paddleY}
        width={paddleWidth}
        height={paddleHeight}
        color="#334155"
      />
      <Circle cx={ballX} cy={ballY} r={ballRadius} color="#0ea5e9" />
    </>
  );
}
