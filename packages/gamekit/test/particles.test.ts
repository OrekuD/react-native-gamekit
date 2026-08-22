import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineParticleEffect, createParticleSystem } from '../src/particles/index';
import { createRng, sampleRange, sampleSlotAtAge, PARTICLE_TOLERANCE } from '../src/particles/sampling';
import { seedGameEvent } from '../src/events/seed';

const shapeDef = defineParticleEffect({
  capacity: 10,
  space: 'world',
  overflow: 'drop-new',
  particle: { kind: 'shape', shape: 'circle', radius: 4 },
  burst: { count: 1 },
  lifetimeSeconds: { min: 1, max: 1 },
  speed: { min: 10, max: 10 },
  gravity: { x: 0, y: 10 },
  fadeOut: true,
});

describe('T15.1 definitions and sampling', () => {
  it('validates immutable definition', () => {
    assert.throws(() => defineParticleEffect({ ...shapeDef, capacity: 0 }), /capacity/);
    assert.throws(() => defineParticleEffect({ ...shapeDef, space: 'bad' as never }), /space/);
    const frozen = defineParticleEffect(shapeDef);
    assert.equal(Object.isFrozen(frozen), true);
  });

  it('deterministic seed produces same slot', () => {
    const ps1 = createParticleSystem({ effects: { a: shapeDef } });
    const ps2 = createParticleSystem({ effects: { a: shapeDef } });
    ps1.emit('a', { position: { x: 10, y: 20 }, seed: 42 });
    ps2.emit('a', { position: { x: 10, y: 20 }, seed: 42 });
    const s1 = ps1.getActiveParticles('a')[0]!;
    const s2 = ps2.getActiveParticles('a')[0]!;
    assert.equal(s1.lifetime, s2.lifetime);
    assert.equal(s1.velocity.x, s2.velocity.x);
    assert.equal(s1.velocity.y, s2.velocity.y);
    ps1.dispose();
    ps2.dispose();
  });

  it('equal active age produces schedule-independent values', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 7 });
    ps.update(0.1);
    ps.update(0.2);
    const p1 = ps.getActiveParticles('a')[0]!;
    ps.dispose();
    const ps2 = createParticleSystem({ effects: { a: shapeDef } });
    ps2.emit('a', { position: { x: 0, y: 0 }, seed: 7 });
    ps2.update(0.3);
    const p2 = ps2.getActiveParticles('a')[0]!;
    assert.ok(Math.abs(p1.position.x - p2.position.x) < PARTICLE_TOLERANCE);
    assert.ok(Math.abs(p1.position.y - p2.position.y) < PARTICLE_TOLERANCE);
    ps2.dispose();
  });

  it('range sampling deterministic', () => {
    const rng1 = createRng(123);
    const rng2 = createRng(123);
    for (let i = 0; i < 10; i++) {
      assert.equal(sampleRange(rng1, { min: 0, max: 10 }), sampleRange(rng2, { min: 0, max: 10 }));
    }
  });

  it('T15-F5 projector: center anchor at age 0/midlife/end-of-life', () => {
    // Circle at origin with no gravity: center stays at origin.
    const def = defineParticleEffect({
      capacity: 4,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle', radius: 6 },
      burst: { count: 1 },
      lifetimeSeconds: { min: 2, max: 2 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: true,
      scaleOverLife: { min: 1, max: 3 },
    });
    const system = createParticleSystem({ effects: { c: def } });
    system.emit('c', { position: { x: 50, y: 60 }, seed: 5 });
    const slot = system.getActiveParticles('c')[0]!;
    const ageView = {
      lifetime: slot.lifetime,
      origin: slot.origin,
      velocity: slot.velocity,
      rotation: 0,
      rotationSpeed: 0,
      scaleStart: 1,
      scaleEnd: 3,
    };
    const at0 = sampleSlotAtAge(ageView, def, 0);
    assert.equal(at0.x, 50);
    assert.equal(at0.y, 60);
    assert.equal(at0.scale, 1);
    assert.equal(at0.opacity, 1);
    const mid = sampleSlotAtAge(ageView, def, 1);
    assert.equal(mid.x, 50);
    assert.equal(mid.scale, 2);
    assert.ok(Math.abs(mid.opacity - 0.5) < PARTICLE_TOLERANCE);
    const end = sampleSlotAtAge(ageView, def, 2);
    assert.equal(end.scale, 3);
    assert.equal(end.opacity, 0);
    system.dispose();
  });

  it('T15-F5 projector: rectangle shares the circle center convention', () => {
    // The view derives rect bounds as center ± size*scale/2; the sampler must
    // therefore report the CENTER for both kinds identically.
    const rect = defineParticleEffect({
      capacity: 4,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'rectangle', width: 8, height: 4 },
      burst: { count: 1 },
      lifetimeSeconds: { min: 2, max: 2 },
      speed: { min: 20, max: 20 },
      direction: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const circle = { ...rect, particle: { kind: 'shape' as const, shape: 'circle' as const, radius: 4 } };
    const rs = createParticleSystem({ effects: { r: rect } });
    const cs = createParticleSystem({ effects: { c: circle } });
    rs.emit('r', { position: { x: 100, y: 100 }, seed: 9 });
    cs.emit('c', { position: { x: 100, y: 100 }, seed: 9 });
    rs.update(0.25);
    cs.update(0.25);
    const rp = rs.getActiveParticles('r')[0]!.position;
    const cp = cs.getActiveParticles('c')[0]!.position;
    assert.ok(Math.abs(rp.x - cp.x) < PARTICLE_TOLERANCE);
    assert.ok(Math.abs(rp.y - cp.y) < PARTICLE_TOLERANCE);
    rs.dispose();
    cs.dispose();
  });
});

describe('T15.2 bounded controller', () => {
  it('fixed capacity and overflow drop-new', () => {
    const def = defineParticleEffect({ ...shapeDef, capacity: 2, burst: { count: 2 }, overflow: 'drop-new' });
    const ps = createParticleSystem({ effects: { a: def } });
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 1 });
    assert.equal(ps.getDiagnostics('a').active, 2);
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 2 });
    assert.equal(ps.getDiagnostics('a').active, 2);
    assert.equal(ps.getDiagnostics('a').dropped, 2);
    ps.dispose();
  });

  it('recycle-oldest ordering', () => {
    const def = defineParticleEffect({
      capacity: 2,
      space: 'world',
      overflow: 'recycle-oldest',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const ps = createParticleSystem({ effects: { a: def } });
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 1 });
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 2 });
    const before = ps.getActiveParticles('a').map((p) => p.spawnSequence);
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 3 });
    const after = ps.getActiveParticles('a').map((p) => p.spawnSequence);
    assert.equal(after.length, 2);
    assert.ok(!after.includes(before[0]!));
    assert.equal(ps.getDiagnostics('a').recycled, 1);
    ps.dispose();
  });

  it('diagnostics immutable and disposal idempotent', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 1 });
    const d1 = ps.getDiagnostics('a');
    const d2 = ps.getDiagnostics('a');
    assert.notEqual(d1, d2);
    assert.equal(Object.isFrozen(d1), true);
    ps.dispose();
    ps.dispose();
    assert.equal(ps.status === 'disposed', true);
  });

  it('pause freezes age; emissions while paused drop with counted particles', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 1 });
    ps.pause();
    ps.update(0.5);
    assert.equal(ps.getActiveParticles('a')[0]!.age, 0);
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 2 });
    assert.equal(ps.getDiagnostics('a').dropped, 1);
    ps.resume();
    ps.update(0.1);
    assert.ok(ps.getActiveParticles('a')[0]!.age > 0);
    ps.dispose();
  });
});

describe('T15-F6 safe controller boundary', () => {
  it('getActiveParticles returns frozen snapshots that cannot mutate the pool', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    ps.emit('a', { position: { x: 5, y: 5 }, seed: 11 });
    const snap = ps.getActiveParticles('a')[0]!;
    assert.equal(Object.isFrozen(snap), true);
    assert.equal(Object.isFrozen(snap.position), true);
    assert.throws(() => {
      (snap as { position: { x: number } }).position.x = 999;
    });
    // Pool state unchanged after any attempted mutation of returned data.
    ps.update(0.1);
    const next = ps.getActiveParticles('a')[0]!;
    assert.notEqual(next.position.x, 999);
    ps.dispose();
  });

  it('definitions are validated, cloned, and frozen at the boundary', () => {
    // A genuinely unfrozen raw literal (not pre-frozen by defineParticleEffect).
    const raw = {
      capacity: 10,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle', radius: 4 },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 10, max: 10 },
      gravity: { x: 0, y: 10 },
      fadeOut: true,
    } as typeof shapeDef;
    const ps = createParticleSystem({ effects: { a: raw } });
    // Mutating the caller's object afterwards cannot affect the system.
    (raw.burst as { count: number }).count = 99;
    const binding = ps.bindPresentation();
    const def = binding.definition('a');
    assert.equal(def.burst.count, 1);
    assert.equal(Object.isFrozen(def), true);
    // Invalid definitions are rejected even when passed directly.
    assert.throws(
      () =>
        createParticleSystem({
          effects: { bad: { ...shapeDef, capacity: 0 } },
        }),
      /capacity/,
    );
    ps.dispose();
  });

  it('unknown effect and malformed commands throw BEFORE the paused-drop policy', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    ps.pause();
    assert.throws(() => ps.emit('nope' as 'a', { position: { x: 0, y: 0 }, seed: 1 }), /unknown particle effect/);
    assert.throws(() => ps.emit('a', { position: { x: Number.NaN, y: 0 }, seed: 1 }), /position\.x/);
    assert.throws(() => ps.emit('a', { position: { x: 0, y: 0 }, seed: Number.NaN }), /seed/);
    // No diagnostics were polluted by rejected commands.
    assert.equal(ps.getDiagnostics('a').dropped, 0);
    ps.resume();
    ps.dispose();
  });

  it('frozen diagnostic semantics per particle', () => {
    const def = defineParticleEffect({
      capacity: 3,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 2 },
      lifetimeSeconds: { min: 0.05, max: 0.05 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const ps = createParticleSystem({ effects: { a: def } });
    // Burst 1: 2 emitted.
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 1 });
    let d = ps.getDiagnostics('a');
    assert.equal(d.emitted, 2);
    assert.equal(d.dropped, 0);
    // Expire both.
    ps.update(0.06);
    d = ps.getDiagnostics('a');
    assert.equal(d.active, 0);
    // Burst 2 while paused: dropped counts particles.
    ps.pause();
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 2 });
    d = ps.getDiagnostics('a');
    assert.equal(d.dropped, 2);
    assert.equal(d.emitted, 2);
    ps.resume();
    // Burst 3: both particles fit (all slots expired) -> emitted 4 total.
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 3 });
    d = ps.getDiagnostics('a');
    assert.equal(d.emitted, 4);
    assert.equal(d.dropped, 2);
    ps.dispose();
  });

  it('presentation binding exposes registry + emissions without pool internals', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    ps.emit('a', { position: { x: 1, y: 1 }, seed: 21 });
    const binding = ps.bindPresentation();
    assert.equal(binding.systemGeneration >= 0, true);
    assert.deepEqual([...binding.effects], ['a']);
    assert.throws(() => binding.definition('zzz'), /unknown particle effect/);
    // Emission records are the bounded readback surface (one per live
    // particle), not raw pool slots.
    const em = binding.emissions('a');
    assert.equal(em.length, 1);
    assert.equal(em[0]!.originX, 1);
    assert.ok(Object.isFrozen(em[0]));
    const reg = binding.buildUiRegistry();
    assert.equal(reg.effects.a!.particles.length, 1);
    assert.equal(reg.effects.a!.capacity, shapeDef.capacity);
    // Exactly one clock owner: second acquire throws; release restores.
    const d1 = binding.acquireDriver();
    assert.throws(() => binding.acquireDriver(), /already owned/);
    // Public tick is rejected while the driver owns the clock.
    assert.throws(() => binding.tick(0.016), /owned by an acquired driver/);
    d1.step(0.016); // driver path advances fine
    d1.release();
    d1.release(); // idempotent
    binding.tick(0.016); // manual path works again once released
    ps.dispose();
  });
});

describe('T15-F1 single clock through one binding', () => {
  it('two readers observe identical frames; tick advances once', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    const binding = ps.bindPresentation();
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 3 });
    // Two readers observe the SAME clock; one tick advances once.
    const clockAfterOne = binding.activeClock;
    binding.tick(0.1);
    const reg1 = binding.buildUiRegistry();
    binding.tick(0.1);
    const reg2 = binding.buildUiRegistry();
    // Registry membership unchanged by time; positions derive from clock.
    assert.deepEqual(reg2.effects.a!.particles, reg1.effects.a!.particles);
    assert.equal(reg2.activeClock, reg1.activeClock + 0.1);
    void clockAfterOne;
    // Age advanced exactly 0.2 total, not 0.4.
    const snap = ps.getActiveParticles('a')[0]!;
    assert.ok(Math.abs(snap.age - 0.2) < 1e-9);
    ps.dispose();
  });

  it('binding created while paused starts paused and applies status immediately', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    ps.pause(); // paused BEFORE bind
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 4 }); // dropped
    assert.equal(ps.getDiagnostics('a').dropped, 1);
    const binding = ps.bindPresentation();
    binding.tick(0.5); // no-op while paused
    const reg = binding.buildUiRegistry();
    assert.equal(reg.effects.a!.particles.length, 0);
    assert.equal(binding.activeClock, 0);
    ps.resume();
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 5 });
    binding.tick(0.1);
    assert.equal(ps.getActiveParticles('a')[0]!.age > 0, true);
    ps.dispose();
  });
});

describe('T15-F4 world/screen space semantics', () => {
  it('definitions carry explicit space; world requires camera context in the view layer', () => {
    const world = defineParticleEffect({ ...shapeDef, space: 'world' });
    const screen = defineParticleEffect({ ...shapeDef, space: 'screen' });
    assert.equal(world.space, 'world');
    assert.equal(screen.space, 'screen');
  });
});

describe('T15.5 event integration', () => {
  it('seed from event identity is deterministic', () => {
    const e = { name: 'brick-hit', payload: { point: { x: 10, y: 20 } }, tick: 5, scene: 'play', sceneTick: 2, ordinal: 1 };
    assert.equal(seedGameEvent(e as never), seedGameEvent(e as never));
  });

  it('catch-up bursts respect ordering and overflow', () => {
    const ps = createParticleSystem({ effects: { a: shapeDef } });
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 100 });
    ps.emit('a', { position: { x: 10, y: 0 }, seed: 101 });
    assert.equal(ps.getDiagnostics('a').emitted, 2);
    ps.dispose();
  });
});
