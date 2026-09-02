/**
 * T20.0/T20.4 automated regression gate — Mossy Cavern 2 particle table.
 *
 * Source: mossy-cavern-2 MEMO 2026-08-27. The natural dust shrink envelope
 * `{ min: 1, max: 0.35 }` was rejected by `scaleOverLife` validation; the
 * game asked for explicit start/end authoring. The table must be importable
 * headlessly and construct the real system (module-load gate).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createParticleSystem } from 'rn-gamekit/particles';

import { mossyCavern2ParticleEffects } from './mossyCavern2Effects.ts';

test('mossy cavern 2 particle table imports headlessly and emits every effect (T20A-R5)', () => {
  const system = createParticleSystem({ effects: mossyCavern2ParticleEffects });
  try {
    for (const name of Object.keys(mossyCavern2ParticleEffects) as (keyof typeof mossyCavern2ParticleEffects)[]) {
      system.emit(name, { position: { x: 0, y: 0 }, seed: 1 });
      assert.equal(
        system.getDiagnostics(name).emitted,
        mossyCavern2ParticleEffects[name].burst.count,
        `${name} must report its authored burst count`,
      );
    }
  } finally {
    system.dispose();
  }
});

test('the documented dust shrink intent is explicit (T20.1)', () => {
  // MEMO 2026-08-27: the rejected natural envelope was `{ min: 1, max: 0.35 }`;
  // scalar endpoints normalize to frozen fixed ranges.
  assert.deepEqual(mossyCavern2ParticleEffects.dust.scale, {
    start: { min: 1, max: 1 },
    end: { min: 0.35, max: 0.35 },
  });
});

test('dust samples start above end deterministically', () => {
  const system = createParticleSystem({ effects: mossyCavern2ParticleEffects });
  try {
    system.emit('dust', { position: { x: 0, y: 0 }, seed: 4 });
    const emission = system.bindPresentation().emissions('dust')[0]!;
    assert.ok(emission.scaleStart > emission.scaleEnd, 'dust must shrink over life');
  } finally {
    system.dispose();
  }
});
