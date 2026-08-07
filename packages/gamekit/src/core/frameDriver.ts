/** Opaque handle returned by an animation-frame driver. */
export type FrameHandle = number;

/** Minimal presentation clock used by the fixed-step runtime. */
export interface FrameDriver {
  /** Request the next presentation callback. */
  requestFrame(callback: (timestampMs: number) => void): FrameHandle;
  /** Cancel a previously requested callback. */
  cancelFrame(handle: FrameHandle): void;
}

interface AnimationFrameHost {
  requestAnimationFrame(callback: (timestampMs: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

/** Create the platform animation-frame driver used by live sessions. */
export function createAnimationFrameDriver(): FrameDriver {
  const host = globalThis as unknown as Partial<AnimationFrameHost>;

  if (!host.requestAnimationFrame || !host.cancelAnimationFrame) {
    throw new Error('GameSession requires requestAnimationFrame on this platform');
  }

  return {
    requestFrame: (callback) => host.requestAnimationFrame!(callback),
    cancelFrame: (handle) => host.cancelAnimationFrame!(handle),
  };
}
