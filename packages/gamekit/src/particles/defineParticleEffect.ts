import { ParticleError } from './errors';
import type { ParticleEffectDefinition } from './types';

function assertRange(range: unknown, name: string): void {
  if (!range || typeof range !== 'object') throw new ParticleError(`${name} must be {min,max}`);
  const r = range as { min: unknown; max: unknown };
  if (typeof r.min !== 'number' || !Number.isFinite(r.min)) throw new ParticleError(`${name}.min must be finite`);
  if (typeof r.max !== 'number' || !Number.isFinite(r.max)) throw new ParticleError(`${name}.max must be finite`);
  if (r.min > r.max) throw new ParticleError(`${name}.min must be <= max`);
}

function assertPoint(p: unknown, name: string): void {
  if (!p || typeof p !== 'object') throw new ParticleError(`${name} must be {x,y}`);
  const pt = p as { x: unknown; y: unknown };
  if (typeof pt.x !== 'number' || !Number.isFinite(pt.x)) throw new ParticleError(`${name}.x must be finite`);
  if (typeof pt.y !== 'number' || !Number.isFinite(pt.y)) throw new ParticleError(`${name}.y must be finite`);
}

export function defineParticleEffect(def: ParticleEffectDefinition): ParticleEffectDefinition {
  if (!def || typeof def !== 'object') throw new ParticleError('effect definition must be an object');
  if (typeof def.capacity !== 'number' || !Number.isFinite(def.capacity) || def.capacity < 1 || def.capacity > 1024 || Math.floor(def.capacity) !== def.capacity) {
    throw new ParticleError('capacity must be integer 1..1024');
  }
  if (def.space !== 'world' && def.space !== 'screen') throw new ParticleError('space must be world or screen');
  if (def.overflow !== 'drop-new' && def.overflow !== 'recycle-oldest') throw new ParticleError('overflow must be drop-new or recycle-oldest');
  if (!def.particle || typeof def.particle !== 'object') throw new ParticleError('particle must be object');
  if (def.particle.kind === 'sprite') {
    if (typeof def.particle.sheet !== 'string' || !def.particle.sheet) throw new ParticleError('sprite sheet must be non-empty string');
    if (typeof def.particle.frame !== 'string' || !def.particle.frame) throw new ParticleError('sprite frame must be non-empty string');
    if (!def.particle.size || typeof def.particle.size.width !== 'number' || typeof def.particle.size.height !== 'number') throw new ParticleError('sprite size must be {width,height}');
  } else if (def.particle.kind === 'shape') {
    if (def.particle.shape !== 'circle' && def.particle.shape !== 'rectangle') throw new ParticleError('shape must be circle or rectangle');
  } else {
    throw new ParticleError('particle.kind must be sprite or shape');
  }
  if (!def.burst || typeof def.burst.count !== 'number' || !Number.isFinite(def.burst.count) || def.burst.count < 1 || def.burst.count > def.capacity) {
    throw new ParticleError('burst.count must be 1..capacity');
  }
  assertRange(def.lifetimeSeconds, 'lifetimeSeconds');
  if (def.lifetimeSeconds.min <= 0) throw new ParticleError('lifetimeSeconds.min must be >0');
  assertRange(def.speed, 'speed');
  if (def.speed.min < 0) throw new ParticleError('speed.min must be >=0');
  if (def.direction) assertRange(def.direction, 'direction');
  if (def.rotation) assertRange(def.rotation, 'rotation');
  if (def.scaleOverLife) assertRange(def.scaleOverLife, 'scaleOverLife');
  assertPoint(def.gravity, 'gravity');
  if (typeof def.fadeOut !== 'boolean') throw new ParticleError('fadeOut must be boolean');
  return Object.freeze({ ...def, particle: Object.freeze({ ...def.particle }), burst: Object.freeze({ ...def.burst }), lifetimeSeconds: Object.freeze({ ...def.lifetimeSeconds }), speed: Object.freeze({ ...def.speed }), gravity: Object.freeze({ ...def.gravity }) } as ParticleEffectDefinition);
}
