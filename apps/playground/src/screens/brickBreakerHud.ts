import type { BrickBreakerRenderFrame } from '../games/brickBreakerGame';

/**
 * Low-frequency HUD selection for the Brick Breaker screen.
 *
 * `selectHud` extracts a small plain object and `hudEqual` decides whether a
 * newly selected value is worth re-rendering for. Both are pure so the
 * no-per-frame-render contract can be regression-tested headlessly.
 */
export interface HudState {
  readonly scene: string;
  readonly score: number;
  readonly prompt: string;
}

export function selectHud(frame: BrickBreakerRenderFrame): HudState {
  if (frame.scene === 'ready') {
    return { scene: 'ready', score: 0, prompt: frame.current.prompt };
  }
  if (frame.scene === 'play') {
    return { scene: 'play', score: frame.current.score, prompt: frame.current.prompt };
  }
  return { scene: 'game-over', score: 0, prompt: frame.current.message };
}

/** Whether two HUD selections are visually equivalent. */
export function hudEqual(a: HudState, b: HudState): boolean {
  return a.scene === b.scene && a.score === b.score && a.prompt === b.prompt;
}
