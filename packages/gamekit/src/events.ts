/**
 * Subpath entry for `rn-gamekit/events`.
 *
 * Typed event definitions, envelopes, payload limits, seeding, and errors.
 * Does not expose internal validation helpers or effect consumers.
 */
export { GameEventError } from './events/errors';
export { defineGameEvents, gameEvent } from './events/defineGameEvents';
export { seedGameEvent } from './events/seed';
export { PAYLOAD_LIMITS } from './events/payload';
export type {
  AnyGameEventEnvelope,
  GameEventDefinitions,
  GameEventDescriptor,
  GameEventEmitter,
  GameEventEnvelope,
  GameEventListener,
  GameEventMap,
  InferGameEventMap,
} from './events/types';
