import { Circle, Path, Rect } from '@shopify/react-native-skia';
import { GameSprite, type GameRendererProps } from 'rn-gamekit/react';
import { useDerivedValue } from 'react-native-reanimated';
import { projectWorldCollider2D } from 'rn-gamekit';
import { collisionLabDefinition, labAssets, type CollisionLabSnapshot } from './collisionLabGame';

/**
 * Worklet-safe coordinate conversion (T11-F6): module-level helpers with an
 * explicit worklet directive, called from every derived value.
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

/** Distinct debug overlay colors per collider name. */
const COLLIDER_COLORS: Record<string, string> = {
  body: '#22c55e',
  hurtbox: '#3b82f6',
  attack: '#ef4444',
  pickup: '#eab308',
};

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
    return surface;
  });

  const snap = useDerivedValue((): CollisionLabSnapshot | undefined => {
    'worklet';
    const value = frame.value;
    if (value.scene !== 'lab') {
      return undefined;
    }
    return value.current as CollisionLabSnapshot;
  });

  const ball = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return { x: -100, y: -100, r: 0 };
    }
    return {
      x: toSurfaceX(value.ball.x, surface.scale, surface.offsetX),
      y: toSurfaceY(value.ball.y, surface.scale, surface.offsetY),
      r: toSurfaceSize(value.ball.radius, surface.scale),
    };
  });

  const box = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return { x: -100, y: -100, w: 0, h: 0 };
    }
    return {
      x: toSurfaceX(value.box.x, surface.scale, surface.offsetX),
      y: toSurfaceY(value.box.y, surface.scale, surface.offsetY),
      w: toSurfaceSize(value.box.width, surface.scale),
      h: toSurfaceSize(value.box.height, surface.scale),
    };
  });

  const projectile = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return { x: -100, y: -100, r: 0 };
    }
    return {
      x: toSurfaceX(value.projectile.x, surface.scale, surface.offsetX),
      y: toSurfaceY(value.projectile.y, surface.scale, surface.offsetY),
      r: toSurfaceSize(value.projectile.radius, surface.scale),
    };
  });

  const target = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined) {
      return { x: -100, y: -100, w: 0, h: 0 };
    }
    return {
      x: toSurfaceX(value.target.x, surface.scale, surface.offsetX),
      y: toSurfaceY(value.target.y, surface.scale, surface.offsetY),
      w: toSurfaceSize(value.target.width, surface.scale),
      h: toSurfaceSize(value.target.height, surface.scale),
    };
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

  // The swept projectile's path from its step start to its current position.
  const sweepPath = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined || !value.swept) {
      return '';
    }
    const sx = toSurfaceX(value.projectileStart.x, surface.scale, surface.offsetX);
    const sy = toSurfaceY(value.projectileStart.y, surface.scale, surface.offsetY);
    const ex = toSurfaceX(value.projectile.x, surface.scale, surface.offsetX);
    const ey = toSurfaceY(value.projectile.y, surface.scale, surface.offsetY);
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  });

  // Named collider debug overlays, projected through the public debug API
  // and only when debug visibility is on.
  const colliderOverlays = useDerivedValue(() => {
    'worklet';
    const surface = world.value;
    const value = snap.value;
    if (surface === undefined || value === undefined || !value.debugVisible) {
      return [];
    }
    return value.colliders.map((collider) => {
      const debug = projectWorldCollider2D(collider);
      const label = debug.label ?? 'collider';
      const color = COLLIDER_COLORS[label] ?? '#94a3b8';
      if (debug.kind === 'aabb') {
        return {
          kind: 'aabb' as const,
          x: toSurfaceX(debug.x, surface.scale, surface.offsetX),
          y: toSurfaceY(debug.y, surface.scale, surface.offsetY),
          w: toSurfaceSize(debug.width, surface.scale),
          h: toSurfaceSize(debug.height, surface.scale),
          color,
        };
      }
      return {
        kind: 'circle' as const,
        x: toSurfaceX(debug.x, surface.scale, surface.offsetX),
        y: toSurfaceY(debug.y, surface.scale, surface.offsetY),
        r: toSurfaceSize(debug.radius, surface.scale),
        color,
      };
    });
  });

  return (
    <>
      <Circle cx={ball.value.x} cy={ball.value.y} r={ball.value.r} color="#0ea5e9" />
      <Rect x={box.value.x} y={box.value.y} width={box.value.w} height={box.value.h} color="#f59e0b" />
      <Circle cx={projectile.value.x} cy={projectile.value.y} r={projectile.value.r} color="#a78bfa" />
      <Rect x={target.value.x} y={target.value.y} width={target.value.w} height={target.value.h} color="#f87171" />

      <Path path={sweepPath} color="#a78bfa" strokeWidth={1} style="stroke" />
      <Circle cx={projectile.value.x} cy={projectile.value.y} r={2} color="#f8fafc" />

      <Path path={normalPath} color="#22c55e" strokeWidth={2} style="stroke" />

      {colliderOverlays.value.map((overlay, index) =>
        overlay.kind === 'aabb' ? (
          <Rect
            key={`collider-${index}`}
            x={overlay.x}
            y={overlay.y}
            width={overlay.w}
            height={overlay.h}
            color={overlay.color}
            style="stroke"
            strokeWidth={1.5}
          />
        ) : (
          <Circle
            key={`collider-${index}`}
            cx={overlay.x}
            cy={overlay.y}
            r={overlay.r}
            color={overlay.color}
            style="stroke"
            strokeWidth={1.5}
          />
        ),
      )}

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
