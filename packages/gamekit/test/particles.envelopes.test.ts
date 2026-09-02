/**
 * T20.1 — Explicit particle scale envelopes (contract tests, written before
 * the implementation per the repo's test-first invariant).
 *
 * Source evidence (T20.0 matrix):
 * - Mossy Cavern 1 MEMO 2026-08-27: intended dash trail `{ min: 0.9, max: 0.35 }`
 *   was rejected; crystal, hit, and finish bursts shipped ascending fallbacks.
 * - Mossy Cavern 2 MEMO 2026-08-27: natural shrink `{ min: 1, max: 0.35 }`
 *   rejected; asked for explicit start/end authoring.
 * - Mossy Cavern 3 MEMO 2026-08-28: dust `{ min: 1, max: 0.2 }` crashed at
 *   module load on device; the envelope was removed instead of reversed.
 *
 * Frozen names: `scale.start` / `scale.end`, each endpoint a scalar or a
 * `{ min, max }` range. Legacy `scaleOverLife` keeps byte-for-byte sampling.
 *
 * Review follow-ups encoded here:
 * - T20A-R1: endpoints are non-negative; zero collapses to a point. Negative
 *   scale has no defined rendering semantics, so it is rejected.
 * - T20A-R2: optional scale fields validate by presence, so `null`, `false`,
 *   `0`, and arrays fail at the boundary instead of silently falling back.
 * - T20A-R4: a literal golden emission snapshot guards legacy compatibility
 *   independently of the current sampler helpers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineParticleEffect, createParticleSystem } from '../src/particles/index';
import { createRng, sampleRange, PARTICLE_TOLERANCE } from '../src/particles/sampling';
import type { ParticleEffectDefinitionInput } from '../src/particles/types';

function baseDef(overrides: Record<string, unknown> = {}): ParticleEffectDefinitionInput {
  return {
    capacity: 10,
    space: 'world',
    overflow: 'drop-new',
    particle: { kind: 'shape', shape: 'circle', radius: 4 },
    burst: { count: 1 },
    lifetimeSeconds: { min: 1, max: 1 },
    speed: { min: 10, max: 10 },
    direction: { min: 0, max: 0 },
    gravity: { x: 0, y: 0 },
    fadeOut: false,
    ...overrides,
  } as ParticleEffectDefinitionInput;
}

describe('T20.1 explicit scale envelopes', () => {
  it('accepts scalar { start, end } and normalizes to fixed ranges', () => {
    const def = defineParticleEffect(baseDef({ scale: { start: 1, end: 0.2 } }));
    assert.deepEqual(def.scale, { start: { min: 1, max: 1 }, end: { min: 0.2, max: 0.2 } });
  });

  it('accepts ranged endpoints and deep-freezes the envelope', () => {
    const def = defineParticleEffect(
      baseDef({ scale: { start: { min: 0.9, max: 1.1 }, end: { min: 0.15, max: 0.3 } } }),
    );
    assert.ok(def.scale);
    assert.equal(Object.isFrozen(def.scale), true);
    assert.equal(Object.isFrozen(def.scale.start), true);
    assert.equal(Object.isFrozen(def.scale.end), true);
  });

  it('accepts mixed scalar/ranged endpoints', () => {
    const def = defineParticleEffect(baseDef({ scale: { start: { min: 0.8, max: 1.2 }, end: 0.1 } }));
    assert.deepEqual(def.scale?.end, { min: 0.1, max: 0.1 });
    assert.deepEqual(def.scale?.start, { min: 0.8, max: 1.2 });
  });

  it('{ start: 1, end: 0.2 } shrinks at age zero, midpoint, and expiry', () => {
    const ps = createParticleSystem({
      effects: { a: defineParticleEffect(baseDef({ scale: { start: 1, end: 0.2 } })) },
    });
    try {
      ps.emit('a', { position: { x: 0, y: 0 }, seed: 11 });
      assert.equal(ps.getActiveParticles('a')[0]!.scale, 1);
      ps.update(0.5);
      assert.ok(Math.abs(ps.getActiveParticles('a')[0]!.scale - 0.6) <= PARTICLE_TOLERANCE);
      ps.update(0.4999);
      const nearExpiry = ps.getActiveParticles('a')[0]!;
      assert.ok(nearExpiry.active);
      assert.ok(Math.abs(nearExpiry.scale - 0.2) <= PARTICLE_TOLERANCE);
      ps.update(0.01);
      assert.equal(ps.getActiveParticles('a').length, 0);
      const emission = ps.bindPresentation().emissions('a').at(-1)!;
      assert.equal(emission.scaleStart, 1);
      assert.equal(emission.scaleEnd, 0.2);
    } finally {
      ps.dispose();
    }
  });

  it('ranged start/end sampling is deterministic for a fixed seed', () => {
    const def = defineParticleEffect(
      baseDef({ scale: { start: { min: 0.9, max: 1.1 }, end: { min: 0.15, max: 0.3 } } }),
    );
    const ps1 = createParticleSystem({ effects: { a: def } });
    const ps2 = createParticleSystem({ effects: { a: def } });
    try {
      ps1.emit('a', { position: { x: 0, y: 0 }, seed: 99 });
      ps2.emit('a', { position: { x: 0, y: 0 }, seed: 99 });
      const e1 = ps1.bindPresentation().emissions('a')[0]!;
      const e2 = ps2.bindPresentation().emissions('a')[0]!;
      assert.equal(e1.scaleStart, e2.scaleStart);
      assert.equal(e1.scaleEnd, e2.scaleEnd);
      assert.ok(e1.scaleStart >= 0.9 && e1.scaleStart <= 1.1);
      assert.ok(e1.scaleEnd >= 0.15 && e1.scaleEnd <= 0.3);
    } finally {
      ps1.dispose();
      ps2.dispose();
    }
  });

  it('draw order is documented: start sampled before end, after direction', () => {
    const def = defineParticleEffect(
      baseDef({
        lifetimeSeconds: { min: 1, max: 2 },
        speed: { min: 10, max: 20 },
        scale: { start: { min: 0.5, max: 1.5 }, end: { min: 2, max: 3 } },
      }),
    );
    const ps = createParticleSystem({ effects: { a: def } });
    try {
      ps.emit('a', { position: { x: 0, y: 0 }, seed: 5 });
      const emission = ps.bindPresentation().emissions('a')[0]!;
      const rng = createRng(5 >>> 0);
      const lifetime = sampleRange(rng, { min: 1, max: 2 });
      const speed = sampleRange(rng, { min: 10, max: 20 });
      const direction = sampleRange(rng, { min: 0, max: 0 });
      const scaleStart = sampleRange(rng, { min: 0.5, max: 1.5 });
      const scaleEnd = sampleRange(rng, { min: 2, max: 3 });
      assert.equal(emission.lifetime, lifetime);
      assert.equal(Math.hypot(emission.vx, emission.vy), speed);
      assert.equal(Math.atan2(emission.vy, emission.vx), direction);
      assert.equal(emission.scaleStart, scaleStart);
      assert.equal(emission.scaleEnd, scaleEnd);
    } finally {
      ps.dispose();
    }
  });

  it('invalid nested values fail at definition time', () => {
    assert.throws(() => defineParticleEffect(baseDef({ scale: { start: Number.NaN, end: 1 } })), /scale\.start/);
    assert.throws(
      () => defineParticleEffect(baseDef({ scale: { start: 1, end: Number.POSITIVE_INFINITY } })),
      /scale\.end/,
    );
    assert.throws(
      () => defineParticleEffect(baseDef({ scale: { start: { min: 1.1, max: 0.9 }, end: 0.2 } })),
      /scale\.start/,
    );
    assert.throws(
      () => defineParticleEffect(baseDef({ scale: { start: 1, end: { min: 0.3, max: 0.2 } } })),
      /scale\.end/,
    );
    assert.throws(
      () => defineParticleEffect(baseDef({ scale: { start: 'big' as never, end: 0.2 } })),
      /scale\.start/,
    );
  });

  it('rejects definitions that specify both legacy and envelope forms', () => {
    assert.throws(
      () =>
        defineParticleEffect(
          baseDef({ scaleOverLife: { min: 0.2, max: 1 }, scale: { start: 1, end: 0.2 } }),
        ),
      /scaleOverLife/,
    );
  });

  it('legacy scaleOverLife definitions retain byte-for-byte sampling', () => {
    const def = defineParticleEffect(baseDef({ scaleOverLife: { min: 0.5, max: 1.4 } }));
    const ps = createParticleSystem({ effects: { a: def } });
    try {
      ps.emit('a', { position: { x: 0, y: 0 }, seed: 7 });
      const emission = ps.bindPresentation().emissions('a')[0]!;
      const rng = createRng(7 >>> 0);
      const lifetime = sampleRange(rng, { min: 1, max: 1 });
      const speed = sampleRange(rng, { min: 10, max: 10 });
      const direction = sampleRange(rng, { min: 0, max: 0 });
      const expectedStart = sampleRange(rng, { min: 0.5, max: 1.4 });
      assert.equal(emission.lifetime, lifetime);
      assert.equal(Math.hypot(emission.vx, emission.vy), speed);
      assert.equal(Math.atan2(emission.vy, emission.vx), direction);
      assert.equal(emission.scaleStart, expectedStart);
      // Legacy semantics: end = max of the range, never sampled.
      assert.equal(emission.scaleEnd, 1.4);
      // Legacy definitions must not gain a synthesized envelope.
      assert.equal(def.scale, undefined);
    } finally {
      ps.dispose();
    }
  });

  it('golden: legacy scaleOverLife sampling is frozen at captured values (T20A-R4)', () => {
    // Literal values captured from the pre-envelope T15 sampler. The
    // definition exercises every historical draw in documented order
    // (lifetime, speed, direction, rotation, rotationSpeed, scale start) via
    // ranged fields. Do NOT regenerate these numbers from the current
    // implementation — a sampler or draw-order change must fail here first.
    const def = defineParticleEffect(
      baseDef({
        overflow: 'recycle-oldest',
        lifetimeSeconds: { min: 0.3, max: 0.9 },
        speed: { min: 20, max: 80 },
        direction: { min: Math.PI * 0.25, max: Math.PI * 1.5 },
        rotation: { min: -1, max: 1 },
        gravity: { x: 3, y: 7 },
        fadeOut: true,
        scaleOverLife: { min: 0.5, max: 1.4 },
      }),
    );
    const ps = createParticleSystem({ effects: { golden: def } });
    try {
      ps.emit('golden', { position: { x: 3, y: 4 }, seed: 424242 });
      const rec = ps.bindPresentation().emissions('golden')[0]!;
      // Exact object shape: the record carries exactly the documented fields.
      assert.deepEqual(Object.keys(rec).sort(), [
        'bornAt',
        'lifetime',
        'originX',
        'originY',
        'rotation',
        'rotationSpeed',
        'scaleEnd',
        'scaleStart',
        'spawnSequence',
        'vx',
        'vy',
      ]);
      // Discrete fields are exact.
      assert.equal(rec.bornAt, 0);
      assert.equal(rec.originX, 3);
      assert.equal(rec.originY, 4);
      assert.equal(rec.spawnSequence, 0);
      // T20A-RR2: floating-point fields stay literal but compare within the
      // documented tolerance — the final bits of Math.sin/cos results may
      // vary across runtimes while sampling order and behavior remain
      // compatible.
      assert.ok(Math.abs(rec.lifetime - 0.37722479961812494) <= PARTICLE_TOLERANCE);
      assert.ok(Math.abs(rec.vx - 2.17755046978546) <= PARTICLE_TOLERANCE);
      assert.ok(Math.abs(rec.vy - 34.10955831528815) <= PARTICLE_TOLERANCE);
      assert.ok(Math.abs(rec.rotation - 0.28760224301368) <= PARTICLE_TOLERANCE);
      assert.ok(Math.abs(rec.rotationSpeed - -0.6305815614759922) <= PARTICLE_TOLERANCE);
      assert.ok(Math.abs(rec.scaleStart - 1.043702931702137) <= PARTICLE_TOLERANCE);
      assert.ok(Math.abs(rec.scaleEnd - 1.4) <= PARTICLE_TOLERANCE);
      // Legacy definitions must not gain a synthesized envelope.
      assert.equal(def.scale, undefined);
      // The sampled transform interpolates start → max over life.
      ps.update(0.37722479961812494 / 2);
      const snap = ps.getActiveParticles('golden')[0]!;
      const expectedMid = 1.043702931702137 + (1.4 - 1.043702931702137) / 2;
      assert.ok(Math.abs(snap.scale - expectedMid) <= PARTICLE_TOLERANCE);
    } finally {
      ps.dispose();
    }
  });

  it('zero endpoints are supported and collapse to a point (T20A-R1)', () => {
    const def = defineParticleEffect(baseDef({ scale: { start: 0, end: 0 } }));
    assert.deepEqual(def.scale, { start: { min: 0, max: 0 }, end: { min: 0, max: 0 } });
    const ps = createParticleSystem({ effects: { a: def } });
    try {
      ps.emit('a', { position: { x: 0, y: 0 }, seed: 3 });
      assert.equal(ps.getActiveParticles('a')[0]!.scale, 0);
    } finally {
      ps.dispose();
    }
  });

  it('negative endpoints are rejected at definition time (T20A-R1)', () => {
    assert.throws(() => defineParticleEffect(baseDef({ scale: { start: -0.5, end: 1 } })), /scale\.start/);
    assert.throws(
      () => defineParticleEffect(baseDef({ scale: { start: 1, end: { min: -0.1, max: 0.2 } } })),
      /scale\.end/,
    );
    assert.throws(
      () => defineParticleEffect(baseDef({ scale: { start: { min: 0.1, max: -0.2 }, end: 1 } })),
      /scale\.start/,
    );
  });

  it('createParticleSystem revalidates raw definitions at its boundary', () => {
    assert.throws(
      () => createParticleSystem({ effects: { a: baseDef({ scale: { start: Number.NaN, end: 1 } }) } }),
      /scale\.start/,
    );
    assert.throws(
      () =>
        createParticleSystem({
          effects: {
            a: baseDef({ scaleOverLife: { min: 0.2, max: 1 }, scale: { start: 1, end: 0.2 } }),
          },
        }),
      /scaleOverLife/,
    );
  });
});

describe('T20A-R2 presence-based raw-boundary validation', () => {
  it('rejects null, false, 0, and array scale payloads at definition time', () => {
    assert.throws(() => defineParticleEffect(baseDef({ scale: null })), /scale must be an object/);
    assert.throws(() => defineParticleEffect(baseDef({ scale: false })), /scale must be an object/);
    assert.throws(() => defineParticleEffect(baseDef({ scale: 0 })), /scale must be an object/);
    assert.throws(() => defineParticleEffect(baseDef({ scale: [] })), /scale must be an object/);
  });

  it('rejects scale objects missing an endpoint', () => {
    assert.throws(
      () => defineParticleEffect(baseDef({ scale: { start: 1 } })),
      /scale must specify start and end/,
    );
    assert.throws(
      () => defineParticleEffect(baseDef({ scale: { end: 0.2 } })),
      /scale must specify start and end/,
    );
  });

  it('rejects null, false, 0, and array scaleOverLife payloads at definition time', () => {
    assert.throws(() => defineParticleEffect(baseDef({ scaleOverLife: null })), /scaleOverLife/);
    assert.throws(() => defineParticleEffect(baseDef({ scaleOverLife: false })), /scaleOverLife/);
    assert.throws(() => defineParticleEffect(baseDef({ scaleOverLife: 0 })), /scaleOverLife/);
    assert.throws(() => defineParticleEffect(baseDef({ scaleOverLife: [] })), /scaleOverLife/);
  });

  it('mutual exclusion triggers on presence even when values are malformed', () => {
    assert.throws(
      () => defineParticleEffect(baseDef({ scaleOverLife: null, scale: { start: 1, end: 0.2 } })),
      /mutually exclusive/,
    );
    assert.throws(
      () => defineParticleEffect(baseDef({ scaleOverLife: { min: 0.2, max: 1 }, scale: null })),
      /mutually exclusive/,
    );
  });

  it('createParticleSystem revalidates the same raw payloads at its boundary', () => {
    assert.throws(
      () => createParticleSystem({ effects: { a: baseDef({ scale: null }) } }),
      /scale must be an object/,
    );
    assert.throws(
      () => createParticleSystem({ effects: { a: baseDef({ scaleOverLife: false }) } }),
      /scaleOverLife/,
    );
    assert.throws(
      () =>
        createParticleSystem({
          effects: { a: baseDef({ scaleOverLife: null, scale: { start: 1, end: 0.2 } }) },
        }),
      /mutually exclusive/,
    );
    assert.throws(
      () => createParticleSystem({ effects: { a: baseDef({ scale: [] }) } }),
      /scale must be an object/,
    );
  });
});
