import { createGameSessionWithDriver } from './core/session/createGameSession';
import { createAnimationFrameDriver } from './core/frameDriver';
import type { FrameDriver, FrameHandle } from './core/frameDriver';
import type { SessionDiagnostics } from './core/session/diagnostics';

export { createAnimationFrameDriver, createGameSessionWithDriver };
export type { FrameDriver, FrameHandle, SessionDiagnostics };

/**
 * Deterministic animation-frame driver for headless tests.
 *
 * Frames are fired manually with explicit timestamps, so games can be driven
 * with a fixed step and exact wall-clock schedules in Node without a
 * simulator.
 */
export class ManualFrameDriver implements FrameDriver {
  readonly #callbacks = new Map<number, (timestampMs: number) => void>();
  readonly #allCallbacks = new Map<number, (timestampMs: number) => void>();
  #nextHandle = 1;

  /** Number of currently scheduled callbacks. */
  get pendingCount(): number {
    return this.#callbacks.size;
  }

  requestFrame(callback: (timestampMs: number) => void): FrameHandle {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#callbacks.set(handle, callback);
    this.#allCallbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: FrameHandle): void {
    this.#callbacks.delete(handle);
  }

  /** Fire the next pending callback with the given timestamp. */
  fireNext(timestampMs: number): FrameHandle {
    const next = this.#callbacks.entries().next();
    if (next.done) {
      throw new Error('No frame is pending');
    }
    const [handle, callback] = next.value;
    this.#callbacks.delete(handle);
    callback(timestampMs);
    return handle;
  }

  /**
   * Fire a specific handle even if it was already fired, simulating a stale
   * callback racing with a lifecycle change.
   */
  fireCancelled(handle: FrameHandle, timestampMs: number): void {
    const callback = this.#allCallbacks.get(handle);
    if (!callback) {
      throw new Error(`Unknown frame handle: ${handle}`);
    }
    callback(timestampMs);
  }
}

// Test-only tilemap chunk-read instrumentation (T16-RF4): intentionally NOT
// re-exported from rn-gamekit/tilemap.
export { __resetChunkReadStats, __chunkReadCount } from './tilemap/chunkStats';
