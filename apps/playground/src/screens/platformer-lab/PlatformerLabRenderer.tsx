/**
 * Platformer Lab renderer: tile layers through stable Atlas batches plus a
 * player rect and deterministic checkpoint markers, all presented inside
 * the camera-aware world. Every drawn value comes from committed session
 * frames or the presented camera — never from React state.
 */
import { Circle, Rect } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { GameWorld2D, TileMapLayer2D, type GameRendererProps } from 'rn-gamekit/react';

import {
  PLATFORMER_LAB_CONFIG,
  platformerLabAssets,
  platformerLabDefinition,
  platformerLabLevel,
  type PlatformerLabSnapshot,
} from './platformerLabGame';

type RendererProps = GameRendererProps<typeof platformerLabDefinition['scenes']>;

const C = PLATFORMER_LAB_CONFIG.cellSize;

/** Sheet frames: one 32x32 cell per tile, laid out horizontally. */
export const PLATFORMER_LAB_FRAMES = {
  ground: { x: 0, y: 0, width: C, height: C },
  brick: { x: 32, y: 0, width: C, height: C },
  oneway: { x: 64, y: 0, width: C, height: C },
  cloud: { x: 96, y: 0, width: C, height: C },
} as const;

const OFFSCREEN_SNAPSHOT: PlatformerLabSnapshot = {
  body: { x: -100, y: -100, width: 24, height: 28 },
  onGround: false,
  facingRight: true,
  contacts: { floor: false, leftWall: false, rightWall: false, ceiling: false },
  checkpoints: PLATFORMER_LAB_CONFIG.checkpoints.map((x) => ({ x, reached: false })),
  elapsed: 0,
  ticks: 0,
};

type FrameSV = RendererProps['frame'];
function snapshotOf(frame: FrameSV): PlatformerLabSnapshot {
  'worklet';
  const envelope = frame.value;
  return envelope.scene !== 'lab'
    ? OFFSCREEN_SNAPSHOT
    : (envelope.current as unknown as PlatformerLabSnapshot);
}

export function PlatformerLabRenderer({ frame, viewport, camera, assets }: RendererProps) {
  const tiles = assets?.get(platformerLabAssets.world.tiles);

  const bodyX = useDerivedValue(() => {
    'worklet';
    return snapshotOf(frame).body.x;
  });
  const bodyY = useDerivedValue(() => {
    'worklet';
    return snapshotOf(frame).body.y;
  });
  const bodyW = useDerivedValue(() => {
    'worklet';
    return snapshotOf(frame).body.width;
  });
  const bodyH = useDerivedValue(() => {
    'worklet';
    return snapshotOf(frame).body.height;
  });
  // Debug floor indicator: dot under the player only while grounded.
  const indicatorY = useDerivedValue(() => {
    'worklet';
    const snap = snapshotOf(frame);
    return snap.contacts.floor ? snap.body.y + snap.body.height + 4 : -10000;
  });
  // Checkpoint markers dim until every one is reached.
  const markerOpacity = useDerivedValue(() => {
    'worklet';
    return snapshotOf(frame).checkpoints.every((cp) => cp.reached) ? 1 : 0.35;
  });

  return (
    <GameWorld2D viewport={viewport} camera={camera}>
      {/* Parallax background: decorative clouds move at half speed. The
          layer owns the whole parallax contract — visual transform AND
          culling derive from the same factor (T16-RF2). */}
      <TileMapLayer2D
        map={platformerLabLevel}
        layer="clouds"
        source={{ image: tiles as never, frames: PLATFORMER_LAB_FRAMES }}
        width={PLATFORMER_LAB_CONFIG.logicalWidth}
        height={PLATFORMER_LAB_CONFIG.logicalHeight}
        overscan={1}
        parallax={{ x: 0.5, y: 0.5 }}
      />
      {/* Primary terrain layer locked to the world (parallax 1). */}
      <TileMapLayer2D
        map={platformerLabLevel}
        layer="terrain"
        source={{ image: tiles as never, frames: PLATFORMER_LAB_FRAMES }}
        width={PLATFORMER_LAB_CONFIG.logicalWidth}
        height={PLATFORMER_LAB_CONFIG.logicalHeight}
        overscan={1}
      />
      {/* Deterministic checkpoint markers at fixed world x positions. */}
      {PLATFORMER_LAB_CONFIG.checkpoints.map((cx) => (
        <Rect
          key={`cp-${cx}`}
          x={cx - 4}
          y={(PLATFORMER_LAB_CONFIG.mapRows - 3) * C - 48}
          width={8}
          height={48}
          color="#fbbf24"
          opacity={markerOpacity as never}
        />
      ))}
      <Rect
        x={bodyX as never}
        y={bodyY as never}
        width={bodyW as never}
        height={bodyH as never}
        color="#38bdf8"
      />
      {/* Debug contact indicator: dot under the player while grounded. */}
      <Circle cx={bodyX as never} cy={indicatorY as never} r={4} color="#22c55e" />
    </GameWorld2D>
  );
}
