/**
 * UI-owned alpha clock (T5).
 *
 * Pure, worklet-safe presentation clock: `alpha` advances from UI frame
 * deltas against the simulation step duration and resets to zero whenever a
 * newer commit arrives. It never extrapolates past the current snapshot
 * (clamped at 1, then held) and ignores stale or duplicate commits so a
 * delayed write cannot reset presentation backward.
 *
 * The `epoch` guards session replacement: a new GameView binding carries a
 * fresh epoch, so a replacement session whose revision restarts at zero is
 * still accepted, while a delayed write from an old epoch is ignored.
 */

export interface AlphaClockCommit {
  /** Monotonic binding epoch; new epoch accepts any revision. */
  readonly epoch: number;
  /** Session commit revision; new revisions reset the clock. */
  readonly revision: number;
  /** Fixed simulation step duration in milliseconds. */
  readonly stepMs: number;
}

export interface AlphaClockState {
  readonly epoch: number;
  readonly revision: number;
  readonly alpha: number;
}

/** Advance the clock by one UI frame; returns the next alpha state. */
export function advanceAlpha(
  previous: AlphaClockState,
  commit: AlphaClockCommit,
  frameDeltaMs: number,
): AlphaClockState {
  'worklet';
  if (
    commit.epoch > previous.epoch ||
    (commit.epoch === previous.epoch && commit.revision > previous.revision)
  ) {
    return { epoch: commit.epoch, revision: commit.revision, alpha: 0 };
  }
  if (
    commit.epoch < previous.epoch ||
    (commit.epoch === previous.epoch && commit.revision < previous.revision)
  ) {
    return previous; // A stale write is ignored entirely, alpha preserved.
  }
  if (previous.alpha >= 1) {
    return previous; // Clamp at 1: hold, never extrapolate.
  }
  const delta = Math.max(0, frameDeltaMs) / commit.stepMs;
  const next = previous.alpha + delta;
  return {
    epoch: previous.epoch,
    revision: previous.revision,
    alpha: next >= 1 ? 1 : next,
  };
}
