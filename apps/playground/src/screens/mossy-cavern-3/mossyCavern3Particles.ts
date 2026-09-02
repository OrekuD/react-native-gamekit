import { createParticleSystem, defineParticleEffect } from 'rn-gamekit/particles';

import type { MossyCavern3Snapshot } from './mossyCavern3Game.ts';

export interface MossyCavern3ParticleSnapshotLike {
  readonly effectKind?: MossyCavern3Snapshot['effectKind'];
  readonly effectPosition?: {
    readonly x?: number;
    readonly y?: number;
  };
  readonly effectSequence?: number;
}

export interface MossyCavern3ParticleEmission {
  readonly kind: Exclude<MossyCavern3Snapshot['effectKind'], 'none'>;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
}

export function selectMossyCavern3ParticleEmission(
  snapshot: MossyCavern3ParticleSnapshotLike,
): MossyCavern3ParticleEmission | undefined {
  'worklet';
  const { effectKind, effectPosition, effectSequence } = snapshot;
  if (
    effectKind === undefined ||
    effectKind === 'none' ||
    effectPosition === undefined ||
    typeof effectPosition.x !== 'number' ||
    !Number.isFinite(effectPosition.x) ||
    typeof effectPosition.y !== 'number' ||
    !Number.isFinite(effectPosition.y) ||
    typeof effectSequence !== 'number' ||
    !Number.isFinite(effectSequence)
  ) {
    return undefined;
  }
  return {
    kind: effectKind,
    sequence: effectSequence,
    x: effectPosition.x,
    y: effectPosition.y,
  };
}

export function shouldEmitMossyCavern3Particle(
  current: MossyCavern3ParticleEmission | null | undefined,
  previous: MossyCavern3ParticleEmission | null | undefined,
): boolean {
  'worklet';
  // T20.4: stale same-sequence suppression as a pure predicate — renderers
  // that missed a frame must not re-emit the same committed effect. Reanimated
  // reactions type `previous` as possibly null, so both parameters accept it.
  return current !== null && current !== undefined && current.sequence !== (previous ?? undefined)?.sequence;
}

const dust = defineParticleEffect({
  burst: { count: 10 },
  capacity: 80,
  direction: { min: Math.PI, max: Math.PI * 2 },
  fadeOut: true,
  gravity: { x: 0, y: 220 },
  lifetimeSeconds: { min: 0.25, max: 0.55 },
  overflow: 'recycle-oldest',
  particle: { color: '#9bc891', kind: 'shape', radius: 4, shape: 'circle' },
  // T20.1: explicit envelope restores the intended `{ min: 1, max: 0.2 }`
  // shrink (MEMO 2026-08-28) without the ambiguous ascending range.
  scale: { start: 1, end: 0.2 },
  space: 'world',
  speed: { min: 35, max: 130 },
});

const magic = defineParticleEffect({
  burst: { count: 18 },
  capacity: 108,
  direction: { min: 0, max: Math.PI * 2 },
  fadeOut: true,
  gravity: { x: 0, y: -80 },
  lifetimeSeconds: { min: 0.45, max: 0.95 },
  overflow: 'recycle-oldest',
  particle: {
    color: '#71f5d2',
    height: 8,
    kind: 'shape',
    shape: 'rectangle',
    width: 3,
  },
  rotation: { min: -3, max: 3 },
  space: 'world',
  speed: { min: 70, max: 210 },
});

const hurt = defineParticleEffect({
  burst: { count: 24 },
  capacity: 96,
  direction: { min: 0, max: Math.PI * 2 },
  fadeOut: true,
  gravity: { x: 0, y: 260 },
  lifetimeSeconds: { min: 0.35, max: 0.8 },
  overflow: 'recycle-oldest',
  particle: { color: '#ff6b77', kind: 'shape', radius: 5, shape: 'circle' },
  space: 'world',
  speed: { min: 100, max: 280 },
});

const victory = defineParticleEffect({
  burst: { count: 40 },
  capacity: 160,
  direction: { min: Math.PI, max: Math.PI * 2 },
  fadeOut: true,
  gravity: { x: 0, y: 190 },
  lifetimeSeconds: { min: 0.8, max: 1.6 },
  overflow: 'recycle-oldest',
  particle: {
    color: '#f9e17d',
    height: 12,
    kind: 'shape',
    shape: 'rectangle',
    width: 5,
  },
  rotation: { min: -5, max: 5 },
  space: 'world',
  speed: { min: 130, max: 360 },
});

export const MOSSY_CAVERN_3_PARTICLE_EFFECTS = Object.freeze({
  dust,
  hurt,
  magic,
  victory,
});

export function createMossyCavern3ParticleSystem() {
  return createParticleSystem({ effects: MOSSY_CAVERN_3_PARTICLE_EFFECTS });
}
