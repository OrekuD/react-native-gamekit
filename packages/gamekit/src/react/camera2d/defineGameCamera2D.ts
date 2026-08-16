/**
 * Camera2D definition (T12.3).
 *
 * A static, declarative camera binding: `select` reads the authored camera
 * from committed frames, and the optional `cut` predicate signals an
 * explicit cut (teleports, respawns) where interpolation must snap. The
 * binding is owned by `GameView` and never by the renderer or the pointer
 * adapter, so both consume the same presented generation.
 */
import type { Camera2D } from '../../camera2d';

/** The static camera definition supplied to `GameView`. */
export interface GameCamera2DDefinition<TFrame> {
  /**
   * Read the authored camera from a committed frame. Runs once per commit
   * on the JS runtime; returning the same value keeps the camera static.
   */
  readonly select: (frame: TFrame) => Camera2D;
  /**
   * Optional explicit cut signal evaluated per commit. Returning true
   * snaps presentation (no interpolation into the new camera), joining the
   * automatic cuts for scene transitions, session replacement, and
   * binding-generation changes.
   */
  readonly cut?: (frame: TFrame) => boolean;
}

/** Validate and return a camera definition. */
export function defineGameCamera2D<TFrame>(
  definition: GameCamera2DDefinition<TFrame>,
): GameCamera2DDefinition<TFrame> {
  if (typeof definition.select !== 'function') {
    throw new Error('defineGameCamera2D requires a select function');
  }
  return definition;
}
