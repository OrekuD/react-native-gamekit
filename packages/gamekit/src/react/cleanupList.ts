/**
 * Ordered, transactional release list for multi-stage setup (GS-REACT-02).
 *
 * Platform-neutral: no React import, so the headless binders and the React
 * adapter share it. Stages register their release as they complete; a setup
 * failure releases everything acquired so far, and the final cleanup runs
 * every release in reverse registration order, composing failures
 * losslessly instead of stopping at the first one.
 */
export interface CleanupList {
  /** Register a release for a completed setup stage. */
  add(release: () => void): void;
  /**
   * Run every registered release in reverse order. A lone failure rethrows
   * unwrapped; several compose into an `AggregateError` in run order. The
   * list drains, so releasing twice is a no-op.
   */
  releaseAll(): void;
}

export function createCleanupList(): CleanupList {
  const releases: Array<() => void> = [];
  return {
    add(release: () => void): void {
      releases.push(release);
    },
    releaseAll(): void {
      const failures: unknown[] = [];
      for (let index = releases.length - 1; index >= 0; index -= 1) {
        try {
          releases[index]?.();
        } catch (error) {
          failures.push(error);
        }
      }
      releases.length = 0;
      if (failures.length === 1) {
        throw failures[0];
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          'Cleanup failed with multiple errors',
        );
      }
    },
  };
}
