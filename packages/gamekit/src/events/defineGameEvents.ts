import type { BrandedGameEventDefs, GameEventDescriptor } from './types';

/**
 * Create a type witness for one event payload.
 *
 * `gameEvent` owns no runtime resource — it returns a frozen empty
 * descriptor whose generic preserves the payload type. Payload shapes are
 * validated when events are staged, not when they are declared.
 *
 * @example
 * ```ts
 * const events = defineGameEvents({
 *   'brick-hit': gameEvent<{ brickId: string; point: Point2D }>(),
 * });
 * ```
 */
export function gameEvent<TPayload>(): GameEventDescriptor<TPayload> {
  return Object.freeze({}) as GameEventDescriptor<TPayload>;
}

function isValidEventName(name: string): boolean {
  return name.length > 0 && name.length <= 128 && !name.includes('\0');
}

/**
 * Define and freeze a game event map.
 *
 * Validates every name, freezes the declaration map and its entries,
 * and preserves literal inference so `keyof typeof events` and the
 * payload types flow through `defineGame`, scenes, and subscriptions
 * without duplicate author-written unions.
 */
export function defineGameEvents<const T extends Record<string, GameEventDescriptor<unknown>>>(
  definitions: T,
): BrandedGameEventDefs<T> {
  for (const [name, descriptor] of Object.entries(definitions)) {
    if (!isValidEventName(name)) {
      throw new Error(`Invalid game event name: "${name}"`);
    }
    if (descriptor === null || typeof descriptor !== 'object') {
      throw new Error(`Game event "${name}" descriptor must be an object`);
    }
    Object.freeze(descriptor);
  }
  return Object.freeze({ ...definitions }) as BrandedGameEventDefs<T>;
}
