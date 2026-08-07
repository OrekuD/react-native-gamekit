import type { Point2D } from '../../geometry/types';

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

/**
 * The sampled state of a pointer action for one simulation tick.
 *
 * `pressed`, `released`, and `cancelled` are one-tick edges. `active`
 * persists while the owning pointer is down. `delta` accumulates movement
 * between ticks and resets after each sample.
 */
export interface PointerState {
  /** Whether the owning pointer is currently down. */
  readonly active: boolean;
  /** Whether a pointer began since the previous tick. */
  readonly pressed: boolean;
  /** Whether the owning pointer was released since the previous tick. */
  readonly released: boolean;
  /** Whether the owning pointer was cancelled since the previous tick. */
  readonly cancelled: boolean;
  /** Stable identifier of the pointer that owns the action. */
  readonly pointerId?: number;
  /** Current logical position of the owning pointer. */
  readonly position?: Point2D;
  /** Logical movement accumulated since the previous tick. */
  readonly delta: Point2D;
}

/** An immutable semantic input snapshot sampled once per simulation tick. */
export interface InputFrame<TActionName extends string> {
  /** Read a declared digital button action. */
  button(action: TActionName): ButtonState;
  /** Read a declared pointer action. */
  pointer(action: TActionName): PointerState;
}

/** Platform-facing controls for enqueueing semantic input changes. */
export interface InputController<TActionName extends string> {
  /** Enqueue a press for a declared button action. */
  press(action: TActionName): void;
  /** Enqueue a release for a declared button action. */
  release(action: TActionName): void;
  /** Begin a pointer for a declared pointer action. */
  begin(action: TActionName, pointerId: number, position: Point2D): void;
  /** Move the owning pointer of a declared pointer action. */
  move(action: TActionName, pointerId: number, position: Point2D): void;
  /** End the owning pointer of a declared pointer action. */
  end(action: TActionName, pointerId: number): void;
  /** Cancel the active button or owning pointer of a declared action. */
  cancel(action: TActionName): void;
}
