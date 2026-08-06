import type { GameDefinition, InputMap, SceneMap } from './types';

/**
 * Declare a game.
 *
 * `defineGame` is the entry point of the provisional GameKit API. It
 * validates the definition at the type level — scene names are inferred so
 * `initialScene` must be one of the keys of `scenes` — and preserves and
 * returns the supplied definition.
 *
 * The bootstrap implementation creates no runtime state: it does not start a
 * scheduler, allocate a session, load assets, or register input. The shape
 * is provisional until reference games validate it.
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
 *   input: {},
 *   scenes: {
 *     menu: {},
 *     level1: {},
 *   },
 *   initialScene: 'menu',
 * });
 * ```
 */
export function defineGame<
  const TScenes extends SceneMap,
  const TInput extends InputMap = InputMap,
>(definition: GameDefinition<TScenes, TInput>): GameDefinition<TScenes, TInput> {
  return definition;
}
