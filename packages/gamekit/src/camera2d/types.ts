/**
 * Camera2D public values (T12.1).
 *
 * A camera is immutable plain data: where the view is centered in world
 * space, how much it zooms, and how it rotates. It carries no Skia
 * matrices, no shared values, no viewport dimensions — presentation and
 * conversion derive everything from this value plus the authored logical
 * view.
 */
import type { Point2D } from '../geometry/types';

/** The authored 2D camera value. */
export interface Camera2D {
  /** World-space point the camera looks at. */
  readonly center: Point2D;
  /** Finite uniform zoom, greater than zero. */
  readonly zoom: number;
  /** Rotation in radians, positive per the Skia coordinate convention. */
  readonly rotationRadians: number;
}

/**
 * A presented camera with an explicit cut signal.
 *
 * `cutId` increases monotonically across the lifetime of a camera binding.
 * A changed `cutId` means the previous camera is unrelated: presentation
 * snaps instead of interpolating (scene transitions, session replacement,
 * binding-generation changes, explicit teleports, invalid prior data).
 */
export interface CameraCut2D {
  /** The camera to present. */
  readonly camera: Camera2D;
  /** Monotonic cut signal; a new value disables interpolation. */
  readonly cutId: number;
}

/** Per-axis follow enablement. Both default to true. */
export interface CameraFollowAxisOptions2D {
  /** Follow on the horizontal axis. */
  readonly x?: boolean;
  /** Follow on the vertical axis. */
  readonly y?: boolean;
}

/** Options for `followCamera2D`. */
export interface FollowCamera2DOptions2D {
  /**
   * Axis-aligned dead zone in world units, centered on the camera center.
   * A target inside the zone leaves the camera untouched.
   */
  readonly deadZone?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Per-axis follow enablement. */
  readonly perAxis?: CameraFollowAxisOptions2D;
  /**
   * Damping half-life in seconds: after this many seconds the remaining
   * follow distance halves. Requires `deltaSeconds` on the call.
   */
  readonly dampingHalfLifeSeconds?: number;
}

/** Options for `sampleCameraShake2D`. */
export interface CameraShakeOptions2D {
  /** Deterministic seed; equal seeds produce equal offsets. */
  readonly seed: number;
  /** Elapsed simulation time in seconds since the shake began. */
  readonly elapsedSeconds: number;
  /** Shake duration in seconds; the base camera returns exactly at end. */
  readonly durationSeconds: number;
  /** Peak offset magnitude in world units. */
  readonly amplitude: number;
  /** Angular frequency in radians per second (defaults to 2π). */
  readonly frequency?: number;
}
