/* eslint-disable @typescript-eslint/no-unused-vars */
import type { AssetGroupMap } from '../assets/types';
import type { GameEventDescriptor } from '../events/types';
import type { GameDefinition, InputMap, SceneDefinitionMarker, SceneMap } from './types';

type SceneActions<TScene> = TScene extends { readonly __actionType?: infer TAction }
  ? Exclude<TAction, undefined>
  : never;

type SceneTransitions<TScene> = TScene extends { readonly __transitionType?: infer TTransition }
  ? Exclude<TTransition, undefined>
  : never;

type UndeclaredSceneActions<TScenes extends SceneMap, TInput extends InputMap> = Exclude<
  SceneActions<TScenes[keyof TScenes]>,
  Extract<keyof TInput, string>
>;

type UndeclaredSceneTransitions<TScenes extends SceneMap> = Exclude<
  SceneTransitions<TScenes[keyof TScenes]>,
  keyof TScenes
>;

type ValidateSceneActions<TScenes extends SceneMap, TInput extends InputMap> =
  UndeclaredSceneActions<TScenes, TInput> extends never
    ? unknown
    : { readonly __undeclaredSceneActions: UndeclaredSceneActions<TScenes, TInput> };

type ValidateSceneTransitions<TScenes extends SceneMap> =
  UndeclaredSceneTransitions<TScenes> extends never
    ? unknown
    : { readonly __undeclaredSceneTransitions: UndeclaredSceneTransitions<TScenes> };

type SceneEmits<TScene> = TScene extends { readonly __emitType?: infer TEmits }
  ? Exclude<TEmits, undefined>
  : never;

type UndeclaredSceneEmits<
  TScenes extends SceneMap,
  TEventDefs extends Record<string, GameEventDescriptor<unknown>>,
> = TEventDefs extends Record<string, never>
  ? SceneEmits<TScenes[keyof TScenes]>
  : Exclude<SceneEmits<TScenes[keyof TScenes]>, keyof TEventDefs & string>;

type ValidateSceneEmits<
  TScenes extends SceneMap,
  TEventDefs extends Record<string, GameEventDescriptor<unknown>>,
> = UndeclaredSceneEmits<TScenes, TEventDefs> extends never
  ? unknown
  : { readonly __undeclaredSceneEmits: UndeclaredSceneEmits<TScenes, TEventDefs> };

type ValidateEventsWhenScenesEmit<
  TScenes extends SceneMap,
  TEventDefs extends Record<string, GameEventDescriptor<unknown>>,
> = SceneEmits<TScenes[keyof TScenes]> extends never
  ? unknown
  : TEventDefs extends Record<string, never>
    ? { readonly __eventsRequired: 'scenes declare emits but game has no events map' }
    : unknown;

type SceneEventDefs<TScene> = TScene extends { readonly __eventDefsType?: infer T }
  ? T
  : never;

// Runtime identity is checked via reference equality in the function body.
// Type-level check is intentionally permissive to avoid false positives for
// games without events and for separate test files that share the same
// events shape but not the same branded instance.
type ValidateSceneEventDefsIdentity<
  TScenes extends SceneMap,
  TEventDefs extends Record<string, GameEventDescriptor<unknown>>,
> = unknown;

/**
 * Declare a game.
 *
 * `defineGame` is the entry point of the provisional GameKit API. It
 * validates the definition at the type level — scene names are inferred so
 * `initialScene` must be one of the keys of `scenes`, every scene action must
 * exist in the game input map, and every declared transition target must be a
 * declared scene — and preserves and returns the supplied definition.
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
 *     mode: 'fit',
 *   },
 *   assets: [],
 *   input: { primary: { type: 'pointer' } },
 *   scenes: {
 *     ready: defineScene({
 *       actions: ['primary'],
 *       transitions: ['play'],
 *       create: () => ({ ready: true }),
 *       update: ({ state, input, transition }) => {
 *         if (input.pointer('primary').pressed) {
 *           transition.setScene('play');
 *         }
 *         return state;
 *       },
 *       snapshot: ({ state }) => state,
 *     }),
 *     play: defineScene({
 *       actions: [],
 *       create: () => ({ x: 0 }),
 *       update: ({ state }) => ({ x: state.x + 1 }),
 *       snapshot: ({ state }) => ({ x: state.x }),
 *     }),
 *   },
 *   initialScene: 'ready',
 * });
 * ```
 */
export function defineGame<
  const TScenes extends SceneMap,
  const TInput extends InputMap = InputMap,
  const TInitialScene extends keyof TScenes = keyof TScenes,
  const TAssets extends AssetGroupMap = AssetGroupMap,
  const TEventDefs extends Record<string, GameEventDescriptor<unknown>> = Record<string, never>,
>(
  definition: GameDefinition<TScenes, TInput, TInitialScene, TAssets, TEventDefs> &
    ValidateSceneActions<TScenes, TInput> &
    ValidateSceneTransitions<TScenes> &
    ValidateSceneEmits<TScenes, TEventDefs> &
    ValidateEventsWhenScenesEmit<TScenes, TEventDefs> &
    ValidateSceneEventDefsIdentity<TScenes, TEventDefs>,
): GameDefinition<TScenes, TInput, TInitialScene, TAssets, TEventDefs> {
  // The viewport config is part of the public session surface; freeze it so a
  // caller cannot mutate a live game's coordinate authority.
  Object.freeze(definition.viewport.logicalSize);
  Object.freeze(definition.viewport);
  if (definition.events !== undefined) {
    Object.freeze(definition.events);
    // Runtime identity check: every scene that declares `events` must reference
    // the same object as the game's `events`. This catches two different
    // `defineGameEvents` instances with compatible shapes that would otherwise
    // be structurally compatible at the type level.
    for (const [name, scene] of Object.entries(definition.scenes)) {
      const s = scene as unknown as { events?: unknown; emits?: readonly string[] };
      if (s.events !== undefined && s.events !== definition.events) {
        throw new Error(
          `Scene "${name}" is bound to a different events object than the game. Pass the same defineGameEvents() result to both defineScene({ events }) and defineGame({ events }).`,
        );
      }
      if (s.events === undefined && s.emits !== undefined && s.emits.length > 0) {
        throw new Error(
          `Scene "${name}" declares emits but is not bound to the game's events. Pass \`events\` to defineScene.`,
        );
      }
    }
  } else {
    for (const [name, scene] of Object.entries(definition.scenes)) {
      const s = scene as unknown as { events?: unknown; emits?: readonly string[] };
      if (s.events !== undefined) {
        throw new Error(`Scene "${name}" is bound to events but the game has no events map`);
      }
    }
  }
  return definition;
}
