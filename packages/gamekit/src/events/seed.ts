import type { AnyGameEventEnvelope } from './types';

/**
 * Derive a deterministic seed from a committed event envelope.
 *
 * The seed is stable within a session and across replays because it
 * depends only on the envelope's identity `(tick, ordinal)` and name,
 * never on wall time, React renders, or display frames.
 *
 * `seedGameEvent` is suitable for seeding seeded visual effects,
 * particles, or audio variations that must replay identically.
 */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seedGameEvent(event: AnyGameEventEnvelope): number {
  const nameHash = hashString(event.name);
  // Deterministic mixing of tick, ordinal, and name hash — the documented
  // stable identity (tick, ordinal, name). sceneTick is intentionally
  // excluded; it is presentation-local and would make the seed disagree
  // with its contract.
  let seed = 17;
  seed = Math.imul(seed, 31) + event.tick;
  seed = Math.imul(seed, 31) + event.ordinal;
  seed = Math.imul(seed, 31) + nameHash;
  return seed >>> 0;
}
