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
  /** Number of completed simulation updates. */
  readonly tick: number;
  /** Deterministic elapsed simulation time in seconds. */
  readonly elapsedSeconds: number;
}

/** An idempotently removable render-frame subscription. */
export interface GameSubscription {
  /** Stop future notifications. Safe to call repeatedly. */
  remove(): void;
}

/** A closure-backed, headless running instance of one game definition. */
export interface GameSession<TActionName extends string, TSnapshot> {
  /** Current lifecycle status. */
  readonly status: GameSessionStatus;
  /** The initial scene name owned by this first runtime slice. */
  readonly scene: string;
  /** Semantic input controller constrained to declared action names. */
  readonly input: InputController<TActionName>;
  /** Start an idle session or resume a paused session. */
  start(): void;
  /** Pause simulation and discard suspended wall time. */
  pause(): void;
  /** Permanently stop the session and release scene resources. */
  dispose(): void;
  /** Read the latest immutable presentation envelope. */
  getRenderFrame(): RenderFrame<TSnapshot>;
  /** Observe presentation frames without involving React state. */
  addRenderFrameListener(
    listener: (frame: RenderFrame<TSnapshot>) => void,
  ): GameSubscription;
}

/** Error thrown when live work is requested from a disposed session. */
export class GameSessionDisposedError extends Error {
  override readonly name = 'GameSessionDisposedError';

  constructor() {
    super('This GameSession has been disposed');
  }
}
