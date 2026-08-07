import { resolveViewport2D, type ResolvedViewport2D, type SurfaceSize, type Viewport } from '../viewport2d';

/**
 * Platform-neutral holder for the resolved viewport of a mounted game
 * surface.
 *
 * It re-resolves whenever the surface size changes, notifies subscribers on
 * each layout revision (so pointer input can cancel an active gesture on
 * layout invalidation), and exposes the latest immutable resolved viewport to
 * both the renderer and the input adapter. It never touches React, Skia, or
 * platform dimensions.
 */
export class ViewportBinding {
  readonly #config: Viewport;
  #resolved: ResolvedViewport2D | undefined;
  #lastSurfaceSize: SurfaceSize | undefined;
  #revision = 0;
  #listeners = new Set<() => void>();

  constructor(config: Viewport) {
    this.#config = config;
  }

  /** The authored viewport configuration this binding resolves. */
  get config(): Viewport {
    return this.#config;
  }

  /** The latest resolved viewport, or `undefined` while the layout is invalid. */
  get resolved(): ResolvedViewport2D | undefined {
    return this.#resolved;
  }

  /** Monotonic counter incremented on every layout revision. */
  get revision(): number {
    return this.#revision;
  }

  /**
   * Resolve the configured viewport against a new surface size.
   *
   * No-op for unchanged sizes. Subscribers are notified only when the layout
   * actually changes.
   */
  setSurfaceSize(size: SurfaceSize): void {
    if (
      this.#lastSurfaceSize !== undefined &&
      this.#lastSurfaceSize.width === size.width &&
      this.#lastSurfaceSize.height === size.height
    ) {
      return;
    }
    this.#lastSurfaceSize = Object.freeze({ width: size.width, height: size.height });
    this.#resolved = resolveViewport2D(this.#config, size);
    this.#revision += 1;
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }

  /** Observe layout revisions. Returns an idempotent unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    let removed = false;
    return () => {
      if (removed) {
        return;
      }
      removed = true;
      this.#listeners.delete(listener);
    };
  }

  /** Release subscribers. The binding becomes inert. */
  dispose(): void {
    this.#listeners.clear();
  }
}
