import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCamera2D, sampleCameraShake2D } from '../src/camera2d/index.ts';

describe('camera shake magnitude envelope', () => {
  it('bounds the combined offset and preserves its sampled direction', () => {
    const shaken = sampleCameraShake2D(createCamera2D(), {
      seed: 1,
      elapsedSeconds: 0.1,
      durationSeconds: 1,
      amplitude: 1,
    });
    const { x, y } = shaken.center;
    // This seed previously produced magnitude 1.1025 with a 0.9 envelope.
    const previousOffset = { x: -0.7596380052449301, y: 0.7990734373021395 };
    assert.ok(Math.abs(Math.hypot(x, y) - 0.9) < 1e-12);
    assert.ok(Math.abs(x * previousOffset.y - y * previousOffset.x) < 1e-12);
    assert.ok(x * previousOffset.x + y * previousOffset.y > 0);
  });

  for (const frequency of [undefined, 0, Math.PI * 2, 15, -3]) {
    it(`respects the envelope across seeds and elapsed times at frequency ${String(frequency)}`, () => {
      const base = createCamera2D({ center: { x: -12, y: 24 }, zoom: 2, rotationRadians: 0.4 });
      for (const seed of [-7, 0, 1, 2, 11, 32]) {
        for (const durationSeconds of [0.2, 1, 2.5]) {
          for (const elapsedRatio of [0, 0.01, 0.1, 0.25, 0.5, 0.75, 0.99, 1, 2]) {
            for (const amplitude of [0, 0.1, 1, 5]) {
              const elapsedSeconds = elapsedRatio * durationSeconds;
              const options = {
                seed, elapsedSeconds, durationSeconds, amplitude,
                ...(frequency === undefined ? {} : { frequency }),
              };
              const shaken = sampleCameraShake2D(base, options);
              const magnitude = Math.hypot(shaken.center.x - base.center.x, shaken.center.y - base.center.y);
              const envelope = amplitude * Math.max(0, 1 - elapsedSeconds / durationSeconds);
              assert.ok(magnitude <= envelope + 1e-12, `${JSON.stringify(options)}: ${magnitude} > ${envelope}`);
              assert.equal(shaken.zoom, base.zoom);
              assert.equal(shaken.rotationRadians, base.rotationRadians);
            }
          }
        }
      }
    });
  }

  it('preserves samples that already fit within the envelope', () => {
    const shaken = sampleCameraShake2D(createCamera2D(), {
      seed: 11,
      elapsedSeconds: 0.1,
      durationSeconds: 0.4,
      amplitude: 5,
    });
    assert.deepEqual(shaken.center, { x: -3.5065778686949285, y: 0.3753235736238849 });
  });
});
