import { Circle, Path, Rect } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { GameSprite, type GameRendererProps } from 'rn-gamekit/react';
import { collisionLabDefinition, labAssets, type CollisionLabSnapshot } from './collisionLabGame';

/**
 * Worklet-safe coordinate conversion (T11-F6, T11-FF1): module-level
 * helpers with an explicit worklet directive. Every function called from a
 * derived worklet below is either inline, workletized, or a Math built-in —
 * no ordinary imported functions are invoked on the UI runtime. Collision
 * projection happens in the headless snapshot (the frame publishes
 * `colliderDebug` records), so the renderer only transforms coordinates.
 */
function toSurfaceX(x: number, scale: number, offsetX: number): number {
  'worklet';
  return x * scale + offsetX;
}

function toSurfaceY(y: number, scale: number, offsetY: number): number {
  'worklet';
  return y * scale + offsetY;
}

function toSurfaceSize(size: number, scale: number): number {
  'worklet';
  return size * scale;
}

/** Distinct debug overlay colors per collider label. */
const COLLIDER_COLORS: Record<string, string> = {
  body: '#22c55e',
  hurtbox: '#3b82f6',
  attack: '#ef4444',
  pickup: '#eab308',
};

/**
 * Fixed authored collider topology (T11-FF2): four stable nodes with stable
 * ids. The React tree never reads a shared `.value`; each node's geometry
 * arrives as reactive shared values, and visibility is a zero-size policy so
 * toggling Debug never rebuilds the canvas or the tree.
 */
export const COLLIDER_TOPOLOGY = [
  { label: 'body', kind: 'aabb' as const },
  { label: 'hurtbox', kind: 'circle' as const },
  { label: 'attack', kind: 'aabb' as const },
  { label: 'pickup', kind: 'circle' as const },
];

interface ColliderOverlayProps {
  readonly index: number;
  readonly kind: 'aabb' | 'circle';
  readonly world: SharedValue<{ scale: number; offsetX: number; offsetY: number } | undefined>;
  readonly snap: SharedValue<CollisionLabSnapshot | undefined>;
}

export function ColliderOverlay({ index, kind, world, snap }: ColliderOverlayProps) {
  // One reactive shared value per Skia prop (T11-FF2): the React tree is
  // built from the fixed topology only, never from a shared `.value` read.
  const x = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    const debug = value?.colliderDebug[index];
    if (
      surface === undefined ||
      value === undefined ||
      debug === undefined ||
      !value.debugVisible ||
      (debug.kind !== 'aabb' && debug.kind !== 'circle')
    ) {
      return 0;
    }
    return toSurfaceX(debug.x, surface.scale, surface.offsetX);
  });
  const y = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    const debug = value?.colliderDebug[index];
    if (
      surface === undefined ||
      value === undefined ||
      debug === undefined ||
      !value.debugVisible ||
      (debug.kind !== 'aabb' && debug.kind !== 'circle')
    ) {
      return 0;
    }
    return toSurfaceY(debug.y, surface.scale, surface.offsetY);
  });
  const w = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    const debug = value?.colliderDebug[index];
    if (
      surface === undefined ||
      value === undefined ||
      debug === undefined ||
      !value.debugVisible ||
      (debug.kind !== 'aabb' && debug.kind !== 'circle')
    ) {
      return 0; // Zero size hides the overlay without rebuilding the tree.
    }
    return toSurfaceSize(debug.kind === 'aabb' ? debug.width : debug.radius, surface.scale);
  });
  const h = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    const debug = value?.colliderDebug[index];
    if (
      surface === undefined ||
      value === undefined ||
      debug === undefined ||
      !value.debugVisible ||
      (debug.kind !== 'aabb' && debug.kind !== 'circle')
    ) {
      return 0;
    }
    return toSurfaceSize(debug.kind === 'aabb' ? debug.height : debug.radius, surface.scale);
  });
  const color = useDerivedValue(() => {
    'worklet';
    const value = snap.value;
    const debug = value?.colliderDebug[index];
    if (value === undefined || debug === undefined || !value.debugVisible) {
      return 'transparent';
    }
    return COLLIDER_COLORS[debug.label ?? ''] ?? '#94a3b8';
  });

  return kind === 'aabb' ? (
    <Rect x={x} y={y} width={w} height={h} color={color} style="stroke" strokeWidth={1.5} />
  ) : (
    <Circle cx={x} cy={y} r={w} color={color} style="stroke" strokeWidth={1.5} />
  );
}

export function CollisionLabRenderer({
  frame,
  alpha,
  viewport,
  assets,
}: GameRendererProps<typeof collisionLabDefinition['scenes']>) {
  const world = useDerivedValue(() => {
    'worklet';
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'lab') {
      return undefined;
    }
    return { scale: surface.scale, offsetX: surface.offsetX, offsetY: surface.offsetY };
  });

  const snap = useDerivedValue((): CollisionLabSnapshot | undefined => {
    'worklet';
    const value = frame.value;
    if (value.scene !== 'lab') {
      return undefined;
    }
    return value.current as CollisionLabSnapshot;
  });

  const ballX = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return -100;
    }
    return toSurfaceX(value.ball.x, surface.scale, surface.offsetX);
  });
  const ballY = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return -100;
    }
    return toSurfaceY(value.ball.y, surface.scale, surface.offsetY);
  });
  const ballR = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return 0;
    }
    return toSurfaceSize(value.ball.radius, surface.scale);
  });

  const boxX = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return -100;
    }
    return toSurfaceX(value.box.x, surface.scale, surface.offsetX);
  });
  const boxY = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return -100;
    }
    return toSurfaceY(value.box.y, surface.scale, surface.offsetY);
  });
  const boxW = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return 0;
    }
    return toSurfaceSize(value.box.width, surface.scale);
  });
  const boxH = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return 0;
    }
    return toSurfaceSize(value.box.height, surface.scale);
  });

  const projectileX = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return -100;
    }
    return toSurfaceX(value.projectile.x, surface.scale, surface.offsetX);
  });
  const projectileY = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return -100;
    }
    return toSurfaceY(value.projectile.y, surface.scale, surface.offsetY);
  });
  const projectileR = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return 0;
    }
    return toSurfaceSize(value.projectile.radius, surface.scale);
  });

  const targetX = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return -100;
    }
    return toSurfaceX(value.target.x, surface.scale, surface.offsetX);
  });
  const targetY = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return -100;
    }
    return toSurfaceY(value.target.y, surface.scale, surface.offsetY);
  });
  const targetW = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return 0;
    }
    return toSurfaceSize(value.target.width, surface.scale);
  });
  const targetH = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return 0;
    }
    return toSurfaceSize(value.target.height, surface.scale);
  });

  // The normal segment from the headless debug projection.
  const normalPath = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value?.staticHit === undefined) {
      return '';
    }
    const px = toSurfaceX(value.staticHit.point.x, surface.scale, surface.offsetX);
    const py = toSurfaceY(value.staticHit.point.y, surface.scale, surface.offsetY);
    const nx = toSurfaceX(
      value.staticHit.point.x + value.staticHit.normal.x * 20,
      surface.scale,
      surface.offsetX,
    );
    const ny = toSurfaceY(
      value.staticHit.point.y + value.staticHit.normal.y * 20,
      surface.scale,
      surface.offsetY,
    );
    return `M ${px} ${py} L ${nx} ${ny}`;
  });

  // The swept projectile's path from the previous fixed-step position to
  // the current one (no path on the teleport wrap step).
  const sweepPath = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    // The published teleport fact hides the path (SF1); the scene also
    // suppresses the sweep query on that frame.
    if (surface === undefined || value === undefined || !value.swept || value.projectileTeleported) {
      return '';
    }
    const sx = toSurfaceX(value.projectileStart.x, surface.scale, surface.offsetX);
    const sy = toSurfaceY(value.projectileStart.y, surface.scale, surface.offsetY);
    const ex = toSurfaceX(value.projectile.x, surface.scale, surface.offsetX);
    const ey = toSurfaceY(value.projectile.y, surface.scale, surface.offsetY);
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  });

  return (
    <>
      <Circle cx={ballX} cy={ballY} r={ballR} color="#0ea5e9" />
      <Rect x={boxX} y={boxY} width={boxW} height={boxH} color="#f59e0b" />
      <Circle cx={projectileX} cy={projectileY} r={projectileR} color="#a78bfa" />
      <Rect x={targetX} y={targetY} width={targetW} height={targetH} color="#f87171" />

      <Path path={sweepPath} color="#a78bfa" strokeWidth={1} style="stroke" />
      <Path path={normalPath} color="#22c55e" strokeWidth={2} style="stroke" />

      {COLLIDER_TOPOLOGY.map((spec, index) => (
        <ColliderOverlay key={spec.label} index={index} kind={spec.kind} world={world} snap={snap} />
      ))}

      {assets === undefined ? null : (
        <GameSprite<typeof collisionLabDefinition['scenes'], 'lab'>
          scene="lab"
          commit={frame}
          alpha={alpha}
          source={assets.get(labAssets.gameplay.player)}
          anchor={{ x: 0.5, y: 1 }}
          select={({ current }) => {
            'worklet';
            const value = current as CollisionLabSnapshot;
            return {
              x: value.sprite.x,
              y: value.sprite.y,
              clip: value.animation,
            };
          }}
        />
      )}
    </>
  );
}
