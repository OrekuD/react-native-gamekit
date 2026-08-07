import type { InputController } from '../core/input/types';
import type { Point2D } from '../geometry/types';
import { containsSurfacePoint, surfaceToWorld, type ResolvedViewport2D } from '../viewport2d';

/** The identity a pointer binding is scoped to. */
export interface PointerBindingIdentity<TName extends string> {
  /** The session input controller (identity changes when the session changes). */
  readonly input: InputController<TName>;
  /** The declared pointer action name. */
  readonly action: TName;
  /** Identity token for the viewport provider (changes on layout owner swaps). */
  readonly viewport: unknown;
}

/** A binding plus the identity it was created for. */
export interface PointerBindingEntry<TName extends string> {
  readonly binding: PointerBinding<TName>;
  readonly identity: PointerBindingIdentity<TName>;
}

/**
 * Reuse the previous binding when the identity is unchanged, otherwise dispose
 * it and create a fresh binding. Returns whether a new binding was created.
 */
export function createPointerBinding<TName extends string>(
  identity: PointerBindingIdentity<TName>,
  getViewport: () => ResolvedViewport2D | undefined,
  previous: PointerBindingEntry<TName> | undefined,
): { readonly entry: PointerBindingEntry<TName>; readonly created: boolean } {
  if (
    previous !== undefined &&
    previous.identity.input === identity.input &&
    previous.identity.action === identity.action &&
    previous.identity.viewport === identity.viewport
  ) {
    return { entry: previous, created: false };
  }
  if (previous !== undefined) {
    previous.binding.dispose();
  }
  return {
    entry: {
      binding: new PointerBinding(identity.action, identity.input, getViewport),
      identity,
    },
    created: true,
  };
}

/**
 * Platform-neutral pointer binding seam.
 *
 * It converts gesture positions from surface coordinates into logical world
 * coordinates through the current resolved viewport, rejects begins that
 * start in `fit` letterbox space, and forwards semantic events into the
 * session input buffer. The high-level `handleTouches*` methods mirror the
 * adapter's touch dispatch (including forwarding the final up position) so
 * the full adapter behavior is testable without mounting native gesture
 * views. Ownership and neutralization live in the input buffer.
 */
export class PointerBinding<TActionName extends string> {  readonly #action: TActionName;
  readonly #input: InputController<TActionName>;
  readonly #getViewport: () => ResolvedViewport2D | undefined;
  #disposed = false;

  constructor(
    action: TActionName,
    input: InputController<TActionName>,
    getViewport: () => ResolvedViewport2D | undefined,
  ) {
    this.#action = action;
    this.#input = input;
    this.#getViewport = getViewport;
  }

  /**
   * Begin a pointer at a surface point.
   *
   * Returns `false` when the layout is invalid or the point starts in
   * letterbox space; the gesture must be rejected and never becomes the owner.
   */
  begin(pointerId: number, surfacePoint: Point2D): boolean {
    if (this.#disposed) {
      return false;
    }
    const viewport = this.#getViewport();
    if (viewport === undefined) {
      return false;
    }
    if (!containsSurfacePoint(viewport, surfacePoint)) {
      return false;
    }
    this.#input.begin(this.#action, pointerId, surfaceToWorld(viewport, surfacePoint));
    return true;
  }

  /** Move a pointer. Conversion remains unbounded outside content bounds. */
  move(pointerId: number, surfacePoint: Point2D): void {
    if (this.#disposed) {
      return;
    }
    const viewport = this.#getViewport();
    if (viewport === undefined) {
      return;
    }
    this.#input.move(this.#action, pointerId, surfaceToWorld(viewport, surfacePoint));
  }

  /** End a pointer. The owning pointer is released by the input buffer. */
  end(pointerId: number): void {
    if (this.#disposed) {
      return;
    }
    this.#input.end(this.#action, pointerId);
  }

  /** Cancel the active pointer (gesture cancellation, layout change, unmount). */
  cancel(): void {
    if (this.#disposed) {
      return;
    }
    this.#input.cancel(this.#action);
  }

  /** Handle a touch-down gesture event with a surface position. */
  handleTouchesDown(pointerId: number, x: number, y: number): boolean {
    return this.begin(pointerId, { x, y });
  }

  /** Handle a touch-move gesture event with a surface position. */
  handleTouchesMove(pointerId: number, x: number, y: number): void {
    this.move(pointerId, { x, y });
  }

  /**
   * Handle a touch-up gesture event with its final surface position.
   *
   * The final position is forwarded before ownership ends so the documented
   * release frame contains the actual point where the pointer lifted.
   */
  handleTouchesUp(pointerId: number, x: number, y: number): void {
    this.move(pointerId, { x, y });
    this.end(pointerId);
  }

  /** Handle a platform touch cancellation. */
  handleTouchesCancelled(): void {
    this.cancel();
  }

  /** Stop forwarding events. Safe to call repeatedly. */
  dispose(): void {
    this.#disposed = true;
  }
}
