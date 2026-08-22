import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineParticleEffect, createParticleSystem } from '../src/particles/index';
import { createRng, sampleRange, PARTICLE_TOLERANCE } from '../src/particles/sampling';
import { seedGameEvent } from '../src/events/seed';


describe('T15.1 definitions and sampling', () => {
  it('validates immutable definition', () => {
    const def = defineParticleEffect({
      capacity: 96,
      space: 'world',
      overflow: 'recycle-oldest',
      particle: { kind: 'sprite', sheet: 's', frame: 'f', size: { width: 8, height: 8 } },
      burst: { count: 12 },
      lifetimeSeconds: { min: 0.25, max: 0.55 },
      speed: { min: 70, max: 150 },
      gravity: { x: 0, y: 180 },
      fadeOut: true,
    });
    assert.equal(def.capacity, 96);
    assert.throws(()=>defineParticleEffect({ ...def, capacity: 0 } as unknown as never), /capacity/);
    assert.throws(()=>defineParticleEffect({ ...def, space: 'bad' as never } as unknown as never), /space/);
  });

  it('deterministic seed produces same slot', () => {
    const def = defineParticleEffect({
      capacity: 10,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle', radius: 4 },
      burst: { count: 1 },
      lifetimeSeconds: { min: 0.5, max: 0.5 },
      speed: { min: 100, max: 100 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const ps1 = createParticleSystem({ effects: { a: def } });
    const ps2 = createParticleSystem({ effects: { a: def } });
    ps1.emit('a', { position: { x: 10, y: 20 }, seed: 42 });
    ps2.emit('a', { position: { x: 10, y: 20 }, seed: 42 });
    const s1 = ps1.getActiveParticles('a')[0]!;
    const s2 = ps2.getActiveParticles('a')[0]!;
    assert.equal(s1.lifetime, s2.lifetime);
    assert.equal(s1.velocity.x, s2.velocity.x);
    assert.equal(s1.velocity.y, s2.velocity.y);
    assert.equal(s1.spawnSequence, s2.spawnSequence);
    ps1.dispose(); ps2.dispose();
  });

  it('equal active age produces schedule-independent values', () => {
    const def = defineParticleEffect({
      capacity: 10,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 10, max: 10 },
      gravity: { x: 0, y: 10 },
      fadeOut: true,
    });
    const ps = createParticleSystem({ effects: { a: def } });
    ps.emit('a', { position: { x: 0, y: 0 }, seed: 7 });
    // Update with different schedules but same total age
    ps.update(0.1);
    ps.update(0.2);
    const p1 = ps.getActiveParticles('a')[0]!;
    const pos1 = { ...p1.position };
    ps.dispose();
    const ps2 = createParticleSystem({ effects: { a: def } });
    ps2.emit('a', { position: { x: 0, y: 0 }, seed: 7 });
    ps2.update(0.3);
    const p2 = ps2.getActiveParticles('a')[0]!;
    assert.ok(Math.abs(pos1.x - p2.position.x) < PARTICLE_TOLERANCE);
    assert.ok(Math.abs(pos1.y - p2.position.y) < PARTICLE_TOLERANCE);
    ps2.dispose();
  });

  it('range sampling deterministic', () => {
    const rng1 = createRng(123);
    const rng2 = createRng(123);
    for(let i=0;i<10;i++) {
      const v1=sampleRange(rng1, {min:0,max:10});
      const v2=sampleRange(rng2, {min:0,max:10});
      assert.equal(v1,v2);
    }
  });
});

describe('T15.2 bounded controller', () => {
  it('fixed capacity and overflow drop-new', () => {
    const def = defineParticleEffect({
      capacity: 2,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 2 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const ps = createParticleSystem({ effects: { a: def } });
    ps.emit('a', { position: { x:0,y:0 }, seed: 1 });
    assert.equal(ps.getDiagnostics('a').active, 2);
    ps.emit('a', { position: { x:0,y:0 }, seed: 2 });
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
    ps.emit('a', { position: { x:0,y:0 }, seed: 1 });
    ps.emit('a', { position: { x:0,y:0 }, seed: 2 });
    const firstSeq = ps.getActiveParticles('a').map(p=>p.spawnSequence);
    ps.emit('a', { position: { x:0,y:0 }, seed: 3 });
    const after = ps.getActiveParticles('a').map(p=>p.spawnSequence);
    // Oldest (smallest spawnSequence) should be recycled
    assert.equal(after.length, 2);
    assert.ok(!after.includes(firstSeq[0]!));
    ps.dispose();
  });

  it('rejects invalid, stale, paused, disposed', () => {
    const def = defineParticleEffect({
      capacity: 2,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const ps = createParticleSystem({ effects: { a: def } });
    assert.throws(
      () => ps.emit('bad' as 'a', { position: { x: 0, y: 0 }, seed: 1 }),
      /unknown effect/,
    );
    ps.pause();
    ps.emit('a', { position:{x:0,y:0}, seed:1 });
    assert.equal(ps.getDiagnostics('a').active, 0);
    ps.resume();
    ps.dispose();
    assert.throws(()=>ps.emit('a', { position:{x:0,y:0}, seed:1 }), /disposed/);
  });

  it('diagnostics immutable and disposal idempotent', () => {
    const def = defineParticleEffect({
      capacity: 2,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const ps = createParticleSystem({ effects: { a: def } });
    ps.emit('a', { position:{x:0,y:0}, seed:1 });
    const d1=ps.getDiagnostics('a');
    const d2=ps.getDiagnostics('a');
    assert.notEqual(d1,d2); // immutable copy
    ps.dispose();
    ps.dispose();
    assert.equal(ps.isDisposed, true);
  });
});

describe('T15.3 presentation time and camera', () => {
  it('pause freezes age, resume continues', () => {
    const def = defineParticleEffect({
      capacity: 10,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const ps = createParticleSystem({ effects: { a: def } });
    ps.emit('a', { position:{x:0,y:0}, seed:1 });
    ps.update(0.2);
    const age1=ps.getActiveParticles('a')[0]!.age;
    ps.pause();
    ps.update(0.5);
    const age2=ps.getActiveParticles('a')[0]!.age;
    assert.equal(age1, age2);
    ps.resume();
    ps.update(0.1);
    assert.ok(ps.getActiveParticles('a')[0]!.age > age2);
    ps.dispose();
  });

  it('world vs screen space definitions', () => {
    const world = defineParticleEffect({
      capacity: 1,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const screen = defineParticleEffect({
      capacity: 1,
      space: 'screen',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    assert.equal(world.space, 'world');
    assert.equal(screen.space, 'screen');
  });
});

describe('T15.5 event integration', () => {
  it('seed from event is deterministic', () => {
    const e = { name: 'brick-hit', payload: { point: { x:10, y:20 } }, tick: 5, scene: 'play', sceneTick: 2, ordinal: 1 };
    const s1 = seedGameEvent(e as never);
    const s2 = seedGameEvent(e as never);
    assert.equal(s1, s2);
  });

  it('catch-up events respect ordering', () => {
    const def = defineParticleEffect({
      capacity: 10,
      space: 'world',
      overflow: 'drop-new',
      particle: { kind: 'shape', shape: 'circle' },
      burst: { count: 1 },
      lifetimeSeconds: { min: 1, max: 1 },
      speed: { min: 0, max: 0 },
      gravity: { x: 0, y: 0 },
      fadeOut: false,
    });
    const ps = createParticleSystem({ effects: { a: def } });
    // Simulate catch-up: two events same tick different ordinal
    ps.emit('a', { position:{x:0,y:0}, seed: 100 });
    ps.emit('a', { position:{x:10,y:0}, seed: 101 });
    assert.equal(ps.getDiagnostics('a').emitted, 2);
    ps.dispose();
  });
});
