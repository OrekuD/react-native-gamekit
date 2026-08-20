import type { InputFrame } from '../core/input/types';
import type {
  GameEventDescriptor,
  GameEventEmitter,
  InferGameEventMap,
} from '../events/types';

/**
 * Update-scoped scene transition controls.
 *
 * The controller is valid only for the duration of the `update` call that
 * received it. Retaining it and calling either method afterwards throws a
 * lifecycle error. Conflicting requests within one update fail clearly.
 */
export interface SceneTransitionController<TTransitionName extends string> {
  /**
   * Request a transition to a declared target scene.
   *
   * Requests to the current scene are idempotent no-ops. The transition
   * commits after the current update completes successfully.
   */
  setScene(name: TTransitionName): void;
  /** Recreate the current scene with fresh state. */
  restartScene(): void;
}

/** Values supplied to a scene for one deterministic simulation tick. */
export interface SceneUpdate<
  TState,
  TActionName extends string,
  TTransitionName extends string,
  TEventDefs extends Record<string, GameEventDescriptor<unknown>> = Record<string, never>,
  TEmits extends keyof InferGameEventMap<TEventDefs> & string = keyof InferGameEventMap<TEventDefs> & string,
> {
  /** The authoritative state produced by the previous tick. */
  readonly state: Readonly<TState>;
  /** One immutable semantic input snapshot for this tick. */
  readonly input: InputFrame<TActionName>;
  /** Update-scoped transition controls restricted to declared targets. */
  readonly transition: SceneTransitionController<TTransitionName>;
  /** Update-scoped emitter for declared game events (T13). Invalid after the update returns or throws. */
  readonly events: GameEventEmitter<Pick<InferGameEventMap<TEventDefs>, TEmits>>;
  /** One-based global simulation tick number. */
  readonly tick: number;
  /** One-based tick number within the current scene instance. */
  readonly sceneTick: number;
  /** Constant fixed-step duration in seconds. */
  readonly deltaSeconds: number;
  /** Deterministic global simulation time after this tick. */
  readonly elapsedSeconds: number;
  /** Deterministic time within the current scene instance. */
  readonly sceneElapsedSeconds: number;
}

/** Values supplied when extracting a renderer-specific snapshot. */
export interface SceneSnapshotContext<TState> {
  /** Current authoritative scene state. */
  readonly state: Readonly<TState>;
}

/** A synchronous functional scene used by the runtime. */
export interface SceneDefinition<
  TState,
  TSnapshot,
  TActionName extends string = never,
  TTransitionName extends string = never,
  TEmits extends string = never,
  TEventDefs extends Record<string, GameEventDescriptor<unknown>> = Record<string, never>,
> {
  /** Internal scene-definition discriminator. */
  readonly kind: 'gamekit.scene';
  /** @internal Covariant type witness used to infer presentation snapshots. */
  readonly __snapshotType?: TSnapshot;
  /** @internal Type witness used to validate scene actions against the game. */
  readonly __actionType?: TActionName;
  /** @internal Type witness used to validate scene transition targets. */
  readonly __transitionType?: TTransitionName;
  /** @internal Type witness for emitted event names. */
  readonly __emitType?: TEmits;
  /** @internal Type witness for the game event map. */
  readonly __eventMapType?: InferGameEventMap<TEventDefs>;
  /** @internal Type witness for the branded event definitions identity. */
  readonly __eventDefsType?: TEventDefs;
  /** Semantic input actions this scene may read. */
  readonly actions: readonly TActionName[];
  /** Declared scene names this scene may transition to. */
  readonly transitions?: readonly TTransitionName[];
  /** Declared event names this scene may emit (subset of the game's event map). */
  readonly emits?: readonly TEmits[];
  /** The branded event definitions this scene is bound to (for standalone type safety). */
  readonly events?: TEventDefs;
  /** Create the scene's initial authoritative state. */
  readonly create: () => TState;
  /** Produce the next state for one fixed simulation tick. */
  readonly update: (
    frame: SceneUpdate<TState, TActionName, TTransitionName, TEventDefs, TEmits>,
  ) => TState;
  /** Extract a compact renderer-specific snapshot from current state. */
  readonly snapshot: (context: SceneSnapshotContext<TState>) => TSnapshot;
  /** Release scene-owned resources exactly once. */
  readonly dispose?: (state: Readonly<TState>) => void;
}

/** Infer the presentation snapshot produced by a scene definition. */
export type SceneSnapshot<TScene> =
  TScene extends { readonly __snapshotType?: infer TSnapshot } ? TSnapshot : never;
