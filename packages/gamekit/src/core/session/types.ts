import type { InputMap, SceneMap } from '../../definition/types';
import type { GameEventDescriptor, GameEventEnvelope, InferGameEventMap } from '../../events/types';
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

/** One renderer-neutral simulation commit produced by a game session. */
export interface CommitFrameBase<TSnapshot> {
  /** Snapshot immediately before the latest simulation update. */
  readonly previous: DeepReadonly<TSnapshot>;
  /** Snapshot produced by the latest simulation update. */
  readonly current: DeepReadonly<TSnapshot>;
  /** Number of completed global simulation updates. */
  readonly tick: number;
  /** Deterministic elapsed global simulation time in seconds. */
  readonly elapsedSeconds: number;
  /** Monotonic commit counter; increments on every simulation commit. */
  readonly revision: number;
  /** True when this commit is a transition hard cut (previous === current). */
  readonly hardCut: boolean;
  /** Fixed simulation step duration in milliseconds (UI alpha clock input). */
  readonly stepMs: number;
}

/**
 * A simulation commit discriminated by its scene name.
 *
 * Narrowing on `frame.scene` narrows both `previous` and `current` to the
 * snapshot type of that scene. A transition commits a hard cut where both
 * snapshots come from the new scene; frames never interpolate between two
 * scene types.
 */
export type CommitFrame<TScenes extends SceneMap> = {
  [TName in keyof TScenes]: CommitFrameBase<SceneSnapshot<TScenes[TName]>> & {
    readonly scene: TName;
  };
}[keyof TScenes];

/** A commit frame plus a presentation fraction computed on demand. */
export type GameRenderFrame<TScenes extends SceneMap> = CommitFrame<TScenes> & {
  /** Live fixed-step fraction at call time; renderers use the UI clock. */
  readonly alpha: number;
};

/** An idempotently removable render-frame subscription. */
export interface GameSubscription {
  /** Stop future notifications. Safe to call repeatedly. */
  remove(): void;
}

/** A closure-backed, headless running instance of one game definition. */
export interface GameSession<
  TScenes extends SceneMap = SceneMap,
  TInput extends InputMap = InputMap,
  TEventDefs extends Record<string, GameEventDescriptor<unknown>> = Record<string, never>,
> {
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
   * Observe lifecycle transitions at control frequency.
   *
   * The listener receives each actual status transition after it becomes
   * authoritative (`idle`, `running`, `paused`, `disposed`); idempotent
   * commands emit nothing, and no initial value is emitted on subscribe —
   * read `status` for the snapshot. `disposed` is delivered exactly once
   * before listeners are released. Listeners are called from a snapshot and
   * a listener that issues another lifecycle command observes complete
   * states; a throwing listener does not abort delivery, and the first
   * failure is rethrown from the command after the pass completes. Status
   * notifications are not render commits.
   */
  addStatusListener(listener: (status: GameSessionStatus) => void): GameSubscription;
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
  /**
   * Read the latest immutable simulation commit with a live presentation
   * fraction.
   *
   * Freshness contract: `alpha` is computed on demand from the session's
   * accumulated timing fraction at call time and is only meaningful for
   * headless inspection. Rendering uses the UI-owned alpha clock; the
   * envelope fields never change between commits.
   */
  getRenderFrame(): GameRenderFrame<TScenes>;
  /** Observe simulation commits at commit frequency (never per display frame). */
  addCommitListener(listener: (frame: CommitFrame<TScenes>) => void): GameSubscription;
  /**
   * Observe deterministic game events after they commit (T13).
   *
   * Each listener receives committed envelopes for the subscribed name in
   * deterministic `(tick, ordinal)` order. Delivery happens after the
   * source tick's authoritative state commits and never during the update
   * itself. Listeners are invoked from a per-event snapshot; a listener
   * added during delivery receives only later events. Removing a listener
   * is idempotent and prevents future deliveries. A throwing listener does
   * not suppress siblings or alter simulation; the error is reported via a
   * visible non-recursive sink (`console.error`). Simulation never awaits
   * an async effect started by a listener.
   */
  addGameEventListener<TName extends keyof InferGameEventMap<TEventDefs> & string>(
    name: TName,
    listener: (event: GameEventEnvelope<TName, InferGameEventMap<TEventDefs>[TName]>) => void,
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
