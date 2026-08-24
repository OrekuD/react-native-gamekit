import { useContext, useMemo } from 'react';
import { Atlas, Picture, Skia } from '@shopify/react-native-skia';
import { useColorBuffer, useRectBuffer, useRSXformBuffer } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { SkImage, SkColor } from '@shopify/react-native-skia';

import { GameWorldContext } from '../sprites/GameWorld2D';
import type {
  ParticleEffectDefinition,
  ParticleEmissionRecord,
  ParticleSystem,
  ParticleUiRegistry,
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
   * The presentation handle from `useParticlePresentation`: a scalar
   * active-time clock plus the bounded emission registry. Views are pure
   * readers and NEVER advance the system clock (T15-F1).
   */
  readonly presentation: {
    readonly clock: SharedValue<number>;
    readonly registry: SharedValue<ParticleUiRegistry>;
  };
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
 * Topology is CONSTANT per effect regardless of capacity (T15-RF5): exactly
 * one React node (`Picture` for shapes, `Atlas` for sprites) plus a single
 * UI-runtime derived worklet that walks the effect's emission records and
 * computes analytic transforms from the scalar active-time clock. No per-slot
 * data crosses the runtime boundary per frame (T15-SF1).
 */
export function ParticleView({
  system,
  effect,
  width,
  height,
  presentation,
  spriteSource,
}: ParticleViewProps) {
  const definition = useMemo<ParticleEffectDefinition>(
    () => system.bindPresentation().definition(effect),
    [system, effect],
  );
  const world = useContext(GameWorldContext);
  const camera = (world?.camera ?? null) as never;
  const viewport = (world?.viewport ?? null) as never;

  if (definition.particle.kind === 'sprite') {
    if (spriteSource === undefined) {
      throw new Error(
        `[rn-gamekit/particles] effect "${effect}" declares kind "sprite" but no spriteSource was provided — resolve the sheet via the asset store before rendering`,
      );
    }
    assertUniformParticleSpriteRatio(
      definition.particle.size.width,
      definition.particle.size.height,
      spriteSource.frame.width,
      spriteSource.frame.height,
    );
    return (
      <SpriteSlots
        clock={presentation.clock}
        registry={presentation.registry}
        effect={effect}
        capacity={definition.capacity}
        image={spriteSource.image}
        frameRect={spriteSource.frame}
        drawWidth={definition.particle.size.width}
        drawHeight={definition.particle.size.height}
        fadeOut={definition.fadeOut}
        gravityX={definition.gravity.x}
        gravityY={definition.gravity.y}
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
      clock={presentation.clock}
      registry={presentation.registry}
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
      width={width}
      height={height}
      space={definition.space}
      camera={camera}
      viewport={viewport}
    />
  );
}

/**
 * Analytic transform for one emission at the given ACTIVE time.
 *
 * T15-TF3: opacity honors the definition's fade policy — `fadeOut: true`
 * ramps `1 -> t`, `fadeOut: false` stays fully opaque for the whole life.
 */
export function sampleEmission(
  e: ParticleEmissionRecord,
  now: number,
  gravityX: number,
  gravityY: number,
  fadeOut: boolean,
): { x: number; y: number; rotation: number; scale: number; opacity: number; alive: boolean } {
  'worklet';
  const age = now - e.bornAt;
  if (age < 0 || age >= e.lifetime) {
    return { x: 0, y: 0, rotation: 0, scale: 0, opacity: 0, alive: false };
  }
  const t = age / e.lifetime;
  const x = e.originX + e.vx * age + 0.5 * gravityX * age * age;
  const y = e.originY + e.vy * age + 0.5 * gravityY * age * age;
  const rotation = e.rotation + e.rotationSpeed * age;
  const scale = e.scaleStart + (e.scaleEnd - e.scaleStart) * t;
  const opacity = fadeOut ? 1 - t : 1;
  return { x, y, rotation, scale, opacity, alive: true };
}

// ---------------------------------------------------------------------------
// Shapes: ONE immediate Picture built in ONE worklet per effect (T15-RF5).
// ---------------------------------------------------------------------------

function ShapeBatch(props: {
  readonly clock: SharedValue<number>;
  readonly registry: SharedValue<ParticleUiRegistry>;
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
  readonly width: number;
  readonly height: number;
  readonly space: 'world' | 'screen';
  readonly camera: unknown;
  readonly viewport: unknown;
}) {
  const { clock, registry, effect, capacity, shape, radius, rectWidth, rectHeight, color, fadeOut, gravityX, gravityY, width, height, space, camera, viewport } =
    props;

  const picture = useDerivedValue(() => {
    'worklet';
    const reg = registry.value;
    const entry = reg.effects[effect];
    const now = clock.value;
    // Culling bounds computed ONCE per revision from the presented camera.
    const bounds =
      space === 'world'
        ? cameraVisibleWorldBounds(camera as never, viewport as never, PARTICLE_CULL_PADDING)
        : screenVisibleBounds(width, height, PARTICLE_CULL_PADDING);

    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording();
    if (entry === undefined) return recorder.finishRecordingAsPicture();

    const paint = Skia.Paint();
    paint.setColor(Skia.Color(color));

    const particles = entry.particles;
    for (let i = 0; i < particles.length && i < capacity; i++) {
      const e = particles[i]!;
      const s = sampleEmission(e, now, gravityX, gravityY, fadeOut);
      if (!s.alive || s.opacity <= 0) continue;
      if (!visibleInBounds(s.x, s.y, bounds)) continue;
      paint.setAlphaf(Math.max(0, Math.min(1, s.opacity)));
      if (shape === 'circle') {
        canvas.drawCircle(s.x, s.y, radius * s.scale, paint);
      } else {
        const w = rectWidth * s.scale;
        const h = rectHeight * s.scale;
        const matrix = Skia.Matrix().translate(s.x, s.y).rotate(s.rotation);
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
// Sprites: fixed-capacity Atlas buffers filled by ONE worklet (T15-F3/R4/SF2).
// ---------------------------------------------------------------------------

function SpriteSlots(props: {
  readonly clock: SharedValue<number>;
  readonly registry: SharedValue<ParticleUiRegistry>;
  readonly effect: string;
  readonly capacity: number;
  readonly image: SkImage;
  readonly frameRect: { x: number; y: number; width: number; height: number };
  readonly drawWidth: number;
  readonly drawHeight: number;
  readonly fadeOut: boolean;
  readonly gravityX: number;
  readonly gravityY: number;
  readonly width: number;
  readonly height: number;
  readonly space: 'world' | 'screen';
  readonly camera: unknown;
  readonly viewport: unknown;
}) {
  const { clock, registry, effect, capacity, image, frameRect, drawWidth, drawHeight, fadeOut, gravityX, gravityY, width, height, space, camera, viewport } =
    props;

  // UI-owned buffers created once per mount (T15-SF1). Colors use the
  // supported Skia color buffer (T15-TF3): each entry is an SkColor
  // Float32Array [r,g,b,a] mutated on the UI runtime.
  const rects = useRectBuffer(capacity, (rect) => {
    'worklet';
    rect.setXYWH(0, 0, 0, 0);
  });
  const xforms = useRSXformBuffer(capacity, (xform) => {
    'worklet';
    xform.set(1, 0, 0, 0);
  });
  const colors = useColorBuffer(capacity, (color: SkColor) => {
    'worklet';
    color[0] = 1;
    color[1] = 1;
    color[2] = 1;
    color[3] = 0;
  });

  useDerivedValue(() => {
    'worklet';
    const reg = registry.value;
    const entry = reg.effects[effect];
    const now = clock.value;
    const bounds =
      space === 'world'
        ? cameraVisibleWorldBounds(camera as never, viewport as never, PARTICLE_CULL_PADDING)
        : screenVisibleBounds(width, height, PARTICLE_CULL_PADDING);

    for (let i = 0; i < capacity; i++) {
      const rectSlot = rects.value[i];
      const xformSlot = xforms.value[i];
      const colorSlot: SkColor | undefined = colors.value[i];
      if (rectSlot === undefined || xformSlot === undefined || colorSlot === undefined) continue;

      let placed = false;
      if (entry !== undefined && i < entry.particles.length) {
        const e = entry.particles[i]!;
        const age = now - e.bornAt;
        if (age >= 0 && age < e.lifetime) {
          const t = age / e.lifetime;
          const x = e.originX + e.vx * age + 0.5 * gravityX * age * age;
          const y = e.originY + e.vy * age + 0.5 * gravityY * age * age;
          if (visibleInBounds(x, y, bounds)) {
            const op = fadeOut ? 1 - t : 1;
            const xf = particleSpriteXform({
              x,
              y,
              rotation: e.rotation + e.rotationSpeed * age,
              scale: e.scaleStart + (e.scaleEnd - e.scaleStart) * t,
              drawWidth,
              drawHeight,
              frameWidth: frameRect.width,
              frameHeight: frameRect.height,
            });
            rectSlot.setXYWH(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
            xformSlot.set(xf.scos, xf.ssin, xf.tx, xf.ty);
            // White modulates the texture; alpha carries sampled fade.
            colorSlot[0] = 1;
            colorSlot[1] = 1;
            colorSlot[2] = 1;
            colorSlot[3] = Math.max(0, Math.min(1, op));
            placed = true;
          }
        }
      }
      if (!placed) {
        // Hide inactive/culled slots AND clear stale alpha (T15-SF2).
        rectSlot.setXYWH(0, 0, 0, 0);
        colorSlot[0] = 1;
        colorSlot[1] = 1;
        colorSlot[2] = 1;
        colorSlot[3] = 0;
      }
    }
    return colors;
  });

  return <Atlas image={image} sprites={rects} transforms={xforms} colors={colors} />;
}
