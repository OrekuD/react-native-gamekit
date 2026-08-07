import type { InputFrame } from '../core/input/types';

/** Values supplied to a scene for one deterministic simulation tick. */
export interface SceneUpdate<TState, TActionName extends string> {
  /** The authoritative state produced by the previous tick. */
  readonly state: Readonly<TState>;
  /** One immutable semantic input snapshot for this tick. */
  readonly input: InputFrame<TActionName>;
  /** One-based simulation tick number. */
  readonly tick: number;
  /** Constant fixed-step duration in seconds. */
  readonly deltaSeconds: number;
  /** Deterministic simulation time after this tick. */
  readonly elapsedSeconds: number;
}

/** Values supplied when extracting a renderer-specific snapshot. */
export interface SceneSnapshotContext<TState> {
  /** Current authoritative scene state. */
  readonly state: Readonly<TState>;
}

/** A synchronous functional scene used by the first runtime slice. */
export interface SceneDefinition<
  TState,
  TSnapshot,
  TActionName extends string = never,
> {
  /** Internal scene-definition discriminator. */
  readonly kind: 'gamekit.scene';
  /** @internal Covariant type witness used to infer presentation snapshots. */
  readonly __snapshotType?: TSnapshot;
  /** @internal Type witness used to validate scene actions against the game. */
  readonly __actionType?: TActionName;
  /** Semantic input actions this scene may read. */
  readonly actions: readonly TActionName[];
  /** Create the scene's initial authoritative state. */
  readonly create: () => TState;
  /** Produce the next state for one fixed simulation tick. */
  readonly update: (frame: SceneUpdate<TState, TActionName>) => TState;
  /** Extract a compact renderer-specific snapshot from current state. */
  readonly snapshot: (context: SceneSnapshotContext<TState>) => TSnapshot;
  /** Release scene-owned resources exactly once. */
  readonly dispose?: (state: Readonly<TState>) => void;
}

/** Infer the presentation snapshot produced by a scene definition. */
export type SceneSnapshot<TScene> =
  TScene extends { readonly __snapshotType?: infer TSnapshot } ? TSnapshot : never;
