import type { ParticleEffectDefinition, ParticleSlot } from './types';
import type { Point2D } from '../geometry/types';

// Deterministic PRNG: mulberry32, documented consumption order
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(seed: number): number {
  // Simple hash for seed derivation
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function sampleRange(rng: () => number, range: { min: number; max: number }): number {
  if (range.min === range.max) return range.min;
  return range.min + rng() * (range.max - range.min);
}

// Closed-form sampling: position(age) = origin + velocity*age + 0.5*acc*age^2
// Field consumption order is fixed and documented for determinism:
// lifetime, speed, direction, rotation, scale, velocity x/y, color offset (if any)
export function sampleInitialSlot(
  rng: () => number,
  def: ParticleEffectDefinition,
  origin: Point2D,
  spawnSequence: number,
  effectName: string,
): Omit<ParticleSlot, 'active' | 'age'> & { active: boolean; age: number } {
  const lifetime = sampleRange(rng, def.lifetimeSeconds);
  const speed = sampleRange(rng, def.speed);
  const directionRange = def.direction ?? { min: 0, max: Math.PI * 2 };
  const direction = sampleRange(rng, directionRange);
  const rotation = def.rotation ? sampleRange(rng, def.rotation) : 0;
  const rotationSpeed = def.rotation ? sampleRange(rng, { min: -2, max: 2 }) : 0;
  const scaleRange = def.scaleOverLife ?? { min: 1, max: 1 };
  const scaleStart = sampleRange(rng, scaleRange);
  const scaleEnd = def.fadeOut ? 0.2 : scaleStart;
  // Velocity from speed + direction
  const vx = Math.cos(direction) * speed;
  const vy = Math.sin(direction) * speed;

  return {
    active: true,
    age: 0,
    lifetime,
    origin: { x: origin.x, y: origin.y },
    position: { x: origin.x, y: origin.y },
    velocity: { x: vx, y: vy },
    rotation,
    rotationSpeed,
    scale: scaleStart,
    scaleStart,
    scaleEnd,
    opacity: 1,
    color: (def.particle.kind === 'shape' && def.particle.color) ? def.particle.color : '#ffffff',
    spawnSequence,
    effect: effectName,
  };
}

export function sampleSlotAtAge(
  slot: ParticleSlot,
  def: ParticleEffectDefinition,
  age: number,
): { position: Point2D; rotation: number; scale: number; opacity: number } {
  const t = Math.min(age / slot.lifetime, 1);
  // position = origin + v*age + 0.5*a*age^2 ; but we store current position as origin + ...; for analytic we use slot.position as origin and slot.velocity as initial
  // Actually slot.position is current sampled position at age, but we store origin in position at spawn. For analytic, we compute from origin.
  // To keep pure, we compute from stored origin+velocity
  // Note: slot.position at spawn is origin; we update it analytically each frame via this function
  // For simplicity, caller will use returned position
  const ax = def.gravity.x;
  const ay = def.gravity.y;
  // This assumes slot.position is origin; caller must have stored origin separately or we recompute from slot's initial origin
  // For v1, we store origin in slot.position at age 0, and sample returns new position
  const x = slot.origin.x + slot.velocity.x * age + 0.5 * ax * age * age;
  const y = slot.origin.y + slot.velocity.y * age + 0.5 * ay * age * age;
  const rotation = slot.rotation + slot.rotationSpeed * age;
  const scale = slot.scaleStart + (slot.scaleEnd - slot.scaleStart) * t;
  const opacity = def.fadeOut ? 1 - t : 1;
  return { position: { x, y }, rotation, scale, opacity };
}

// Tolerance for floating equality
export const PARTICLE_TOLERANCE = 0.0001;
