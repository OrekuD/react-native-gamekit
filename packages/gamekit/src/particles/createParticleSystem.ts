import { ParticleError } from './errors';
import { defineParticleEffect } from './defineParticleEffect';
import { createRng, sampleInitialSlot, sampleSlotAtAge } from './sampling';
import type {
  ParticleDiagnostics,
  ParticleEmissionRecord,
  ParticleUiRegistry,
  ParticleDriverHandle,
  ParticleEffectDefinition,
  ParticlePresentationBinding,
  ParticleSlotSnapshot,
  ParticleSystem,
  ParticleSystemOptions,
} from './types';
import type { Point2D } from '../geometry/types';

/** Adapter from the mutable pool slot to the pure sampler's input. */
function ageView(slot: MutableSlot): {
  readonly lifetime: number;
  readonly origin: Point2D;
  readonly velocity: Point2D;
  readonly rotation: number;
  readonly rotationSpeed: number;
  readonly scaleStart: number;
  readonly scaleEnd: number;
} {
  return {
    lifetime: slot.lifetime,
    origin: { x: slot.originX, y: slot.originY },
    velocity: { x: slot.vx, y: slot.vy },
    rotation: slot.rotation,
    rotationSpeed: slot.rotationSpeed,
    scaleStart: slot.scaleStart,
    scaleEnd: slot.scaleEnd,
  };
}

function assertCommand(cmd: unknown): asserts cmd is { position: Point2D; seed: number } {
  if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) {
    throw new ParticleError('emit command must be an object');
  }
  const c = cmd as Record<string, unknown>;
  const pos = c.position;
  if (pos === null || typeof pos !== 'object' || Array.isArray(pos)) {
    throw new ParticleError('emit command position must be {x,y}');
  }
  const pp = pos as Record<string, unknown>;
  if (typeof pp.x !== 'number' || !Number.isFinite(pp.x)) {
    throw new ParticleError('emit command position.x must be a finite number');
  }
  if (typeof pp.y !== 'number' || !Number.isFinite(pp.y)) {
    throw new ParticleError('emit command position.y must be a finite number');
  }
  if (typeof c.seed !== 'number' || !Number.isFinite(c.seed)) {
    throw new ParticleError('emit command seed must be a finite number');
  }
}

interface MutableSlot {
  active: boolean;
  age: number;
  bornAt: number;
  lifetime: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  scaleStart: number;
  scaleEnd: number;
  opacity: number;
  color: string;
  spawnSequence: number;
}

export function createParticleSystem<TEffects extends Record<string, ParticleEffectDefinition>>(
  options: ParticleSystemOptions & { effects: TEffects },
): ParticleSystem<TEffects> {
  if (options === null || typeof options !== 'object') {
    throw new ParticleError('createParticleSystem requires options');
  }
  const rawEffects = options.effects;
  if (rawEffects === null || typeof rawEffects !== 'object') {
    throw new ParticleError('createParticleSystem requires { effects }');
  }
  const names = Object.keys(rawEffects);
  if (names.length === 0) {
    throw new ParticleError('createParticleSystem effects must not be empty');
  }

  // T15-F6: validate, clone, and freeze every definition at the boundary so
  // callers cannot bypass defineParticleEffect or mutate after creation.
  const definitions = new Map<string, ParticleEffectDefinition>();
  for (const name of names) {
    definitions.set(name, defineParticleEffect(rawEffects[name]!));
  }

  let status: 'running' | 'paused' | 'disposed' = 'running';
  let generation = 0;
  let spawnSequence = 0;
  // Accumulated ACTIVE time — freezes while paused (T15-SF3).
  let activeClock = 0;
  // Emission registry revision (membership changes only).
  let registryRevision = 0;
  const emissionsLog: Map<string, ParticleEmissionRecord[]> = new Map();

  const pools = new Map<string, MutableSlot[]>();
  const diagnostics = new Map<string, ParticleDiagnostics>();
  for (const [name, def] of definitions) {
    pools.set(
      name,
      Array.from({ length: def.capacity }, () => ({
        active: false,
        age: 0,
        bornAt: 0,
        lifetime: 1,
        originX: 0,
        originY: 0,
        vx: 0,
        vy: 0,
        rotation: 0,
        rotationSpeed: 0,
        scaleStart: 1,
        scaleEnd: 1,
        opacity: 0,
        color: '#ffffff',
        spawnSequence: -1,
      })),
    );
    diagnostics.set(name, { active: 0, emitted: 0, dropped: 0, recycled: 0 });
    emissionsLog.set(name, []);
  }

  function requireEffect(effect: string): ParticleEffectDefinition {
    const def = definitions.get(effect);
    if (def === undefined) {
      throw new ParticleError(`unknown particle effect ${JSON.stringify(effect)}`);
    }
    return def;
  }

  function frozenSnapshot(effect: string): ParticleDiagnostics {
    const d = diagnostics.get(effect);
    return d === undefined
      ? Object.freeze({ active: 0, emitted: 0, dropped: 0, recycled: 0 })
      : Object.freeze({ ...d });
  }

  function emit(effect: string, command: unknown): void {
    // T15-F6: validate effect key and command BEFORE the paused policy so
    // malformed input is never silently swallowed as a paused drop.
    const def = requireEffect(effect);
    assertCommand(command);
    if (status === 'disposed') {
      throw new ParticleError('particle system is disposed');
    }
    if (status === 'paused') {
      const d = diagnostics.get(effect)!;
      diagnostics.set(effect, {
        ...d,
        dropped: d.dropped + def.burst.count,
      });
      return;
    }

    const pool = pools.get(effect)!;
    const diag = diagnostics.get(effect)!;
    const rng = createRng(command.seed >>> 0);
    let emitted = 0;
    let dropped = 0;
    let recycled = 0;

    for (let i = 0; i < def.burst.count; i++) {
      let slotIndex = -1;
      let oldestIndex = -1;
      let oldestSeq = Number.POSITIVE_INFINITY;
      for (let s = 0; s < pool.length; s++) {
        const slot = pool[s]!;
        if (!slot.active) {
          slotIndex = s;
          break;
        }
        if (slot.spawnSequence < oldestSeq) {
          oldestSeq = slot.spawnSequence;
          oldestIndex = s;
        }
      }
      if (slotIndex === -1) {
        if (def.overflow === 'drop-new') {
          dropped++;
          continue;
        }
        slotIndex = oldestIndex;
        if (slotIndex === -1) {
          dropped++;
          continue;
        }
        recycled++;
      }
      emitted++;
      const slot = pool[slotIndex]!;
      const sampled = sampleInitialSlot(rng, def, command.position, spawnSequence++, effect);
      slot.active = true;
      slot.age = 0;
      slot.bornAt = activeClock;
      slot.lifetime = sampled.lifetime;
      slot.originX = sampled.origin.x;
      slot.originY = sampled.origin.y;
      slot.vx = sampled.velocity.x;
      slot.vy = sampled.velocity.y;
      slot.rotation = sampled.rotation;
      slot.rotationSpeed = sampled.rotationSpeed;
      slot.scaleStart = sampled.scaleStart;
      slot.scaleEnd = sampled.scaleEnd;
      slot.opacity = sampled.opacity;
      slot.color = sampled.color;
      slot.spawnSequence = sampled.spawnSequence;
      const log = emissionsLog.get(effect)!;
      log.push(Object.freeze({
        bornAt: activeClock,
        originX: sampled.origin.x,
        originY: sampled.origin.y,
        vx: sampled.velocity.x,
        vy: sampled.velocity.y,
        rotation: sampled.rotation,
        rotationSpeed: sampled.rotationSpeed,
        scaleStart: sampled.scaleStart,
        scaleEnd: sampled.scaleEnd,
        lifetime: sampled.lifetime,
        spawnSequence: sampled.spawnSequence,
      }));
      if (log.length > def.capacity * 4) log.splice(0, log.length - def.capacity * 4);
    }

    let active = 0;
    for (const s of pool) if (s.active) active++;
    diagnostics.set(effect, {
      active,
      emitted: diag.emitted + emitted,
      dropped: diag.dropped + dropped,
      recycled: diag.recycled + recycled,
    });
    // T15-RF3: an accepted emission may end an idle period — wake the driver.
    if (emitted > 0) {
      registryRevision++;
      if (wakeListener) wakeListener();
    }
  }

  function update(deltaSeconds: number): void {
    if (status === 'disposed') throw new ParticleError('particle system is disposed');
    if (status === 'paused') return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new ParticleError('deltaSeconds must be a finite number >= 0');
    }
    activeClock += deltaSeconds;
    for (const [name, pool] of pools) {
      const def = definitions.get(name)!;
      let active = 0;
      for (const slot of pool) {
        if (!slot.active) continue;
        slot.age += deltaSeconds;
        if (slot.age >= slot.lifetime) {
          // T15-TF1: expiry IS a registry membership change — bump so the
          // pruned registry ships before the driver sleeps.
          slot.active = false;
          slot.opacity = 0;
          registryRevision++;
          continue;
        }
          const sampled = sampleSlotAtAge(ageView(slot), def, slot.age);
        slot.opacity = sampled.opacity;
        active++;
      }
      const d = diagnostics.get(name)!;
      if (d.active !== active) diagnostics.set(name, { ...d, active });
    }
  }

  let driverOwned = false;
  let releaseDriver: (() => void) | null = null;
  let wakeListener: (() => void) | null = null;

  function totalActive(): number {
    let n = 0;
    for (const pool of pools.values()) {
      for (const slot of pool) if (slot.active) n++;
    }
    return n;
  }

  function advance(deltaSeconds: number): void {
    update(deltaSeconds);
  }

  function buildRegistry(): ParticleUiRegistry {
    const effects: Record<string, { capacity: number; particles: ParticleEmissionRecord[] }> = {};
    for (const [name, def] of definitions) {
      const log = emissionsLog.get(name)!;
      const pool = pools.get(name)!;
      // Only ACTIVE emissions are shipped; expired entries are pruned here so
      // the registry stays bounded by live particles.
      const activeSeqs = new Set<number>();
      for (const slot of pool) if (slot.active) activeSeqs.add(slot.spawnSequence);
      effects[name] = {
        capacity: def.capacity,
        particles: log.filter((r) => activeSeqs.has(r.spawnSequence)),
      };
    }
    return { registryRevision, activeClock, effects };
  }

  const binding: ParticlePresentationBinding = {
    systemGeneration: generation,
    definition(effect: string): ParticleEffectDefinition {
      return requireEffect(effect);
    },
    effects: Object.freeze([...definitions.keys()]),
    tick(deltaSeconds: number): void {
      if (driverOwned) {
        throw new ParticleError(
          'presentation clock is owned by an acquired driver — use the driver handle to step',
        );
      }
      if (status === 'disposed') return;
      advance(deltaSeconds);
    },
    acquireDriver(): ParticleDriverHandle {
      if (driverOwned) {
        throw new ParticleError('presentation clock already owned — one driver per system');
      }
      if (status === 'disposed') {
        throw new ParticleError('particle system is disposed');
      }
      driverOwned = true;
      let released = false;
      releaseDriver = () => {
        driverOwned = false;
      };
      const handle: ParticleDriverHandle = {
        step(deltaSeconds: number): void {
          if (released || status === 'disposed') return;
          advance(deltaSeconds);
        },
        isIdle(): boolean {
          return totalActive() === 0;
        },
        setWakeListener(listener: (() => void) | null): void {
          wakeListener = listener;
        },
        release(): void {
          if (released) return;
          released = true;
          wakeListener = null;
          if (releaseDriver) {
            const r = releaseDriver;
            releaseDriver = null;
            r();
          }
        },
      };
      return handle;
    },
    get driverOwned() {
      return driverOwned;
    },
    get registryRevision() {
      return registryRevision;
    },
    get activeClock() {
      return activeClock;
    },
    get activeCount() {
      return status === 'disposed' ? 0 : totalActive();
    },
    buildUiRegistry(): ParticleUiRegistry {
      return Object.freeze(buildRegistry());
    },
    emissions(effect: string) {
      requireEffect(effect);
      const log = emissionsLog.get(effect);
      if (log === undefined) throw new ParticleError(`unknown particle effect ${JSON.stringify(effect)}`);
      return log.slice();
    },
  };
  Object.freeze(binding);

  // Expose the UI registry builder to the presentation layer without adding
  // it to the public binding type: the hook receives it via a typed symbol
  // free accessor defined below.


  const system: ParticleSystem<TEffects> = {
    emit: emit as ParticleSystem<TEffects>['emit'],
    update,
    pause(): void {
      if (status === 'disposed') throw new ParticleError('particle system is disposed');
      status = 'paused';
    },
    resume(): void {
      if (status === 'disposed') throw new ParticleError('particle system is disposed');
      status = 'running';
    },
    dispose(): void {
      if (status === 'disposed') return;
      status = 'disposed';
      generation++;
      if (wakeListener) wakeListener = null;
      if (releaseDriver) {
        const r = releaseDriver;
        releaseDriver = null;
        driverOwned = false;
        r();
      }
      for (const pool of pools.values()) {
        for (const slot of pool) {
          slot.active = false;
          slot.age = 0;
          slot.opacity = 0;
          slot.spawnSequence = -1;
        }
      }
      emissionsLog.clear();
      registryRevision++;
      for (const pool of pools.values()) {
        for (const slot of pool) {
          slot.active = false;
          slot.age = 0;
          slot.opacity = 0;
          slot.spawnSequence = -1;
        }
      }
      for (const [name, d] of diagnostics) {
        diagnostics.set(name, { ...d, active: 0 });
      }
    },
    getDiagnostics(effect?: keyof TEffects & string): ParticleDiagnostics {
      if (effect !== undefined) {
        requireEffect(effect);
        return frozenSnapshot(effect);
      }
      let active = 0;
      let emitted = 0;
      let dropped = 0;
      let recycled = 0;
      for (const d of diagnostics.values()) {
        active += d.active;
        emitted += d.emitted;
        dropped += d.dropped;
        recycled += d.recycled;
      }
      return Object.freeze({ active, emitted, dropped, recycled });
    },
    getActiveParticles(effect: keyof TEffects & string): readonly ParticleSlotSnapshot[] {
      requireEffect(effect);
      if (status === 'disposed') return [];
      const def = definitions.get(effect)!;
      const out: ParticleSlotSnapshot[] = [];
      for (const slot of pools.get(effect)!) {
        if (!slot.active) continue;
        const sampled = sampleSlotAtAge(ageView(slot), def, slot.age);
        const origin = { x: slot.originX, y: slot.originY };
        out.push(
          Object.freeze({
            active: true,
            age: slot.age,
            lifetime: slot.lifetime,
            origin: Object.freeze(origin),
            position: Object.freeze({ x: sampled.x, y: sampled.y }),
            velocity: Object.freeze({ x: slot.vx, y: slot.vy }),
            rotation: sampled.rotation,
            scale: sampled.scale,
            opacity: sampled.opacity,
            color: slot.color,
            spawnSequence: slot.spawnSequence,
            effect,
          }),
        );
      }
      return out;
    },
    pauseIfRunning(): void {
      if (status === 'running') status = 'paused';
    },
    resumeIfPaused(): void {
      if (status === 'paused') status = 'running';
    },
    get status() {
      return status;
    },
    bindPresentation(): ParticlePresentationBinding {
      if (status === 'disposed') throw new ParticleError('particle system is disposed');
      return binding;
    },
  };
  return Object.freeze(system);
}
