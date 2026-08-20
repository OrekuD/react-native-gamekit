import type { SceneDefinition } from './types';

/**
 * Define a synchronous functional scene while inferring its state, snapshot,
 * action, and transition types.
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
  const TEmits extends readonly string[] = [],
  TEventMap extends Record<string, unknown> = Record<string, never>,
>(
  definition: Omit<
    SceneDefinition<
      TState,
      TSnapshot,
      TActions[number],
      TTransitions[number],
      TEmits[number],
      TEventMap
    >,
    'kind' | '__actionType' | '__transitionType' | '__snapshotType' | '__emitType' | '__eventMapType' | 'actions' | 'transitions' | 'emits'
  > & { readonly actions: TActions; readonly transitions?: TTransitions; readonly emits?: TEmits },
): SceneDefinition<TState, TSnapshot, TActions[number], TTransitions[number], TEmits[number], TEventMap> {
  return {
    kind: 'gamekit.scene',
    ...definition,
  };
}
