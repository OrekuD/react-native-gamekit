import type { GameEventDescriptor, InferGameEventMap } from '../events/types';
import type { SceneDefinition } from './types';

/**
 * Define a synchronous functional scene while inferring its state, snapshot,
 * action, and transition types.
 *
 * To get typed event emission in a standalone scene, pass the same
 * `events` object that will be passed to `defineGame({ events })`:
 *
 * ```ts
 * const events = defineGameEvents({ 'brick-hit': gameEvent<{ id: string }>() });
 * const play = defineScene({
 *   actions: ['primary'],
 *   emits: ['brick-hit'],
 *   events,
 *   update: ({ events }) => {
 *     events.emit('brick-hit', { id: '1' }); // typed, wrong payload fails
 *   },
 *   // ...
 * });
 * const game = defineGame({ events, scenes: { play }, initialScene: 'play' });
 * ```
 *
 * @example
 * ```ts
 * const ready = defineScene({
 *   actions: ['primary'],
 *   transitions: ['play'],
 *   create: () => ({ ready: true }),
 *   update: ({ state, input, transition }) => {
 *     if (input.pointer('primary').pressed) {
 *       transition.setScene('play');
 *     }
 *     return state;
 *   },
 *   snapshot: ({ state }) => state,
 * });
 * ```
 */
export function defineScene<
  const TActions extends readonly string[],
  TState,
  TSnapshot,
  const TTransitions extends readonly string[] = [],
  const TEmits extends readonly (keyof InferGameEventMap<TEventDefs> & string)[] = [],
  const TEventDefs extends Record<string, GameEventDescriptor<unknown>> = Record<string, never>,
>(
  definition: Omit<
    SceneDefinition<
      TState,
      TSnapshot,
      TActions[number],
      TTransitions[number],
      TEmits[number],
      TEventDefs
    >,
    | 'kind'
    | '__actionType'
    | '__transitionType'
    | '__snapshotType'
    | '__emitType'
    | '__eventMapType'
    | '__eventDefsType'
    | 'actions'
    | 'transitions'
    | 'emits'
    | 'events'
  > & {
    readonly actions: TActions;
    readonly transitions?: TTransitions;
    readonly emits?: TEmits;
    readonly events?: TEventDefs;
  },
): SceneDefinition<TState, TSnapshot, TActions[number], TTransitions[number], TEmits[number], TEventDefs> {
  return {
    kind: 'gamekit.scene',
    ...definition,
  } as SceneDefinition<TState, TSnapshot, TActions[number], TTransitions[number], TEmits[number], TEventDefs>;
}
