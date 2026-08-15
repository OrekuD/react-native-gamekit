import { Circle, Rect } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import type { GameRendererProps } from 'rn-gamekit/react';
import { collisionLabDefinition, type CollisionLabSnapshot } from './collisionLabGame';

/**
 * Collision Lab renderer: draws the lab shapes and the debug projections
 * (contact point, normal arrow, sweep path) from the headless snapshot.
 * Presentation only — every value is computed by the scene.
 */
export function CollisionLabRenderer({
  frame,
  viewport,
}: GameRendererProps<typeof collisionLabDefinition['scenes']>) {
  const world = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'lab') {
      return undefined;
    }
    return surface;
  });

  const snapshot = useDerivedValue((): CollisionLabSnapshot | undefined => {
    const value = frame.value;
    if (value.scene !== 'lab') {
      return undefined;
    }
    return value.current as CollisionLabSnapshot;
  });

  const sx = (x: number, surface: { scale: number; offsetX: number }): number =>
    x * surface.scale + surface.offsetX;
  const sy = (y: number, surface: { scale: number; offsetY: number }): number =>
    y * surface.scale + surface.offsetY;

  const ballX = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? sx(snap.ball.x, surface) : 0;
  });
  const ballY = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? sy(snap.ball.y, surface) : 0;
  });
  const ballRadius = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? snap.ball.radius * surface.scale : 0;
  });

  const boxX = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? sx(snap.box.x, surface) : 0;
  });
  const boxY = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? sy(snap.box.y, surface) : 0;
  });
  const boxWidth = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? snap.box.width * surface.scale : 0;
  });
  const boxHeight = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? snap.box.height * surface.scale : 0;
  });

  const projectileX = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? sx(snap.projectile.x, surface) : 0;
  });
  const projectileY = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? sy(snap.projectile.y, surface) : 0;
  });
  const projectileRadius = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? snap.projectile.radius * surface.scale : 0;
  });

  const targetX = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? sx(snap.target.x, surface) : 0;
  });
  const targetY = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? sy(snap.target.y, surface) : 0;
  });
  const targetWidth = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? snap.target.width * surface.scale : 0;
  });
  const targetHeight = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap !== undefined ? snap.target.height * surface.scale : 0;
  });

  // Debug projections: contact point + normal arrow.
  const hitPointX = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap?.staticHit !== undefined ? sx(snap.staticHit.point.x, surface) : -100;
  });
  const hitPointY = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap?.staticHit !== undefined ? sy(snap.staticHit.point.y, surface) : -100;
  });
  const normalEndX = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap?.staticHit !== undefined
      ? sx(snap.staticHit.point.x + snap.staticHit.normal.x * 20, surface)
      : -100;
  });
  const normalEndY = useDerivedValue(() => {
    const surface = world.value;
    const snap = snapshot.value;
    return surface !== undefined && snap?.staticHit !== undefined
      ? sy(snap.staticHit.point.y + snap.staticHit.normal.y * 20, surface)
      : -100;
  });

  return (
    <>
      <Circle cx={ballX} cy={ballY} r={ballRadius} color="#0ea5e9" />
      <Rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} color="#f59e0b" />
      <Circle cx={projectileX} cy={projectileY} r={projectileRadius} color="#a78bfa" />
      <Rect x={targetX} y={targetY} width={targetWidth} height={targetHeight} color="#f87171" />
      <Circle cx={hitPointX} cy={hitPointY} r={5} color="#22c55e" />
      <Circle cx={normalEndX} cy={normalEndY} r={2.5} color="#22c55e" />
    </>
  );
}
