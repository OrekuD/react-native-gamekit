/**
 * Compile fixture: preferred imports from `rn-gamekit/events`.
 */
import {
  defineGameEvents,
  gameEvent,
  GameEventError,
  PAYLOAD_LIMITS,
  seedGameEvent,
  type AnyGameEventEnvelope,
  type GameEventDefinitions,
  type GameEventDescriptor,
  type GameEventEmitter,
  type GameEventEnvelope,
  type GameEventListener,
  type GameEventMap,
  type InferGameEventMap,
} from 'rn-gamekit/events';

const events = defineGameEvents({
  hit: gameEvent<{ x: number }>(),
  chat: gameEvent<string>(),
});

type Map = InferGameEventMap<typeof events>;
const _map: Map = { hit: { x: 1 }, chat: 'hi' };
void _map;

const desc: GameEventDescriptor<{ x: number }> = { __payload: undefined as unknown as { x: number } };
void desc;

type Defs = GameEventDefinitions<{ hit: { x: number } }>;
void null as unknown as Defs;

type _Map2 = GameEventMap;
void null as unknown as _Map2;

const envelope: GameEventEnvelope<'hit', { x: number }> = {
  name: 'hit',
  payload: { x: 1 },
  tick: 1,
  scene: 'play',
  sceneTick: 1,
  ordinal: 0,
};
const anyEnvelope: AnyGameEventEnvelope = envelope;
const seed: number = seedGameEvent(anyEnvelope);
void seed;

const emitter: GameEventEmitter<Map> = { emit: () => {} };
void emitter;

const listener: GameEventListener<{ x: number }> = () => {};
void listener;

const err = new GameEventError('bad');
void err;

const limits = PAYLOAD_LIMITS;
void limits.MAX_PAYLOAD_NODES;
void limits.MAX_PAYLOAD_DEPTH;

// Payload must be plain values — the type layer does not need to be tested here,
// but the import must resolve.

// Negative: internal helper must not leak
// @ts-expect-error — cloneAndValidatePayload is internal, not public
import { cloneAndValidatePayload } from 'rn-gamekit/events';
// @ts-expect-error — GameView not in events
import type { GameView } from 'rn-gamekit/events';
