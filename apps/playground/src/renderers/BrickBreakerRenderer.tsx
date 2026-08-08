import { Circle, Fill, Group, Rect, select } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import type { GameRendererProps } from 'react-native-gamekit/react';
import {
  BRICK_BREAKER_CONFIG,
  TOTAL_BRICKS,
  type BrickBreakerDefinition,
} from '../games/brickBreakerGame';
import { interpolatePaddle } from './interpolation';

type RendererProps = GameRendererProps<BrickBreakerDefinition['scenes']>;
type CommitValue = RendererProps['frame'];
type AlphaValue = RendererProps['alpha'];

const EMPTY_LIVENESS: Readonly<Record<string, number>> = Object.freeze({});

/**
 * Skia renderer with a fixed topology and a collapsed mapper graph (T6).
 *
 * Exactly four derived values drive the whole scene:
 *   1. `surfaceTransform` — the resolved viewport applied once to a parent
 *      Group (translate then scale, pinned by viewportTransform.test.ts);
 *      updates only on layout revisions.
 *   2. `paddleValue` — one grouped value per moving entity, consumed through
 *      Skia `select()` so a single mapper drives all four props.
 *   3. `ballValue` — same pattern; interpolation happens once on the UI
 *      runtime, composing T5's commit envelope with the UI alpha clock.
 *   4. `bricksLiveness` — brick geometry is static (fixed grid); only the
 *      liveness record changes, at commit frequency.
 *
 * Previous: 138 derived values (128 of them static brick geometry). Now: 4,
 * a 97% registration drop. Plain retained Rect nodes stay — 32 rectangles is
 * not evidence for an Atlas.
 */
export function BrickBreakerRenderer({ frame, alpha, viewport }: RendererProps) {
  const surfaceTransform = useDerivedValue(() => {
    const surface = viewport.value;
    if (surface === undefined) {
      return [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }];
    }
    return [
      { translateX: surface.offsetX },
      { translateY: surface.offsetY },
      { scale: surface.scale },
    ];
  });

  return (
    <>
      <Fill color="#0f1420" />
      <Group transform={surfaceTransform}>
        <Paddle frame={frame} alpha={alpha} />
        <Ball frame={frame} alpha={alpha} />
        <Bricks frame={frame} />
      </Group>
    </>
  );
}

function Paddle({
  frame,
  alpha,
}: {
  readonly frame: CommitValue;
  readonly alpha: AlphaValue;
}) {
  const { paddle } = BRICK_BREAKER_CONFIG;
  const value = useDerivedValue(() => {
    const commit = frame.value;
    if (commit.scene !== 'play') {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    const worldX = interpolatePaddle(commit.previous.paddle, commit.current.paddle, alpha.value);
    return {
      x: worldX - paddle.width / 2,
      y: paddle.y,
      w: paddle.width,
      h: paddle.height,
    };
  });
  return (
    <Rect
      x={select(value, 'x')}
      y={select(value, 'y')}
      width={select(value, 'w')}
      height={select(value, 'h')}
      color="#e2e8f0"
    />
  );
}

function Ball({ frame, alpha }: { readonly frame: CommitValue; readonly alpha: AlphaValue }) {
  const { ball } = BRICK_BREAKER_CONFIG;
  const value = useDerivedValue(() => {
    const commit = frame.value;
    if (commit.scene !== 'play') {
      return { x: 0, y: 0, r: 0 };
    }
    const previous = commit.previous.ball;
    const current = commit.current.ball;
    const t = alpha.value;
    // Scalar lerp on the UI runtime: one grouped value, no per-prop mappers.
    return {
      x: previous.x + (current.x - previous.x) * t,
      y: previous.y + (current.y - previous.y) * t,
      r: ball.radius,
    };
  });
  return <Circle cx={select(value, 'x')} cy={select(value, 'y')} r={select(value, 'r')} color="#a78bfa" />;
}

function Bricks({ frame }: { readonly frame: CommitValue }) {
  const { columns, rows, width, height, gapX, gapY, top } = BRICK_BREAKER_CONFIG.bricks;
  const rowColors = ['#f87171', '#fb923c', '#facc15', '#4ade80'];
  const liveness = useDerivedValue(() => {
    const commit = frame.value;
    if (commit.scene !== 'play') {
      return EMPTY_LIVENESS;
    }
    const result: Record<string, number> = {};
    const bricks = commit.current.bricks;
    for (let index = 0; index < bricks.length; index += 1) {
      result[index] = bricks[index]!.alive ? 1 : 0;
    }
    return result;
  });
  const bricks = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      bricks.push(
        <Rect
          key={index}
          x={column * (width + gapX)}
          y={top + row * (height + gapY)}
          width={width}
          height={height}
          opacity={select(liveness, String(index))}
          color={rowColors[row % rowColors.length] ?? '#f87171'}
        />,
      );
    }
  }
  return <Group>{bricks}</Group>;
}

// Keep TOTAL_BRICKS referenced so the fixed topology stays explicit if the
// config grid changes.
void TOTAL_BRICKS;
