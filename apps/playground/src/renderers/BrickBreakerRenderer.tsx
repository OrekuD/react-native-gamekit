import { Circle, Group, Rect } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import type { GameRendererProps } from 'react-native-gamekit/react';
import {
  BRICK_BREAKER_CONFIG,
  TOTAL_BRICKS,
  type BrickBreakerDefinition,
} from '../games/brickBreakerGame';
import { interpolateBall, interpolatePaddle } from './interpolation';

type RendererProps = GameRendererProps<BrickBreakerDefinition['scenes']>;

/**
 * Skia renderer with a fixed topology: a background, one paddle, one ball,
 * and a fixed set of brick rects. Every geometry value is derived from the
 * shared frame and viewport; dead bricks render with zero size so the
 * component tree never changes and React never sees live gameplay positions.
 */
export function BrickBreakerRenderer({
  frame,
  surfaceSize,
  viewport,
}: RendererProps) {
  const backgroundWidth = useDerivedValue(() => surfaceSize.value.width);
  const backgroundHeight = useDerivedValue(() => surfaceSize.value.height);
  return (
    <>
      <Rect
        x={0}
        y={0}
        width={backgroundWidth}
        height={backgroundHeight}
        color="#0f1420"
      />
      <Paddle frame={frame} viewport={viewport} />
      <Ball frame={frame} viewport={viewport} />
      <Bricks frame={frame} viewport={viewport} />
    </>
  );
}

function Paddle({ frame, viewport }: Pick<RendererProps, 'frame' | 'viewport'>) {
  const { paddle } = BRICK_BREAKER_CONFIG;
  const x = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    if (value.scene !== 'play' || surface === undefined) {
      return 0;
    }
    const worldX = interpolatePaddle(value.previous.paddle, value.current.paddle, value.alpha);
    return (worldX - paddle.width / 2) * surface.scale + surface.offsetX;
  });
  const y = useDerivedValue(() => {
    const surface = viewport.value;
    return surface === undefined ? 0 : paddle.y * surface.scale + surface.offsetY;
  });
  const width = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    return value.scene === 'play' && surface !== undefined ? paddle.width * surface.scale : 0;
  });
  const height = useDerivedValue(() => {
    const surface = viewport.value;
    return surface === undefined ? 0 : paddle.height * surface.scale;
  });
  return <Rect x={x} y={y} width={width} height={height} color="#e2e8f0" />;
}

function Ball({ frame, viewport }: Pick<RendererProps, 'frame' | 'viewport'>) {
  const { ball } = BRICK_BREAKER_CONFIG;
  const x = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    if (value.scene !== 'play' || surface === undefined) {
      return 0;
    }
    return interpolateBall(value.previous.ball, value.current.ball, value.alpha).x * surface.scale + surface.offsetX;
  });
  const y = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    if (value.scene !== 'play' || surface === undefined) {
      return 0;
    }
    return interpolateBall(value.previous.ball, value.current.ball, value.alpha).y * surface.scale + surface.offsetY;
  });
  const radius = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    return value.scene === 'play' && surface !== undefined ? ball.radius * surface.scale : 0;
  });
  const color = useDerivedValue(() => (frame.value.scene === 'play' ? '#a78bfa' : '#000000'));
  return <Circle cx={x} cy={y} r={radius} color={color} />;
}

function Bricks({ frame, viewport }: Pick<RendererProps, 'frame' | 'viewport'>) {
  const { columns } = BRICK_BREAKER_CONFIG.bricks;
  const rowColors = ['#f87171', '#fb923c', '#facc15', '#4ade80'];
  const bricks = [];
  for (let index = 0; index < TOTAL_BRICKS; index += 1) {
    bricks.push(
      <Brick
        key={index}
        index={index}
        color={rowColors[Math.floor(index / columns)] ?? '#f87171'}
        frame={frame}
        viewport={viewport}
      />,
    );
  }
  return <Group>{bricks}</Group>;
}

function Brick({
  index,
  color,
  frame,
  viewport,
}: {
  readonly index: number;
  readonly color: string;
  readonly frame: RendererProps['frame'];
  readonly viewport: RendererProps['viewport'];
}) {
  const x = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    const brick = value.scene === 'play' ? value.current.bricks[index] : undefined;
    return brick?.alive === true && surface !== undefined
      ? brick.x * surface.scale + surface.offsetX
      : 0;
  });
  const y = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    const brick = value.scene === 'play' ? value.current.bricks[index] : undefined;
    return brick?.alive === true && surface !== undefined
      ? brick.y * surface.scale + surface.offsetY
      : 0;
  });
  const width = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    const brick = value.scene === 'play' ? value.current.bricks[index] : undefined;
    return brick?.alive === true && surface !== undefined ? brick.width * surface.scale : 0;
  });
  const height = useDerivedValue(() => {
    const value = frame.value;
    const surface = viewport.value;
    const brick = value.scene === 'play' ? value.current.bricks[index] : undefined;
    return brick?.alive === true && surface !== undefined ? brick.height * surface.scale : 0;
  });
  return <Rect x={x} y={y} width={width} height={height} color={color} />;
}
