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
>(
  definition: Omit<
    SceneDefinition<TState, TSnapshot, TActions[number], TTransitions[number]>,
    'kind' | '__actionType' | '__transitionType' | '__snapshotType' | 'actions' | 'transitions'
  > & { readonly actions: TActions; readonly transitions?: TTransitions },
): SceneDefinition<TState, TSnapshot, TActions[number], TTransitions[number]> {
  return {
    kind: 'gamekit.scene',
    ...definition,
  };
}
