import type { AssetGroupMap, GameAssetManifest } from '../assets/types';
import type { GameEventDescriptor } from '../events/types';
import type { Viewport } from '../viewport2d/types';

/** The button action supported by the runtime. */
export interface ButtonInputAction {
  /** Discriminant for a digital button action. */
  readonly type: 'button';
  /** Optional human-readable description for diagnostics and tooling. */
  readonly description?: string;
}

/** A single primary pointer action driven by touch or a mouse pointer. */
export interface PointerInputAction {
  /** Discriminant for a pointer action. */
  readonly type: 'pointer';
  /** Optional human-readable description for diagnostics and tooling. */
  readonly description?: string;
}

/** A named semantic input action. */
export type InputAction = ButtonInputAction | PointerInputAction;

/** The collection of semantic input actions declared by a game. */
export type InputMap = Readonly<Record<string, InputAction>>;

/**
 * Structural marker shared by all definitions created with `defineScene`.
 *
 * It lets `defineGame` retain each scene's inferred state, snapshot, action,
 * and transition types without erasing them into a universal world or
 * renderer shape.
 */
export interface SceneDefinitionMarker {
  /** Internal scene-definition discriminator. */
  readonly kind: 'gamekit.scene';
  /** @internal Type witness for actions consumed by this scene. */
  readonly __actionType?: string;
  /** @internal Type witness for transition targets declared by this scene. */
  readonly __transitionType?: string;
  /** @internal Type witness for emitted event names. */
  readonly __emitType?: string;
  /** @internal Type witness for the game event map. */
  readonly __eventMapType?: Record<string, unknown>;
}

/** The collection of functional scenes declared by a game. */
export type SceneMap = Readonly<Record<string, SceneDefinitionMarker>>;

/**
 * A complete static game definition produced by `defineGame`.
 *
 * Creating a definition allocates no runtime state. Pass it to
 * `createGameSession` when a live headless session is required.
 */
export interface GameDefinition<
  TScenes extends SceneMap = SceneMap,
  TInput extends InputMap = InputMap,
  TInitialScene extends keyof TScenes = keyof TScenes,
  TAssets extends AssetGroupMap = AssetGroupMap,
  TEventDefs extends Record<string, GameEventDescriptor<unknown>> = Record<string, never>,
> {
  /** The viewport configuration of the game. */
  readonly viewport: Viewport;
  /** Typed asset manifest; optional for shape-only games. */
  readonly assets?: GameAssetManifest<TAssets>;
  /** Semantic input actions declared by the game. */
  readonly input: TInput;
  /** Functional scenes keyed by stable scene name. */
  readonly scenes: TScenes;
  /** The scene created first when a session starts. */
  readonly initialScene: TInitialScene;
  /** Typed game event declarations (T13). Absence keeps the no-event fast path. */
  readonly events?: TEventDefs;
}
