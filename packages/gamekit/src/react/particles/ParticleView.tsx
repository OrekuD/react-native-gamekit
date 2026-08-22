import { useEffect } from 'react';
import { Circle, Rect, Group } from '@shopify/react-native-skia';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { ParticleEffectDefinition, ParticleSystem, ParticleSlot } from '../../particles/types';
import { sampleSlotAtAge } from '../../particles/sampling';

export interface ParticleViewProps {
  readonly system: ParticleSystem;
  readonly effect: string;
  /** Surface size: px for screen space, world units for world space. */
  readonly width: number;
  readonly height: number;
}

/** Hard upper bound so hook order is stable regardless of definition capacity. */
export const PARTICLE_MAX_CAPACITY = 1024;
const CULL_PADDING = 16;

interface SlotValues {
  readonly x: SharedValue<number>[];
  readonly y: SharedValue<number>[];
  readonly opacity: SharedValue<number>[];
}

/**
 * Allocate the fixed maximum once per mount. Definitions are immutable so a
 * mounted view never changes its slot count; unused slots stay hidden.
 * Hook order is therefore constant for the lifetime of the component.
 */
function useFixedSlots(): SlotValues {
  const x: SharedValue<number>[] = [];
  const y: SharedValue<number>[] = [];
  const opacity: SharedValue<number>[] = [];
  for (let i = 0; i < PARTICLE_MAX_CAPACITY; i++) {
    x.push(useSharedValue(0));
    y.push(useSharedValue(0));
    opacity.push(useSharedValue(0));
  }
  return { x, y, opacity };
}

/**
 * Stable shape-particle presentation for one effect (v1: circle/rectangle).
 *
 * - ONE fixed topology: PARTICLE_MAX_CAPACITY nodes mounted once; inactive,
 *   expired, or culled slots are hidden via opacity 0 — never unmounted.
 * - The rAF loop owned here advances the headless system clock and writes
 *   sampled analytic transforms into shared values.
 * - React never re-renders per particle or per frame; per-frame work is only
 *   shared-value writes consumed by Skia.
 *
 * Sprite (Atlas) presentation lands with sprite-asset binding in T15.4; the
 * focused device measurement between this retained topology and an immediate
 * Picture path remains honestly device-gated.
 */
export function ParticleView({ system, effect, width, height }: ParticleViewProps) {
  const def = (system as unknown as { __definitions?: Map<string, ParticleEffectDefinition> }).__definitions?.get(effect);
  const slots = useFixedSlots();

  useEffect(() => {
    let raf: number | null = null;
    let last = Date.now();
    const tick = (): void => {
      const now = Date.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!system.isDisposed) {
        if (!system.isPaused) system.update(dt);
        let active = (system as unknown as { getActiveParticlesSafe?: (e: string) => readonly ParticleSlot[] }).getActiveParticlesSafe?.(effect) ?? [];
        if (!def || def.particle.kind !== 'shape') active = [];
        for (let i = 0; i < PARTICLE_MAX_CAPACITY; i++) {
          const slot: ParticleSlot | undefined = i < active.length ? active[i] : undefined;
          if (!slot || !slot.active || !def) {
            slots.opacity[i]!.value = 0;
            continue;
          }
          const s = sampleSlotAtAge(slot, def, slot.age);
          const culled =
            s.position.x < -CULL_PADDING ||
            s.position.x > width + CULL_PADDING ||
            s.position.y < -CULL_PADDING ||
            s.position.y > height + CULL_PADDING;
          if (culled) {
            slots.opacity[i]!.value = 0;
            continue;
          }
          slots.x[i]!.value = s.position.x;
          slots.y[i]!.value = s.position.y;
          slots.opacity[i]!.value = s.opacity;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [system, effect, def, width, height, slots]);

  if (!def || def.particle.kind !== 'shape') return null;

  const isCircle = def.particle.shape === 'circle';
  const radius = def.particle.radius ?? 3;
  const w = def.particle.width ?? 6;
  const h = def.particle.height ?? 6;
  const color = def.particle.color ?? '#ffffff';

  return (
    <Group>
      {Array.from({ length: PARTICLE_MAX_CAPACITY }, (_, i) =>
        isCircle ? (
          <Circle key={i} cx={slots.x[i]!} cy={slots.y[i]!} r={radius} color={color} opacity={slots.opacity[i]!} />
        ) : (
          <Rect key={i} x={slots.x[i]!} y={slots.y[i]!} width={w} height={h} color={color} opacity={slots.opacity[i]!} />
        ),
      )}
    </Group>
  );
}
