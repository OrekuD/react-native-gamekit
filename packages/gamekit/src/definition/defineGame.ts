import type { GameDefinition, InputMap, SceneMap } from './types';

type SceneActions<TScene> =
  TScene extends { readonly __actionType?: infer TAction } ? TAction : never;

type UndeclaredSceneActions<TScenes extends SceneMap, TInput extends InputMap> = Exclude<
  SceneActions<TScenes[keyof TScenes]>,
  Extract<keyof TInput, string>
>;

type ValidateSceneActions<TScenes extends SceneMap, TInput extends InputMap> =
  UndeclaredSceneActions<TScenes, TInput> extends never
    ? unknown
    : { readonly __undeclaredSceneActions: UndeclaredSceneActions<TScenes, TInput> };

/**
 * Declare a game.
 *
 * `defineGame` is the entry point of the provisional GameKit API. It
 * validates the definition at the type level — scene names are inferred so
 * `initialScene` must be one of the keys of `scenes` — and preserves and
 * returns the supplied definition.
 *
 * This function creates no runtime state: it does not start a scheduler,
 * allocate a session, load assets, or register input. Pass the definition to
 * `createGameSession` to create a live instance. The shape is provisional
 * until reference games validate it.
 *
 * @example
 * ```ts
 * const game = defineGame({
 *   viewport: {
 *     logicalSize: { width: 390, height: 844 },
 *     scale: 'fit',
 *     overflow: 'letterbox',
 *   },
 *   assets: [],
 *   input: { boost: { type: 'button' } },
 *   scenes: {
 *     play: defineScene({
 *       actions: [],
 *       create: () => ({ x: 0 }),
 *       update: ({ state }) => ({ x: state.x + 1 }),
 *       snapshot: ({ state }) => ({ x: state.x }),
 *     }),
 *   },
 *   initialScene: 'play',
 * });
 * ```
 */
export function defineGame<
  const TScenes extends SceneMap,
  const TInput extends InputMap = InputMap,
  const TInitialScene extends keyof TScenes = keyof TScenes,
>(
  definition: GameDefinition<TScenes, TInput, TInitialScene> &
    ValidateSceneActions<TScenes, TInput>,
): GameDefinition<TScenes, TInput, TInitialScene> {
  return definition;
}
