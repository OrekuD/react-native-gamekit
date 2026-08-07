/** The sampled state of a digital action for one simulation tick. */
export interface ButtonState {
  /** Whether the button is down at the tick boundary. */
  readonly held: boolean;
  /** Whether at least one press arrived since the previous tick. */
  readonly pressed: boolean;
  /** Whether at least one release arrived since the previous tick. */
  readonly released: boolean;
  /** Whether the platform cancelled ownership since the previous tick. */
  readonly cancelled: boolean;
}

/** An immutable semantic input snapshot sampled once per simulation tick. */
export interface InputFrame<TActionName extends string> {
  /** Read a declared digital action. */
  button(action: TActionName): ButtonState;
}

/** Platform-facing controls for enqueueing semantic button changes. */
export interface InputController<TActionName extends string> {
  /** Enqueue a press for a declared action. */
  press(action: TActionName): void;
  /** Enqueue a release for a declared action. */
  release(action: TActionName): void;
  /** Enqueue cancellation and neutralize a declared action. */
  cancel(action: TActionName): void;
}
