import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMossyCavern3ParticleSystem,
  MOSSY_CAVERN_3_PARTICLE_EFFECTS,
  selectMossyCavern3ParticleEmission,
  shouldEmitMossyCavern3Particle,
} from './mossyCavern3Particles.ts';

test('every authored particle effect satisfies the GameKit definition contract', () => {
  for (const [name, effect] of Object.entries(MOSSY_CAVERN_3_PARTICLE_EFFECTS)) {
    if (effect.scaleOverLife !== undefined) {
      assert.ok(
        effect.scaleOverLife.min <= effect.scaleOverLife.max,
        `${name} has an invalid scaleOverLife range`,
      );
    }
  }

  const system = createMossyCavern3ParticleSystem();
  assert.equal(system.status, 'running');
  system.dispose();
});

test('every authored effect emits its full burst headlessly (T20A-R5)', () => {
  const system = createMossyCavern3ParticleSystem();
  try {
    for (const [name, effect] of Object.entries(MOSSY_CAVERN_3_PARTICLE_EFFECTS)) {
      const key = name as keyof typeof MOSSY_CAVERN_3_PARTICLE_EFFECTS;
      system.emit(key, { position: { x: 0, y: 0 }, seed: 1 });
      assert.equal(
        system.getDiagnostics(key).emitted,
        effect.burst.count,
        `${name} must report its authored burst count`,
      );
    }
  } finally {
    system.dispose();
  }
});

test('dust expresses its intended shrink envelope explicitly (T20.1)', () => {
  // MEMO 2026-08-28: dust authored `{ min: 1, max: 0.2 }` crashed at module
  // load on device, so the envelope was removed instead of reversed. The
  // explicit start/end form restores the intent without the ambiguous range.
  assert.deepEqual(MOSSY_CAVERN_3_PARTICLE_EFFECTS.dust.scale, {
    start: { min: 1, max: 1 },
    end: { min: 0.2, max: 0.2 },
  });

  const system = createMossyCavern3ParticleSystem();
  try {
    system.emit('dust', { position: { x: 0, y: 0 }, seed: 6 });
    const emission = system.bindPresentation().emissions('dust')[0]!;
    assert.ok(emission.scaleStart > emission.scaleEnd, 'dust must shrink over life');
  } finally {
    system.dispose();
  }
});

test('particle presentation ignores idle and incomplete snapshots', () => {
  assert.equal(
    selectMossyCavern3ParticleEmission({
      effectKind: 'none',
      effectSequence: 0,
    }),
    undefined,
  );
  assert.equal(
    selectMossyCavern3ParticleEmission({
      effectKind: 'jump',
      effectSequence: 1,
    }),
    undefined,
  );
  assert.equal(
    selectMossyCavern3ParticleEmission({
      effectKind: 'jump',
      effectPosition: { x: Number.NaN, y: 240 },
      effectSequence: 2,
    }),
    undefined,
  );
  assert.equal(
    selectMossyCavern3ParticleEmission({
      effectKind: 'hurt',
      effectPosition: { x: 120, y: Number.POSITIVE_INFINITY },
      effectSequence: 3,
    }),
    undefined,
  );
  assert.equal(
    selectMossyCavern3ParticleEmission({
      effectKind: 'win',
      effectPosition: { x: 120, y: 240 },
      effectSequence: Number.NaN,
    }),
    undefined,
  );
  assert.deepEqual(
    selectMossyCavern3ParticleEmission({
      effectKind: 'jump',
      effectPosition: { x: 120, y: 240 },
      effectSequence: 2,
    }),
    { kind: 'jump', sequence: 2, x: 120, y: 240 },
  );
});

test('stale same-sequence suppression is a pure scheduling predicate (T20.4)', () => {
  const current = { kind: 'jump', sequence: 5, x: 10, y: 20 } as const;
  // No current emission: never schedule.
  assert.equal(shouldEmitMossyCavern3Particle(undefined, undefined), false);
  assert.equal(shouldEmitMossyCavern3Particle(undefined, current), false);
  // First emission (no previous): schedule exactly once.
  assert.equal(shouldEmitMossyCavern3Particle(current, undefined), true);
  // Same sequence re-delivered by a render that did not occur in time: skip.
  assert.equal(shouldEmitMossyCavern3Particle(current, { ...current }), false);
  // New committed sequence: schedule.
  assert.equal(shouldEmitMossyCavern3Particle(current, { ...current, sequence: 4 }), true);
});
