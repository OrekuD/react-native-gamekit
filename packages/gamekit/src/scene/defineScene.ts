import type { SceneDefinition } from './types';

/**
 * Define a synchronous functional scene while inferring its state and
 * renderer-specific snapshot types.
 */
export function defineScene<
  const TActions extends readonly string[],
  TState,
  TSnapshot,
>(
  definition: Omit<
    SceneDefinition<TState, TSnapshot, TActions[number]>,
    'kind' | '__actionType' | '__snapshotType' | 'actions'
  > & { readonly actions: TActions },
): SceneDefinition<TState, TSnapshot, TActions[number]> {
  return {
    kind: 'gamekit.scene',
    ...definition,
  };
}
