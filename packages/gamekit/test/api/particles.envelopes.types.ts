/**
 * Compile fixture: T20.1 explicit particle scale envelopes freeze the exact
 * authoring names — `scale.start` / `scale.end`, each a scalar or a
 * `{ min, max }` range — alongside the legacy `scaleOverLife` range.
 *
 * T20A-R3: the author-input type accepts scalar-or-range endpoints, while
 * `defineParticleEffect` exposes the normalized definition whose envelope
 * endpoints are Range-only. Authoring both scale forms is a compile-time
 * contract violation (the runtime also rejects it for unsafe inputs).
 */
import { defineParticleEffect } from 'rn-gamekit/particles';
import type { ParticleScaleEnvelope, Range } from 'rn-gamekit/particles';

const base = {
  capacity: 8,
  space: 'world',
  overflow: 'drop-new',
  particle: { kind: 'shape', shape: 'circle', radius: 2 },
  burst: { count: 1 },
  lifetimeSeconds: { min: 1, max: 1 },
  speed: { min: 0, max: 0 },
  gravity: { x: 0, y: 0 },
  fadeOut: true,
} as const;

// Scalar convenience endpoints normalize to fixed ranges.
const scalar = defineParticleEffect({ ...base, scale: { start: 1, end: 0.2 } });
// Ranged endpoints provide deterministic per-particle variation.
const ranged = defineParticleEffect({
  ...base,
  scale: { start: { min: 0.9, max: 1.1 }, end: { min: 0.15, max: 0.3 } },
});
// Endpoints may be mixed scalar/ranged independently.
const mixed = defineParticleEffect({ ...base, scale: { start: { min: 0.8, max: 1.2 }, end: 0.1 } });
// Legacy ascending range remains accepted during the migration period.
const legacy = defineParticleEffect({ ...base, scaleOverLife: { min: 0.2, max: 1 } });

// T20A-R3: normalized output endpoints are Range-only. Assigning a sampled
// endpoint to `Range` compiles only because scalar endpoints were normalized
// away — an author-input `number | Range` endpoint would fail this line.
const startCheck: Range = ranged.scale?.start ?? { min: 0, max: 0 };
const endCheck: Range = scalar.scale?.end ?? { min: 0, max: 0 };
const envelopeCheck: ParticleScaleEnvelope | undefined = mixed.scale;
void startCheck;
void endCheck;
void envelopeCheck;
void legacy.scaleOverLife;

// T20A-R3: authoring both scale forms is rejected by the type layer.
// @ts-expect-error scaleOverLife and scale are mutually exclusive
defineParticleEffect({
  ...base,
  scaleOverLife: { min: 0.2, max: 1 },
  scale: { start: 1, end: 0.2 },
});
