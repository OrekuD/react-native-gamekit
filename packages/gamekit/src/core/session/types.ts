import type { InputMap, SceneMap } from '../../definition/types';
import type { SceneSnapshot } from '../../scene/types';
import type { Viewport } from '../../viewport2d/types';
import type { InputController } from '../input/types';

/** Recursively readonly view of renderer snapshot data. */
export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

/** Lifecycle states of a headless game session. */
export type GameSessionStatus = 'idle' | 'running' | 'paused' | 'disposed';

/** One renderer-neutral presentation produced by a game session. */
export interface RenderFrame<TSnapshot> {
  /** Snapshot immediately before the latest simulation update. */
  readonly previous: DeepReadonly<TSnapshot>;
  /** Snapshot produced by the latest simulation update. */
  readonly current: DeepReadonly<TSnapshot>;
  /** Remaining fixed-step fraction used for presentation interpolation. */
  readonly alpha: number;
  /** Number of completed global simulation updates. */
  readonly tick: number;
  /** Deterministic elapsed global simulation time in seconds. */
  readonly elapsedSeconds: number;
}

/**
 * A render frame discriminated by its scene name.
 *
 * Narrowing on `frame.scene` narrows both `previous` and `current` to the
 * snapshot type of that scene. A transition publishes a hard cut where both
 * snapshots come from the new scene; frames never interpolate between two
 * scene types.
 */
export type GameRenderFrame<TScenes extends SceneMap> = {
  [TName in keyof TScenes]: RenderFrame<SceneSnapshot<TScenes[TName]>> & {
    readonly scene: TName;
  };
}[keyof TScenes];

/** An idempotently removable render-frame subscription. */
export interface GameSubscription {
  /** Stop future notifications. Safe to call repeatedly. */
  remove(): void;
}

/** A closure-backed, headless running instance of one game definition. */
export interface GameSession<TScenes extends SceneMap = SceneMap, TInput extends InputMap = InputMap> {
  /** Current lifecycle status. */
  readonly status: GameSessionStatus;
  /** The active scene name, updated by transitions and restarts. */
  readonly scene: keyof TScenes;
  /** The authored viewport configuration of this game. */
  readonly viewport: Viewport;
  /** Semantic input controller constrained to declared action names. */
  readonly input: InputController<Extract<keyof TInput, string>>;
  /** Start an idle session or resume a paused session. */
  start(): void;
  /** Pause simulation and discard suspended wall time. */
  pause(): void;
  /**
   * Transition to a declared scene.
   *
   * While running, the transition commits at the next fixed-step boundary.
   * While idle or paused, it commits synchronously and publishes the new
   * frame. Setting the current scene is an idempotent no-op.
   */
  setScene(name: keyof TScenes): void;
  /** Recreate the active scene with fresh state. */
  restartScene(): void;
  /** Permanently stop the session and release the active scene. */
  dispose(): void;
  /** Read the latest immutable presentation envelope. */
  getRenderFrame(): GameRenderFrame<TScenes>;
  /** Observe presentation frames without involving React state. */
  addRenderFrameListener(
    listener: (frame: GameRenderFrame<TScenes>) => void,
  ): GameSubscription;
}

/** Error thrown when live work is requested from a disposed session. */
export class GameSessionDisposedError extends Error {
  override readonly name = 'GameSessionDisposedError';

  constructor() {
    super('This GameSession has been disposed');
  }
}

/**
 * Error thrown for lifecycle violations: conflicting transition requests,
 * transition controllers used outside their update, unknown runtime scene
 * names, and pending transition conflicts.
 */
export class GameSessionLifecycleError extends Error {
  override readonly name = 'GameSessionLifecycleError';

  constructor(message: string) {
    super(message);
  }
}
