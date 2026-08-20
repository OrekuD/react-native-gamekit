import type { DeepReadonly } from '../core/session/types';

declare const EventDefsBrand: unique symbol;

/** A type-witness descriptor for one game event's payload. */
export interface GameEventDescriptor<TPayload> {
  /** @internal Payload witness — no runtime value. */
  readonly __payload?: TPayload;
}

/** A map from event name to its payload type. */
export type GameEventMap = Record<string, unknown>;

/** A map from event name to its descriptor (the authored declaration). */
export type GameEventDefinitions<TMap extends GameEventMap> = {
  readonly [K in keyof TMap]: GameEventDescriptor<TMap[K]>;
};

/** Branded event definitions — nominal identity for scene/game binding. */
export type BrandedGameEventDefs<T extends Record<string, GameEventDescriptor<unknown>>> = T & {
  readonly [EventDefsBrand]?: T;
};

/** Infer the payload map from a descriptor map. */
export type InferGameEventMap<TDefs extends Record<string, GameEventDescriptor<unknown>>> = {
  [K in keyof TDefs as K extends string ? K : never]: TDefs[K] extends GameEventDescriptor<infer P> ? P : never;
};

/** One committed event envelope. Identity is `(tick, ordinal)` within a session. */
export interface GameEventEnvelope<TName extends string, TPayload> {
  readonly name: TName;
  readonly payload: DeepReadonly<TPayload>;
  readonly tick: number;
  readonly scene: string;
  readonly sceneTick: number;
  readonly ordinal: number;
}

/** Type-erased envelope for storage and delivery. */
export type AnyGameEventEnvelope = GameEventEnvelope<string, unknown>;

/** An emitter scoped to one fixed tick and one scene. */
export interface GameEventEmitter<TMap extends GameEventMap> {
  emit<TName extends keyof TMap & string>(name: TName, payload: TMap[TName]): void;
}

/** Listener for one event name. May be sync or async; rejections are observed without awaiting. */
export type GameEventListener<TPayload> = (
  event: GameEventEnvelope<string, TPayload>,
) => void | Promise<void>;

/** Infer the listener payload for a given game definition's event map. */
export type GameEventPayloadFor<TMap extends GameEventMap, TName extends keyof TMap & string> = TMap[TName];
