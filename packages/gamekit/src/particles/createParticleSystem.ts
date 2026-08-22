import { ParticleError } from './errors';
import { defineParticleEffect } from './defineParticleEffect';
import { createRng, sampleInitialSlot, sampleSlotAtAge } from './sampling';
import type {
  ParticleDiagnostics,
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

  const pools = new Map<string, MutableSlot[]>();
  const diagnostics = new Map<string, ParticleDiagnostics>();
  for (const [name, def] of definitions) {
    pools.set(
      name,
      Array.from({ length: def.capacity }, () => ({
        active: false,
        age: 0,
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
    }

    let active = 0;
    for (const s of pool) if (s.active) active++;
    diagnostics.set(effect, {
      active,
      emitted: diag.emitted + emitted,
      dropped: diag.dropped + dropped,
      recycled: diag.recycled + recycled,
    });
  }

  function update(deltaSeconds: number): void {
    if (status === 'disposed') throw new ParticleError('particle system is disposed');
    if (status === 'paused') return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new ParticleError('deltaSeconds must be a finite number >= 0');
    }
    for (const [name, pool] of pools) {
      const def = definitions.get(name)!;
      let active = 0;
      for (const slot of pool) {
        if (!slot.active) continue;
        slot.age += deltaSeconds;
        if (slot.age >= slot.lifetime) {
          slot.active = false;
          slot.opacity = 0;
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

  // ----- Presentation binding (T15-F6): typed, no hidden internals -----
  interface ParticleSlotBuffers {
    readonly x: Float32Array;
    readonly y: Float32Array;
    readonly rotation: Float32Array;
    readonly scale: Float32Array;
    readonly opacity: Float32Array;
    readonly visible: Uint8Array;
    readonly capacity: number;
  }
  const buffers = new Map<string, ParticleSlotBuffers>();
  for (const [name, def] of definitions) {
    buffers.set(name, {
      x: new Float32Array(def.capacity),
      y: new Float32Array(def.capacity),
      rotation: new Float32Array(def.capacity),
      scale: new Float32Array(def.capacity),
      opacity: new Float32Array(def.capacity),
      visible: new Uint8Array(def.capacity),
      capacity: def.capacity,
    });
  }

  let revision = 0;
  let running = false;
  let stopScheduled: (() => void) | null = null;
  let lastTick: (() => void) | null = null;

  function resample(): void {
    let changed = false;
    for (const [name, buf] of buffers) {
      const def = definitions.get(name)!;
      const pool = pools.get(name)!;
      let anyActive = false;
      for (let i = 0; i < buf.capacity; i++) {
        const slot = pool[i]!;
        if (!slot.active) {
          if (buf.visible[i] !== 0) {
            buf.visible[i] = 0;
            changed = true;
          }
          continue;
        }
        anyActive = true;
        const s = sampleSlotAtAge(ageView(slot), def, slot.age);
        if (
          buf.x[i] !== s.x ||
          buf.y[i] !== s.y ||
          buf.rotation[i] !== s.rotation ||
          buf.scale[i] !== s.scale ||
          buf.opacity[i] !== s.opacity ||
          buf.visible[i] !== 1
        ) {
          changed = true;
        }
        buf.x[i] = s.x;
        buf.y[i] = s.y;
        buf.rotation[i] = s.rotation;
        buf.scale[i] = s.scale;
        buf.opacity[i] = s.opacity;
        buf.visible[i] = 1;
      }
      void anyActive;
    }
    if (changed) revision++;
  }

  function onTick(): void {
    if (!running || status !== 'running') return;
    update(stepSeconds);
    resample();
  }
  let stepSeconds = 1 / 60;

  const binding: ParticlePresentationBinding = {
    systemGeneration: generation,
    definition(effect: string): ParticleEffectDefinition {
      return requireEffect(effect);
    },
    effects: Object.freeze([...definitions.keys()]),
    tick(deltaSeconds: number): void {
      // Manual/headless entry point: advances even before start() so tests
      // and custom drivers can drive frames deterministically.
      if (status === 'disposed') return;
      update(deltaSeconds);
      resample();
    },
    start(schedule, step = 1 / 60): void {
      if (running) {
        throw new ParticleError('presentation clock already started — one owner per binding');
      }
      if (status === 'disposed') {
        throw new ParticleError('particle system is disposed');
      }
      running = true;
      stepSeconds = step;
      lastTick = () => onTick();
      stopScheduled = schedule(() => {
        if (lastTick) lastTick();
      });
    },
    stop(): void {
      running = false;
      lastTick = null;
      if (stopScheduled) {
        const s = stopScheduled;
        stopScheduled = null;
        s();
      }
    },
    get running() {
      return running;
    },
    get revision() {
      return revision;
    },
    slots(effect: string) {
      requireEffect(effect);
      const b = buffers.get(effect);
      if (b === undefined) throw new ParticleError(`unknown particle effect ${JSON.stringify(effect)}`);
      return b;
    },
  };
  Object.freeze(binding);

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
      if (running) binding.stop();
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
      for (const buf of buffers.values()) {
        buf.visible.fill(0);
      }
      revision++;
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
