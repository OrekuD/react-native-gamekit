/**
 * Presentation interpolation for the Brick Breaker renderer.
 *
 * Same-scene `previous`/`current` snapshot values are blended with `alpha` so
 * a 120 Hz presentation is visually smoother than the 60 Hz simulation. On a
 * scene-transition hard cut `previous === current`, so the interpolation is a
 * no-op and frames never blend two scenes. The functions are marked `worklet`
 * so the Skia renderer can call them on the UI thread.
 */

export interface BallSample {
  readonly x: number;
  readonly y: number;
}

export interface PaddleSample {
  readonly x: number;
}

export function interpolateBall(
  previous: BallSample,
  current: BallSample,
  alpha: number,
): BallSample {
  'worklet';
  return {
    x: previous.x + (current.x - previous.x) * alpha,
    y: previous.y + (current.y - previous.y) * alpha,
  };
}

export function interpolatePaddle(
  previous: PaddleSample,
  current: PaddleSample,
  alpha: number,
): number {
  'worklet';
  return previous.x + (current.x - previous.x) * alpha;
}
