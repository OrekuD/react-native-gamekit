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
  /** Release acquired stages, then rethrow setup and cleanup failures losslessly. */
  releaseAfterFailure(error: unknown): never;
}

export function createCleanupList(): CleanupList {
  let releases: Array<() => void> = [];
  const releaseRegistered = (): unknown[] => {
    // Detach first: a release may synchronously reenter the cleanup path.
    const pending = releases;
    releases = [];
    const failures: unknown[] = [];
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      try {
        pending[index]?.();
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  };
  return {
    add(release: () => void): void {
      releases.push(release);
    },
    releaseAll(): void {
      const failures = releaseRegistered();
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
    releaseAfterFailure(error: unknown): never {
      const failures = releaseRegistered();
      if (failures.length > 0) {
        throw new AggregateError([error, ...failures], 'Setup and cleanup failed');
      }
      throw error;
    },
  };
}
