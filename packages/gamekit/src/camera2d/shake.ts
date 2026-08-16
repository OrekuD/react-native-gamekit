/**
 * Camera2D deterministic shake (T12.2).
 *
 * Shake is reproducible from explicit state: a seed, elapsed simulation
 * time, duration, and amplitude. No `Math.random()` anywhere. The sampler
 * returns the unmodified base camera at and after the duration, and never
 * mutates its input. Presentation applies the offset to the presented
 * camera, so pointer inversion (which uses the same presented camera)
 * keeps visible targets touchable.
 */
import type { Camera2D, CameraShakeOptions2D } from './types';
import { assertValidCamera2D } from './validation';
import { assertFiniteNumber, assertNonnegativeSize, GeometryError } from '../geometry/validation';

function assertValidShakeOptions(options: CameraShakeOptions2D): void {
  assertFiniteNumber(options.seed, 'seed');
  assertFiniteNumber(options.elapsedSeconds, 'elapsedSeconds');
  if (!(options.elapsedSeconds >= 0)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'elapsedSeconds',
      `expected a nonnegative elapsed time, got ${String(options.elapsedSeconds)}`,
    );
  }
  assertFiniteNumber(options.durationSeconds, 'durationSeconds');
  if (!(options.durationSeconds > 0)) {
    throw new GeometryError(
      'GEOMETRY_INVALID_NUMBER',
      'durationSeconds',
      `expected a positive duration, got ${String(options.durationSeconds)}`,
    );
  }
  assertNonnegativeSize(options.amplitude, 'amplitude');
  if (options.frequency !== undefined) {
    assertFiniteNumber(options.frequency, 'frequency');
  }
}

/** Deterministic per-axis phase from the seed (never a wall-clock read). */
function phaseOf(seed: number, axis: number): number {
  const raw = Math.sin(seed * 12.9898 + axis * 78.233) * 43758.5453;
  const fraction = raw - Math.floor(raw);
  return fraction * Math.PI * 2;
}

/**
 * Sample the presented camera offset for a shake.
 *
 * The offset decays linearly to zero over `durationSeconds`; at and after
 * the duration the base camera is returned unchanged. Equal options
 * produce equal results.
 */
export function sampleCameraShake2D(
  base: Camera2D,
  options: CameraShakeOptions2D,
): Camera2D {
  assertValidCamera2D(base);
  assertValidShakeOptions(options);

  const { seed, elapsedSeconds, durationSeconds, amplitude, frequency = Math.PI * 2 } = options;
  if (elapsedSeconds >= durationSeconds || amplitude === 0) {
    return base;
  }
  const envelope = 1 - elapsedSeconds / durationSeconds;
  const offset = {
    x: Math.sin(elapsedSeconds * frequency + phaseOf(seed, 1)) * amplitude * envelope,
    y: Math.sin(elapsedSeconds * frequency + phaseOf(seed, 2)) * amplitude * envelope,
  };
  return {
    center: {
      x: base.center.x + offset.x,
      y: base.center.y + offset.y,
    },
    zoom: base.zoom,
    rotationRadians: base.rotationRadians,
  };
}
