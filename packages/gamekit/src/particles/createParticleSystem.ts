import { ParticleError } from './errors';
import { createRng, sampleInitialSlot, sampleSlotAtAge } from './sampling';
import type { ParticleDiagnostics, ParticleEffectDefinition, ParticleEmitCommand, ParticleSlot, ParticleSystem, ParticleSystemOptions } from './types';

function assertCommand(cmd: unknown): asserts cmd is ParticleEmitCommand {
  if (!cmd || typeof cmd !== 'object') throw new ParticleError('emit command must be object');
  const c = cmd as Record<string, unknown>;
  if (!c.position || typeof (c.position as {x:unknown}).x !== 'number' || !Number.isFinite((c.position as {x:number}).x)) throw new ParticleError('command.position.x must be finite');
  if (typeof (c.position as {y:unknown}).y !== 'number' || !Number.isFinite((c.position as {y:number}).y)) throw new ParticleError('command.position.y must be finite');
  if (typeof c.seed !== 'number' || !Number.isFinite(c.seed)) throw new ParticleError('command.seed must be finite');
}

export function createParticleSystem<TEffects extends Record<string, ParticleEffectDefinition>>(
  options: ParticleSystemOptions & { effects: TEffects },
): ParticleSystem<TEffects> {
  if (!options || typeof options.effects !== 'object') throw new ParticleError('effects required');
  const effectNames = Object.keys(options.effects);
  if (effectNames.length === 0) throw new ParticleError('at least one effect required');
  const definitions = new Map<string, ParticleEffectDefinition>();
  for (const name of effectNames) {
    const def = options.effects[name]!;
    if (!def) throw new ParticleError(`effect ${name} missing`);
    definitions.set(name, def);
  }

  let disposed = false;
  let paused = false;
  let generation = 0;
  let spawnSequence = 0;
  const pools = new Map<string, ParticleSlot[]>();
  const diagnostics = new Map<string, ParticleDiagnostics>();
  for (const [name, def] of definitions) {
    const pool: ParticleSlot[] = Array.from({ length: def.capacity }, () => ({
      active: false,
      age: 0,
      lifetime: 0,
      origin: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      rotation: 0,
      rotationSpeed: 0,
      scale: 1,
      scaleStart: 1,
      scaleEnd: 1,
      opacity: 0,
      color: '#fff',
      spawnSequence: -1,
      effect: name,
    }));
    pools.set(name, pool);
    diagnostics.set(name, { active: 0, emitted: 0, dropped: 0, recycled: 0 });
  }

  function getDiagnostics(effect?: string): ParticleDiagnostics {
    if (effect) {
      const d = diagnostics.get(effect);
      if (!d) throw new ParticleError(`unknown effect ${effect}`);
      return { ...d };
    }
    let active=0, emitted=0, dropped=0, recycled=0;
    for (const d of diagnostics.values()) { active+=d.active; emitted+=d.emitted; dropped+=d.dropped; recycled+=d.recycled; }
    return { active, emitted, dropped, recycled };
  }

  function emit(effect: string, command: ParticleEmitCommand): void {
    if (disposed) throw new ParticleError('particle system is disposed');
    if (paused) {
      // External emissions while paused use drop-new policy (all paused emissions are dropped)
      const d = diagnostics.get(effect);
      if (d) diagnostics.set(effect, { ...d, dropped: d.dropped + 1 });
      return;
    }
    const def = definitions.get(effect);
    if (!def) throw new ParticleError(`unknown effect ${effect}`);
    assertCommand(command);
    const pool = pools.get(effect)!;
    const diag = diagnostics.get(effect)!;
    const rng = createRng(command.seed >>> 0);
    // Check stale generation - for replacement, we use generation token
    // For v1, we reject if system generation has advanced (replacement controller)
    // Here generation is per-system, not per-effect, but we check disposed only
    const burstCount = def.burst.count;
    let emitted = 0;
    let dropped = 0;
    let recycled = 0;
    for (let i=0; i<burstCount; i++) {
      // Find slot
      let slotIndex = -1;
      let oldestIndex = -1;
      let oldestSeq = Infinity;
      for (let s=0; s<pool.length; s++) {
        const slot = pool[s]!;
        if (!slot.active) { slotIndex = s; break; }
        if (slot.spawnSequence < oldestSeq) { oldestSeq = slot.spawnSequence; oldestIndex = s; }
      }
      if (slotIndex === -1) {
        if (def.overflow === 'drop-new') {
          dropped++;
          continue;
        } else {
          // recycle-oldest
          slotIndex = oldestIndex;
          if (slotIndex === -1) { dropped++; continue; }
          recycled++;
        }
      } else {
        emitted++;
      }
      const slot = pool[slotIndex]!;
      // Sample initial values - deterministic order: lifetime, speed, direction, rotation, scale
      const sampled = sampleInitialSlot(rng, def, command.position, spawnSequence++, effect);
      // Reset every field when recycling (F2)
      slot.active = true;
      slot.age = 0;
      slot.lifetime = sampled.lifetime;
      slot.origin = { x: sampled.origin.x, y: sampled.origin.y };
      slot.position = { x: sampled.position.x, y: sampled.position.y };
      slot.velocity = { x: sampled.velocity.x, y: sampled.velocity.y };
      slot.rotation = sampled.rotation;
      slot.rotationSpeed = sampled.rotationSpeed;
      slot.scale = sampled.scale;
      slot.scaleStart = sampled.scaleStart;
      slot.scaleEnd = sampled.scaleEnd;
      slot.opacity = sampled.opacity;
      slot.color = sampled.color;
      slot.spawnSequence = sampled.spawnSequence;
      slot.effect = effect;
    }
    const active = pool.filter(s=>s.active).length;
    diagnostics.set(effect, { active, emitted: diag.emitted + emitted, dropped: diag.dropped + dropped, recycled: diag.recycled + recycled });
  }

  function update(deltaSeconds: number): void {
    if (disposed || paused) return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new ParticleError('deltaSeconds must be finite >=0');
    for (const [name, pool] of pools) {
      const def = definitions.get(name)!;
      let activeCount = 0;
      for (const slot of pool) {
        if (!slot.active) continue;
        slot.age += deltaSeconds;
        if (slot.age >= slot.lifetime) {
          slot.active = false;
          slot.opacity = 0;
          continue;
        }
        // Analytic sampling at age
        const sampled = sampleSlotAtAge(slot, def, slot.age);
        // For position, we need to compute from origin; but slot.position currently holds current position, not origin
        // To keep analytic, we store origin as initial position and recompute each frame from origin
        // However our slot.position is overwritten each frame to new sampled position for rendering
        // For v1, we approximate by using sampled position as new absolute (since we don't store origin separately, we treat slot.position as origin at spawn and update via analytic)
        // To make schedule-independent, we store origin separately? Simplify: use returned position as absolute
        slot.position = sampled.position;
        slot.rotation = sampled.rotation;
        slot.scale = sampled.scale;
        slot.opacity = sampled.opacity;
        activeCount++;
      }
      const d = diagnostics.get(name)!;
      diagnostics.set(name, { ...d, active: activeCount });
    }
  }

  function pause(): void {
    if (disposed) throw new ParticleError('particle system is disposed');
    paused = true;
  }

  function resume(): void {
    if (disposed) throw new ParticleError('particle system is disposed');
    paused = false;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    generation++;
    for (const pool of pools.values()) {
      for (const slot of pool) {
        slot.active = false;
        slot.age = 0;
        slot.opacity = 0;
        slot.origin = { x: 0, y: 0 };
        slot.position = { x: 0, y: 0 };
        slot.velocity = { x: 0, y: 0 };
        slot.spawnSequence = -1;
      }
    }
    // Clear diagnostics active but keep emitted etc? For v1, reset active only
    for (const [name, d] of diagnostics) {
      diagnostics.set(name, { ...d, active: 0 });
    }
  }

  function getActiveParticles(effect: string): readonly ParticleSlot[] {
    const pool = pools.get(effect);
    if (!pool) throw new ParticleError(`unknown effect ${effect}`);
    return pool.filter(s=>s.active);
  }

  const system = {
    emit,
    update,
    pause,
    resume,
    dispose,
    getDiagnostics,
    getActiveParticles,
    getActiveParticlesSafe(effect: string): readonly ParticleSlot[] {
      try { return getActiveParticles(effect); } catch { return []; }
    },
    get isPaused() { return paused; },
    get isDisposed() { return disposed; },
    get generation() { return generation; },
  };
  // Renderer access to validated definitions (not part of the public type;
  // plain values only — no native handles).
  Object.defineProperty(system, '__definitions', {
    value: definitions,
    enumerable: false,
    writable: false,
  });
  return system as unknown as ParticleSystem<TEffects> & {
    __definitions: Map<string, ParticleEffectDefinition>;
    getActiveParticlesSafe(e: string): readonly ParticleSlot[];
  };
}
