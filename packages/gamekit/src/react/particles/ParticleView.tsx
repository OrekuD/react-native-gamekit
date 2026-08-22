import { useContext, useMemo } from 'react';
import { Atlas, Circle, Group, Rect } from '@shopify/react-native-skia';
import { useRectBuffer, useRSXformBuffer } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { SkImage } from '@shopify/react-native-skia';

import { GameWorldContext } from '../sprites/GameWorld2D';
import type { CameraCut2D } from '../../camera2d/types';
import type { ResolvedViewport2D } from '../../viewport2d/types';
import type {
  ParticleEffectDefinition,
  ParticleFrameSnapshotLike,
  ParticleSystem,
} from '../../particles/types';

const CULL_PADDING = 16;

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
   * Sprite source for `kind: 'sprite'` effects — one decoded sheet/image
   * resolved once at bind time by the caller. Required for sprite effects;
   * a missing source is a structured render error (T15-F3).
   */
  readonly spriteSource?: { readonly image: SkImage; readonly frameRect: { x: number; y: number; width: number; height: number } };
}

/**
 * Presentation-only particle renderer.
 *
 * - Screen space renders in local surface coordinates; world space MUST be
 *   mounted inside the matching `GameWorld2D` so the presented camera +
 *   viewport transform apply exactly once. World culling uses the camera's
 *   visible logical bounds plus padding; culled particles keep aging because
 *   sampling happens in the binding, not here (T15-F4).
 * - Every kind uses the CENTER anchor convention with sampled rotation and
 *   scale applied (T15-F5).
 */
export function ParticleView({
  system,
  effect,
  width,
  height,
  snapshot,
  spriteSource,
}: ParticleViewProps) {
  const definition = useMemo<ParticleEffectDefinition>(() => system.bindPresentation().definition(effect), [system, effect]);
  const capacity = definition.capacity;
  const world = useContext(GameWorldContext);

  if (definition.particle.kind === 'sprite') {
    if (spriteSource === undefined) {
      throw new Error(
        `[rn-gamekit/particles] effect "${effect}" declares kind "sprite" but no spriteSource was provided — resolve the sheet via the asset store before rendering`,
      );
    }
    return (
      <SpriteSlots
        snapshot={snapshot}
        effect={effect}
        capacity={capacity}
        image={spriteSource.image}
        frame={definition.particle.frame}
        frameRect={spriteSource.frameRect}
        baseWidth={definition.particle.size.width}
        baseHeight={definition.particle.size.height}
        width={width}
        height={height}
        space={definition.space}
        camera={world?.camera ?? null}
        viewport={world?.viewport ?? null}
      />
    );
  }

  return (
    <ShapeSlots
      snapshot={snapshot}
      effect={effect}
      capacity={capacity}
      shape={definition.particle.shape === 'rectangle' ? 'rect' : 'circle'}
      radius={definition.particle.radius ?? 3}
      rectWidth={definition.particle.width ?? 6}
      rectHeight={definition.particle.height ?? 6}
      color={definition.particle.color ?? '#ffffff'}
      width={width}
      height={height}
      space={definition.space}
      camera={world?.camera ?? null}
      viewport={world?.viewport ?? null}
    />
  );
}

interface SlotVisibilityInput {
  readonly snapshot: SharedValue<ParticleFrameSnapshotLike>;
  readonly effect: string;
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly space: 'world' | 'screen';
  readonly camera: SharedValue<CameraCut2D | undefined> | null;
  readonly viewport: SharedValue<ResolvedViewport2D | undefined> | null;
}

/** Worklet-safe visibility: screen bounds or camera-aware world bounds. */
function makeVisibleWorklet(input: SlotVisibilityInput): () => boolean {
  const { snapshot, effect, index, width, height, space, camera, viewport } = input;
  return () => {
    'worklet';
    const frame = snapshot.value;
    const slots = frame.data.get(effect);
    if (slots === undefined || slots.visible[index] === undefined || slots.visible[index] === 0) {
      return false;
    }
    const x = slots.x[index]!;
    const y = slots.y[index]!;
    if (space === 'world') {
      if (camera === null || viewport === null) {
        // Without camera context we cannot place world particles — hide.
        return false;
      }
      const view = viewport.value?.visibleLogicalBounds;
      if (view === undefined || camera.value === undefined) return false;
      const pad = CULL_PADDING;
      return (
        x >= view.x - pad &&
        x <= view.x + view.width + pad &&
        y >= view.y - pad &&
        y <= view.y + view.height + pad
      );
    }
    return x >= -CULL_PADDING && x <= width + CULL_PADDING && y >= -CULL_PADDING && y <= height + CULL_PADDING;
  };
}

function ShapeSlots(props: {
  readonly snapshot: SharedValue<ParticleFrameSnapshotLike>;
  readonly effect: string;
  readonly capacity: number;
  readonly shape: 'circle' | 'rect';
  readonly radius: number;
  readonly rectWidth: number;
  readonly rectHeight: number;
  readonly color: string;
  readonly width: number;
  readonly height: number;
  readonly space: 'world' | 'screen';
  readonly camera: SharedValue<CameraCut2D | undefined> | null;
  readonly viewport: SharedValue<ResolvedViewport2D | undefined> | null;
}) {
  const { snapshot, effect, capacity, shape, radius, rectWidth, rectHeight, color, width, height, space, camera, viewport } = props;
  const nodes = [];
  for (let i = 0; i < capacity; i++) {
    nodes.push(<ShapeSlot key={i} index={i} {...{ snapshot, effect, shape, radius, rectWidth, rectHeight, color, width, height, space, camera, viewport }} />);
  }
  return <>{nodes}</>;
}

function ShapeSlot(props: {
  readonly index: number;
} & Omit<Parameters<typeof ShapeSlots>[0], 'capacity'>) {
  const { snapshot, effect, index, shape, radius, rectWidth, rectHeight, color, width, height, space, camera, viewport } = props;
  const visible = useDerivedValue(makeVisibleWorklet({ snapshot, effect, index, width, height, space, camera, viewport }));
  const cx = useDerivedValue(() => {
    'worklet';
    return snapshot.value.data.get(effect)?.x[index] ?? 0;
  });
  const cy = useDerivedValue(() => {
    'worklet';
    return snapshot.value.data.get(effect)?.y[index] ?? 0;
  });
  const rotation = useDerivedValue(() => {
    'worklet';
    return snapshot.value.data.get(effect)?.rotation[index] ?? 0;
  });
  const scale = useDerivedValue(() => {
    'worklet';
    return snapshot.value.data.get(effect)?.scale[index] ?? 1;
  });
  const opacity = useDerivedValue(() => {
    'worklet';
    return visible.value ? (snapshot.value.data.get(effect)?.opacity[index] ?? 0) : 0;
  });

  // Center-anchor convention (T15-F5): translate to the sampled center,
  // rotate around it, scale around it; geometry stays statically centered so
  // circles and rectangles share one anchor rule.
  const transform = useDerivedValue(() => {
    'worklet';
    const vis = visible.value;
    return [
      { translateX: vis ? cx.value : 0 },
      { translateY: vis ? cy.value : 0 },
      { rotate: rotation.value },
      { scaleX: scale.value },
      { scaleY: scale.value },
    ];
  });
  const slotOpacity = useDerivedValue(() => {
    'worklet';
    return visible.value ? opacity.value : 0;
  });

  if (shape === 'circle') {
    return (
      <Group transform={transform}>
        <Circle cx={0} cy={0} r={radius} color={color} opacity={slotOpacity} />
      </Group>
    );
  }
  return (
    <Group transform={transform}>
      <Rect
        x={-rectWidth / 2}
        y={-rectHeight / 2}
        width={rectWidth}
        height={rectHeight}
        color={color}
        opacity={slotOpacity}
      />
    </Group>
  );
}

function SpriteSlots(props: {
  readonly snapshot: SharedValue<ParticleFrameSnapshotLike>;
  readonly effect: string;
  readonly capacity: number;
  readonly image: SkImage;
  readonly frame: string;
  readonly frameRect: { x: number; y: number; width: number; height: number };
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly width: number;
  readonly height: number;
  readonly space: 'world' | 'screen';
  readonly camera: SharedValue<CameraCut2D | undefined> | null;
  readonly viewport: SharedValue<ResolvedViewport2D | undefined> | null;
}) {
  const { snapshot, effect, capacity, image, frameRect, baseWidth, baseHeight, width, height, space, camera, viewport } = props;

  // T15-F3: fixed-capacity Atlas buffers filled by ONE derived value that
  // loops the effect's fixed slots on the UI runtime — the same pattern as
  // SpriteBatch, with zero per-slot JS writes.
  const rects = useRectBuffer(capacity, (rect) => {
    'worklet';
    rect.setXYWH(0, 0, 0, 0);
  });
  const xforms = useRSXformBuffer(capacity, (xform) => {
    'worklet';
    xform.set(1, 0, 0, 0);
  });

  const colors = useMemo(
    () => Array.from({ length: capacity }, () => undefined),
    [capacity],
  );
  void colors;

  useDerivedValue(() => {
    'worklet';
    const frame = snapshot.value;
    const slots = frame.data.get(effect);
    for (let i = 0; i < capacity; i++) {
      const rectSlot = rects.value[i];
      const xformSlot = xforms.value[i];
      if (rectSlot === undefined || xformSlot === undefined) continue;
      const vis =
        slots !== undefined && slots.visible[i] === 1 && slotInBounds(slots.x[i]!, slots.y[i]!, space, camera, viewport, width, height);
      if (!vis) {
        rectSlot.setXYWH(0, 0, 0, 0);
        continue;
      }
      const scale = slots!.scale[i]!;
      const w = baseWidth * scale;
      const h = baseHeight * scale;
      rectSlot.setXYWH(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
      const rot = slots!.rotation[i]!;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const px = slots!.x[i]!;
      const py = slots!.y[i]!;
      // Center anchor: pivot compensation for w/h around the center point.
      xformSlot.set(cos, sin, px - (w / 2) * cos + (h / 2) * sin, py - (w / 2) * sin - (h / 2) * cos);
    }
    return frame.revision;
  });

  return <Atlas image={image} sprites={rects} transforms={xforms} />;
}

function slotInBounds(
  x: number,
  y: number,
  space: 'world' | 'screen',
  camera: SharedValue<CameraCut2D | undefined> | null,
  viewport: SharedValue<ResolvedViewport2D | undefined> | null,
  width: number,
  height: number,
): boolean {
  'worklet';
  if (space === 'world') {
    if (camera === null || viewport === null) return false;
    const view = viewport.value?.visibleLogicalBounds;
    if (view === undefined || camera.value === undefined) return false;
    const pad = CULL_PADDING;
    return x >= view.x - pad && x <= view.x + view.width + pad && y >= view.y - pad && y <= view.y + view.height + pad;
  }
  return x >= -CULL_PADDING && x <= width + CULL_PADDING && y >= -CULL_PADDING && y <= height + CULL_PADDING;
}
