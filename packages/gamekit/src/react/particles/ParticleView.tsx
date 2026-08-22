import { useContext, useMemo } from 'react';
import { Atlas, Picture, Skia } from '@shopify/react-native-skia';
import { useRectBuffer, useRSXformBuffer } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { SkImage, SkPicture } from '@shopify/react-native-skia';

import { GameWorldContext } from '../sprites/GameWorld2D';
import type { CameraCut2D } from '../../camera2d/types';
import type { ResolvedViewport2D } from '../../viewport2d/types';
import type {
  ParticleEffectDefinition,
  ParticleFrameSnapshotLike,
  ParticleSystem,
} from '../../particles/types';

import {
  PARTICLE_CULL_PADDING,
  cameraVisibleWorldBounds,
  screenVisibleBounds,
  visibleInBounds,
} from './culling';
import { assertUniformParticleSpriteRatio, particleSpriteXform } from './spriteXForm';

export interface ParticleViewProps {
  readonly system: ParticleSystem;
  readonly effect: string;
  /** Surface size: px for screen space, world units for world space. */
  readonly width: number;
  readonly height: number;
  /**
   * The UI snapshot published by `useParticlePresentation`. Views are pure
   * readers and NEVER advance the system clock (T15-F1).
   */
  readonly snapshot: SharedValue<ParticleFrameSnapshotLike>;
  /**
   * Sprite source for `kind: 'sprite'` effects — the decoded sheet resolved
   * once at bind time by the caller. Required for sprite effects; a missing
   * source is a structured render error (T15-F3).
   */
  readonly spriteSource?: {
    readonly image: SkImage;
    readonly frame: { x: number; y: number; width: number; height: number };
  };
}

/**
 * Presentation-only particle renderer.
 *
 * Topology is CONSTANT per effect regardless of capacity (T15-RF5):
 * exactly one React node (`Picture` for shapes, `Atlas` for sprites) plus a
 * single UI-runtime derived worklet that walks the effect's fixed buffers.
 * World-space effects must be mounted inside the matching `GameWorld2D`;
 * culling uses the presented camera's actual center/zoom/rotation through
 * the shared helper so both paths agree (T15-RF2).
 */
export function ParticleView({
  system,
  effect,
  width,
  height,
  snapshot,
  spriteSource,
}: ParticleViewProps) {
  const definition = useMemo<ParticleEffectDefinition>(
    () => system.bindPresentation().definition(effect),
    [system, effect],
  );
  const world = useContext(GameWorldContext);
  const camera = (world?.camera ?? null) as SharedValue<CameraCut2D | undefined> | null;
  const viewport = (world?.viewport ?? null) as SharedValue<ResolvedViewport2D | undefined> | null;

  if (definition.particle.kind === 'sprite') {
    if (spriteSource === undefined) {
      throw new Error(
        `[rn-gamekit/particles] effect "${effect}" declares kind "sprite" but no spriteSource was provided — resolve the sheet via the asset store before rendering`,
      );
    }
    // v1 requires uniform authored-to-source aspect (RSXform cannot scale
    // nonuniformly); validated once at bind time.
    assertUniformParticleSpriteRatio(
      definition.particle.size.width,
      definition.particle.size.height,
      spriteSource.frame.width,
      spriteSource.frame.height,
    );
    return (
      <SpriteSlots
        snapshot={snapshot}
        effect={effect}
        capacity={definition.capacity}
        image={spriteSource.image}
        frameRect={spriteSource.frame}
        drawWidth={definition.particle.size.width}
        drawHeight={definition.particle.size.height}
        width={width}
        height={height}
        space={definition.space}
        camera={camera}
        viewport={viewport}
      />
    );
  }

  return (
    <ShapeBatch
      snapshot={snapshot}
      effect={effect}
      capacity={definition.capacity}
      shape={definition.particle.shape === 'rectangle' ? 'rect' : 'circle'}
      radius={definition.particle.radius ?? 3}
      rectWidth={definition.particle.width ?? 6}
      rectHeight={definition.particle.height ?? 6}
      color={definition.particle.color ?? '#ffffff'}
      fadeOut={definition.fadeOut}
      gravityX={definition.gravity.x}
      gravityY={definition.gravity.y}
      lifetimeSeconds={definition.lifetimeSeconds}
      speed={definition.speed}
      direction={definition.direction ?? { min: 0, max: Math.PI * 2 }}
      rotation={definition.rotation ?? { min: 0, max: 0 }}
      scaleOverLife={definition.scaleOverLife ?? { min: 1, max: 1 }}
      width={width}
      height={height}
      space={definition.space}
      camera={camera}
      viewport={viewport}
    />
  );
}

// ---------------------------------------------------------------------------
// Shapes: ONE immediate Picture built in ONE worklet per effect (T15-RF5).
// ---------------------------------------------------------------------------

interface ShapeBatchProps {
  readonly snapshot: SharedValue<ParticleFrameSnapshotLike>;
  readonly effect: string;
  readonly capacity: number;
  readonly shape: 'circle' | 'rect';
  readonly radius: number;
  readonly rectWidth: number;
  readonly rectHeight: number;
  readonly color: string;
  readonly fadeOut: boolean;
  readonly gravityX: number;
  readonly gravityY: number;
  readonly lifetimeSeconds: { min: number; max: number };
  readonly speed: { min: number; max: number };
  readonly direction: { min: number; max: number };
  readonly rotation: { min: number; max: number };
  readonly scaleOverLife: { min: number; max: number };
  readonly width: number;
  readonly height: number;
  readonly space: 'world' | 'screen';
  readonly camera: SharedValue<CameraCut2D | undefined> | null;
  readonly viewport: SharedValue<ResolvedViewport2D | undefined> | null;
}

function ShapeBatch(props: ShapeBatchProps) {
  const {
    snapshot, effect, capacity, shape, radius, rectWidth, rectHeight, color,
    width, height, space, camera, viewport,
  } = props;

  // One worklet rebuilds the picture from the latest published frame; the
  // component count stays constant as capacity grows — only this buffer walk
  // scales (and it is plain array reads on the UI runtime).
  const picture = useDerivedValue<SkPicture>(() => {
    'worklet';
    const frame = snapshot.value;
    const slots = frame.effects[effect];

    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording();
      if (slots === undefined) return recorder.finishRecordingAsPicture();
      // Culling bounds computed ONCE per revision from the presented camera.
      const bounds =
        space === 'world'
          ? cameraVisibleWorldBounds(camera, viewport, PARTICLE_CULL_PADDING)
          : screenVisibleBounds(width, height, PARTICLE_CULL_PADDING);

      const paint = Skia.Paint();
      paint.setColor(Skia.Color(color));

      for (let i = 0; i < capacity; i++) {
        if (slots.visible[i] === undefined || slots.visible[i] === 0) continue;
        const x = slots.x[i]!;
        const y = slots.y[i]!;
        if (!visibleInBounds(x, y, bounds)) continue;
        const rot = slots.rotation[i]!;
        const sc = slots.scale[i]!;
        const op = slots.opacity[i]!;
        if (op <= 0) continue;
        paint.setAlphaf(Math.max(0, Math.min(1, op)));
        if (shape === 'circle') {
          canvas.drawCircle(x, y, radius * sc, paint);
        } else {
          const w = rectWidth * sc;
          const h = rectHeight * sc;
          // Canvas transforms go through concat(SkMatrix); Matrix is
          // chainable: translate -> rotate (radians).
          const matrix = Skia.Matrix().translate(x, y).rotate(rot);
          canvas.save();
          canvas.concat(matrix);
          canvas.drawRect({ x: -w / 2, y: -h / 2, width: w, height: h }, paint);
          canvas.restore();
        }
      }
      return recorder.finishRecordingAsPicture();
  });

  return <Picture picture={picture} />;
}

// ---------------------------------------------------------------------------
// Sprites: fixed-capacity Atlas buffers filled by ONE worklet (T15-F3/R4).
// ---------------------------------------------------------------------------

function SpriteSlots(props: {
  readonly snapshot: SharedValue<ParticleFrameSnapshotLike>;
  readonly effect: string;
  readonly capacity: number;
  readonly image: SkImage;
  readonly frameRect: { x: number; y: number; width: number; height: number };
  readonly drawWidth: number;
  readonly drawHeight: number;
  readonly width: number;
  readonly height: number;
  readonly space: 'world' | 'screen';
  readonly camera: SharedValue<CameraCut2D | undefined> | null;
  readonly viewport: SharedValue<ResolvedViewport2D | undefined> | null;
}) {
  const { snapshot, effect, capacity, image, frameRect, drawWidth, drawHeight, width, height, space, camera, viewport } =
    props;

  const rects = useRectBuffer(capacity, (rect) => {
    'worklet';
    rect.setXYWH(0, 0, 0, 0);
  });
  const xforms = useRSXformBuffer(capacity, (xform) => {
    'worklet';
    xform.set(1, 0, 0, 0);
  });

  // One derived value fills every slot on the UI runtime using the shared
  // culling helper and the established RSXform math WITH scale (T15-RF4).
  useDerivedValue(() => {
    'worklet';
    const frame = snapshot.value;
    const slots = frame.effects[effect];
    const bounds =
      space === 'world'
        ? cameraVisibleWorldBounds(camera, viewport, PARTICLE_CULL_PADDING)
        : screenVisibleBounds(width, height, PARTICLE_CULL_PADDING);

    for (let i = 0; i < capacity; i++) {
      const rectSlot = rects.value[i];
      const xformSlot = xforms.value[i];
      if (rectSlot === undefined || xformSlot === undefined) continue;
      const vis =
        slots !== undefined &&
        slots.visible[i] === 1 &&
        visibleInBounds(slots.x[i]!, slots.y[i]!, bounds);
      if (!vis || slots === undefined) {
        rectSlot.setXYWH(0, 0, 0, 0);
        continue;
      }
      const xf = particleSpriteXform({
        x: slots.x[i]!,
        y: slots.y[i]!,
        rotation: slots.rotation[i]!,
        scale: slots.scale[i]!,
        drawWidth,
        drawHeight,
      });
      rectSlot.setXYWH(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
      xformSlot.set(xf.scos, xf.ssin, xf.tx, xf.ty);
    }
    return frame.revision;
  });

  return <Atlas image={image} sprites={rects} transforms={xforms} />;
}
