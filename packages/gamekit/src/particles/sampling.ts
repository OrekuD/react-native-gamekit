import type { ParticleEffectDefinition } from './types';
import type { Point2D } from '../geometry/types';

/** Deterministic PRNG (mulberry32). Documented, schedule-independent. */
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
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function sampleRange(rng: () => number, range: { min: number; max: number }): number {
  if (range.min === range.max) return range.min;
  return range.min + rng() * (range.max - range.min);
}

/** Internal sampled seed values for one new particle slot. */
export interface SampledInitial {
  readonly active: boolean;
  readonly age: number;
  readonly lifetime: number;
  readonly origin: Point2D;
  readonly position: Point2D;
  readonly velocity: Point2D;
  readonly rotation: number;
  readonly rotationSpeed: number;
  readonly scaleStart: number;
  readonly scaleEnd: number;
  readonly scale: number;
  readonly opacity: number;
  readonly color: string;
  readonly spawnSequence: number;
  readonly effect: string;
}

/**
 * Field consumption order is fixed and documented:
 * lifetime -> speed -> direction -> rotation -> rotationSpeed -> scaleStart.
 */
export function sampleInitialSlot(
  rng: () => number,
  def: ParticleEffectDefinition,
  origin: Point2D,
  spawnSequence: number,
  effectName: string,
): SampledInitial {
  const lifetime = sampleRange(rng, def.lifetimeSeconds);
  const speed = sampleRange(rng, def.speed);
  const directionRange = def.direction ?? { min: 0, max: Math.PI * 2 };
  const direction = sampleRange(rng, directionRange);
  const rotation = def.rotation ? sampleRange(rng, def.rotation) : 0;
  const rotationSpeed = def.rotation ? sampleRange(rng, { min: -2, max: 2 }) : 0;
  const scaleRange = def.scaleOverLife ?? { min: 1, max: 1 };
  const scaleStart = sampleRange(rng, scaleRange);
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
    scaleStart,
    scaleEnd: scaleRange.max,
    scale: scaleStart,
    opacity: 1,
    color: def.particle.kind === 'shape' && def.particle.color ? def.particle.color : '#ffffff',
    spawnSequence,
    effect: effectName,
  };
}

/** The pure sampler's input view of a particle's age-independent fields. */
export interface AgeSource {
  readonly lifetime: number;
  readonly origin: Point2D;
  readonly velocity: Point2D;
  readonly rotation: number;
  readonly rotationSpeed: number;
  readonly scaleStart: number;
  readonly scaleEnd: number;
}

export interface SampledTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly opacity: number;
}

/**
 * Closed-form sampling from active age (never accumulated):
 * position = origin + v·age + ½·a·age². Positions follow the CENTER anchor
 * convention for every particle kind (T15-F5).
 */
export function sampleSlotAtAge(
  slot: AgeSource,
  def: ParticleEffectDefinition,
  age: number,
): SampledTransform {
  const t = Math.min(age / slot.lifetime, 1);
  const x = slot.origin.x + slot.velocity.x * age + 0.5 * def.gravity.x * age * age;
  const y = slot.origin.y + slot.velocity.y * age + 0.5 * def.gravity.y * age * age;
  const rotation = slot.rotation + slot.rotationSpeed * age;
  const scale = slot.scaleStart + (slot.scaleEnd - slot.scaleStart) * t;
  const opacity = def.fadeOut ? 1 - t : 1;
  return { x, y, rotation, scale, opacity };
}

/** Floating-point equality tolerance for deterministic comparisons. */
export const PARTICLE_TOLERANCE = 0.0001;
