/**
 * T20.0/T20.4 automated regression gate — Mossy Cavern particle table.
 *
 * Source: mossy-cavern MEMO 2026-08-27. The descending-scale constraint hit
 * the dash trail first and then the crystal, hit, and finish bursts. The
 * module import below IS the module-load gate: an invalid authoring table
 * fails here in Node before Metro/device startup (the failure mode Mossy
 * Cavern 3 hit on its first device launch).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createParticleSystem } from 'rn-gamekit/particles';

import { mossyCavernParticleEffects } from './mossyCavernEffects.ts';

/** T20.1 contract: scalar endpoints normalize to frozen fixed ranges. */
function expectEnvelope(
  effect: { readonly scale?: unknown },
  start: number,
  end: number,
): void {
  assert.deepEqual(effect.scale, {
    start: { min: start, max: start },
    end: { min: end, max: end },
  });
}

test('mossy cavern particle table imports headlessly and emits every effect (T20A-R5)', () => {
  const system = createParticleSystem({ effects: mossyCavernParticleEffects });
  try {
    for (const name of Object.keys(mossyCavernParticleEffects) as (keyof typeof mossyCavernParticleEffects)[]) {
      system.emit(name, { position: { x: 0, y: 0 }, seed: 1 });
      assert.equal(
        system.getDiagnostics(name).emitted,
        mossyCavernParticleEffects[name].burst.count,
        `${name} must report its authored burst count`,
      );
    }
  } finally {
    system.dispose();
  }
});

test('descending-intent effects use explicit shrink envelopes (T20.1)', () => {
  // MEMO 2026-08-27: intended dash trail was `{ min: 0.9, max: 0.35 }` and the
  // crystal/hit/finish bursts shipped ascending fallbacks for the same reason.
  expectEnvelope(mossyCavernParticleEffects.dashTrail, 0.9, 0.35);
  expectEnvelope(mossyCavernParticleEffects.crystalBurst, 0.7, 0.15);
  expectEnvelope(mossyCavernParticleEffects.hitBurst, 1, 0.25);
  expectEnvelope(mossyCavernParticleEffects.finishBurst, 0.6, 0.1);
});

test('shrink envelopes sample start above end deterministically', () => {
  const system = createParticleSystem({ effects: mossyCavernParticleEffects });
  try {
    const shrinkEffects = ['dashTrail', 'crystalBurst', 'hitBurst', 'finishBurst'] as const;
    for (const name of shrinkEffects) {
      system.emit(name, { position: { x: 0, y: 0 }, seed: 4 });
      const emission = system.bindPresentation().emissions(name)[0]!;
      assert.ok(emission.scaleStart > emission.scaleEnd, `${name} must shrink over life`);
    }
  } finally {
    system.dispose();
  }
});
