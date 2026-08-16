import type { CameraCut2D } from '../camera2d';
import { logicalToWorld2D } from '../camera2d';
import type { InputController } from '../core/input/types';
import type { Point2D } from '../geometry/types';
import { containsSurfacePoint, surfaceToWorld, type ResolvedViewport2D } from '../viewport2d';
import type { CoalescedPointerEvent } from './pointerCoalescer';

/**
 * A coalesced pointer event stamped with the binding epoch it was scheduled
 * under (F6). Packets scheduled before a layout revision or binding
 * replacement carry the old epoch and are rejected on the RN runtime, so a
 * stale begin cannot reacquire input with old coordinates and a stale
 * terminal edge cannot release a newer capture that reused the pointer id.
 *
 * T12-F4: the packet also carries the presented camera cut sampled AT
 * EVENT TIME on the UI runtime. JS inverts through that stamp — never a
 * later lazy read — so the world coordinate matches the camera under the
 * finger when the touch happened, even while the camera follows, zooms,
 * rotates, or shakes.
 */
export type PointerPacket = CoalescedPointerEvent & {
  /** Monotonic adapter-owned binding generation (F3 follow-up). */
  readonly generation: number;
  /** Adapter-owned layout epoch; bumped on layout revisions and unmount. */
  readonly layoutEpoch: number;
  /** Monotonic UI-runtime forward sequence (F1 latency causality). */
  readonly seq: number;
  /** UI-runtime timestamp of the forward (F1 latency causality). */
  readonly atMs: number;
  /** The presented camera cut at event time; absent for no-camera games. */
  readonly camera?: CameraCut2D | undefined;
};

/** Monotonic generation source for factory-created bindings (F3). */
let nextFactoryGeneration = 1;

/** The identity a pointer binding is scoped to. */
export interface PointerBindingIdentity<TName extends string> {
  /** The session input controller (identity changes when the session changes). */
  readonly input: InputController<TName>;
  /** The declared pointer action name. */
  readonly action: TName;
  /** Identity token for the viewport provider (changes on layout owner swaps). */
  readonly viewport: unknown;
  /**
   * Identity token for the presented camera provider (T12.4). Changes when
   * the camera surface is replaced, so a fresh binding generation stamps
   * packets under the new camera owner.
   */
  readonly camera: unknown;
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
    previous.identity.viewport === identity.viewport &&
    previous.identity.camera === identity.camera
  ) {
    return { entry: previous, created: false };
  }
  if (previous !== undefined) {
    previous.binding.dispose();
  }
  return {
    entry: {
      binding: new PointerBinding(
        identity.action,
        identity.input,
        getViewport,
        nextFactoryGeneration++,
      ),
      identity,
    },
    created: true,
  };
}

/**
 * Platform-neutral pointer binding seam.
 *
 * It converts gesture positions from surface coordinates into logical world
 * coordinates through the current resolved viewport (T12.4: and through the
 * currently presented camera when the game has one), rejects begins that
 * start in `fit` letterbox space, and forwards semantic events into the
 * session input buffer. Containment always happens BEFORE camera inversion:
 * letterbox space is rejected regardless of the camera. The high-level `handleTouches*` methods mirror the
 * adapter's touch dispatch (including forwarding the final up position) so
 * the full adapter behavior is testable without mounting native gesture
 * views. Ownership and neutralization live in the input buffer.
 */
export class PointerBinding<TActionName extends string> {
  readonly #action: TActionName;
  readonly #input: InputController<TActionName>;
  readonly #getViewport: () => ResolvedViewport2D | undefined;
  readonly #generation: number;
  #disposed = false;

  constructor(
    action: TActionName,
    input: InputController<TActionName>,
    getViewport: () => ResolvedViewport2D | undefined,
    generation: number,
  ) {
    this.#action = action;
    this.#input = input;
    this.#getViewport = getViewport;
    this.#generation = generation;
  }

  /**
   * Surface -> world through the viewport and the EVENT-TIME camera cut
   * (T12.4, T12-F4).
   *
   * The frozen order: inverse viewport first, then inverse camera, using
   * the camera stamp sampled by the UI worklet when the touch happened —
   * the same camera the renderer drew at that moment. Without a camera
   * stamp this is exactly `surfaceToWorld`.
   */
  #toWorld(viewport: ResolvedViewport2D, point: Point2D, camera: CameraCut2D | undefined): Point2D {
    const logical = surfaceToWorld(viewport, point);
    if (camera === undefined) {
      return logical;
    }
    return logicalToWorld2D(logical, camera.camera, viewport.visibleLogicalBounds);
  }

  /**
   * The monotonic adapter-owned generation this binding belongs to (F3).
   * Generations never reset to zero, so a replacement binding and the
   * worklet closures that stamp its packets agree by construction — no
   * post-commit synchronization is needed.
   */
  get generation(): number {
    return this.#generation;
  }

  /**
   * Dispatch a coalesced packet stamped with its scheduling generation.
   *
   * Returns `false` (and forwards nothing) when the binding is disposed or
   * the packet belongs to a different generation; the active gesture's
   * packets keep flowing under the current generation with the latest
   * viewport. Layout-epoch rejection happens on the adapter side (the epoch
   * is adapter-owned and never resets, so it cannot desynchronize).
   */
  dispatch(packet: PointerPacket): boolean {
    if (this.#disposed || packet.generation !== this.#generation) {
      return false;
    }
    switch (packet.kind) {
      case 'begin':
        this.handleTouchesDown(packet.pointerId, packet.x, packet.y, packet.camera);
        break;
      case 'move':
        this.handleTouchesMove(packet.pointerId, packet.x, packet.y, packet.camera);
        break;
      case 'end':
        this.handleTouchesUp(packet.pointerId, packet.x, packet.y, packet.camera);
        break;
      case 'cancel':
        this.handleTouchesCancelled();
        break;
    }
    return true;
  }

  /**
   * Begin a pointer at a surface point.
   *
   * Returns `false` when the layout is invalid or the point starts in
   * letterbox space; the gesture must be rejected and never becomes the owner.
   */
  begin(
    pointerId: number,
    surfacePoint: Point2D,
    camera?: CameraCut2D,
  ): boolean {
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
    this.#input.begin(this.#action, pointerId, this.#toWorld(viewport, surfacePoint, camera));
    return true;
  }

  /** Move a pointer. Conversion remains unbounded outside content bounds. */
  move(pointerId: number, surfacePoint: Point2D, camera?: CameraCut2D): void {
    if (this.#disposed) {
      return;
    }
    const viewport = this.#getViewport();
    if (viewport === undefined) {
      return;
    }
    this.#input.move(this.#action, pointerId, this.#toWorld(viewport, surfacePoint, camera));
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
  handleTouchesDown(pointerId: number, x: number, y: number, camera?: CameraCut2D): boolean {
    return this.begin(pointerId, { x, y }, camera);
  }

  /** Handle a touch-move gesture event with a surface position. */
  handleTouchesMove(pointerId: number, x: number, y: number, camera?: CameraCut2D): void {
    this.move(pointerId, { x, y }, camera);
  }

  /**
   * Handle a touch-up gesture event with its final surface position.
   *
   * The final position is forwarded before ownership ends so the documented
   * release frame contains the actual point where the pointer lifted.
   */
  handleTouchesUp(pointerId: number, x: number, y: number, camera?: CameraCut2D): void {
    this.move(pointerId, { x, y }, camera);
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
