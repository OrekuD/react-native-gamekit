type FrameCallback = (timestampMs: number) => void;

/** Deterministic animation-frame driver for runtime tests. */
export class ManualFrameDriver {
  readonly #callbacks = new Map<number, FrameCallback>();
  readonly #allCallbacks = new Map<number, FrameCallback>();
  #nextHandle = 1;

  get pendingCount(): number {
    return this.#callbacks.size;
  }

  requestFrame(callback: FrameCallback): number {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#callbacks.set(handle, callback);
    this.#allCallbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.#callbacks.delete(handle);
  }

  fireNext(timestampMs: number): number {
    const next = this.#callbacks.entries().next();

    if (next.done) {
      throw new Error('No frame is pending');
    }

    const [handle, callback] = next.value;
    this.#callbacks.delete(handle);
    callback(timestampMs);
    return handle;
  }

  fireCancelled(handle: number, timestampMs: number): void {
    const callback = this.#allCallbacks.get(handle);

    if (!callback) {
      throw new Error(`Unknown frame handle: ${handle}`);
    }

    callback(timestampMs);
  }
}
