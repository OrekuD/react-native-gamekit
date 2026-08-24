/**
 * Test-only chunk-read instrumentation (T16-F6/T16-RF4).
 *
 * Lives OUTSIDE the public `rn-gamekit/tilemap` entry: the counters are
 * re-exported only through the `rn-gamekit/testing` subpath so published
 * diagnostics never leak double-underscore seams into app code.
 */

let chunkReads = 0;

/** Internal: record one chunk-region lookup. */
export function recordChunkRead(): void {
  chunkReads += 1;
}

/** Test-only: reset the chunk-visit counter. */
export function __resetChunkReadStats(): void {
  chunkReads = 0;
}

/** Test-only: number of chunk lookups since the last reset. */
export function __chunkReadCount(): number {
  return chunkReads;
}
