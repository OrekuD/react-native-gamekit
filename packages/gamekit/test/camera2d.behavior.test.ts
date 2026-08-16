/**
 * T12.2: follow, dead zones, bounds clamping, and deterministic shake.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampCameraBounds2D,
  createCamera2D,
  followCamera2D,
  sampleCameraShake2D,
  type Camera2D,
} from '../src/camera2d/index.ts';
import { GeometryError } from '../src/geometry/index.ts';

const TOLERANCE = 1e-9;
const VIEW = { x: -80, y: -120, width: 160, height: 240 };

function approx(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `expected ${actual} ~ ${expected}`);
}

function approxPoint(
  actual: { readonly x: number; readonly y: number },
  expected: { readonly x: number; readonly y: number },
): void {
  approx(actual.x, expected.x);
  approx(actual.y, expected.y);
}

const DEAD_ZONE = { x: -16, y: -16, width: 32, height: 32 };

describe('camera2d follow', () => {
  const start = createCamera2D({ center: { x: 100, y: 100 } });

  it('follows directly when there is no dead zone', () => {
    const next = followCamera2D(start, { x: 300, y: -50 });
    approxPoint(next.center, { x: 300, y: -50 });
    assert.equal(next.zoom, start.zoom);
    assert.equal(next.rotationRadians, start.rotationRadians);
  });

  it('does not move a target inside the dead zone', () => {
    const next = followCamera2D(start, { x: 110, y: 95 }, { deadZone: DEAD_ZONE });
    assert.deepEqual(next, start);
  });

  it('moves only the required amount when one edge is crossed', () => {
    // Target 20 px right of center: the dead zone ends at +16.
    const next = followCamera2D(start, { x: 120, y: 100 }, { deadZone: DEAD_ZONE });
    approxPoint(next.center, { x: 104, y: 100 });
    // Target below the zone on y only.
    const vertical = followCamera2D(start, { x: 100, y: 150 }, { deadZone: DEAD_ZONE });
    approxPoint(vertical.center, { x: 100, y: 134 });
  });

  it('supports per-axis follow', () => {
    const xOnly = followCamera2D(
      start,
      { x: 500, y: 500 },
      { deadZone: DEAD_ZONE, perAxis: { x: true, y: false } },
    );
    approxPoint(xOnly.center, { x: 484, y: 100 });
    const yOnly = followCamera2D(
      start,
      { x: 500, y: 500 },
      { deadZone: DEAD_ZONE, perAxis: { x: false, y: true } },
    );
    approxPoint(yOnly.center, { x: 100, y: 484 });
  });

  it('damps toward the desired position with a half-life model', () => {
    const halfLife = 0.5; // one second halves the remaining distance twice
    const next = followCamera2D(
      start,
      { x: 300, y: 100 },
      { dampingHalfLifeSeconds: halfLife },
      1,
    );
    // Remaining distance 200 -> half-life 0.5 s over 1 s: 0.5^(1/0.5) = 0.25.
    approx(next.center.x, 300 - 200 * 0.25);
    approx(next.center.y, 100);
  });

  it('produces equivalent results for equivalent fixed-step schedules', () => {
    const options = { dampingHalfLifeSeconds: 0.5 };
    // Two half-second steps at half-life 0.5 == one second step.
    let stepped: Camera2D = start;
    for (let i = 0; i < 2; i += 1) {
      stepped = followCamera2D(stepped, { x: 300, y: 100 }, options, 0.5);
    }
    const once = followCamera2D(start, { x: 300, y: 100 }, options, 1);
    approxPoint(stepped.center, once.center);
  });

  it('rejects invalid options', () => {
    assert.throws(
      () => followCamera2D(start, { x: 0, y: 0 }, { dampingHalfLifeSeconds: 0 }, 1 / 60),
      GeometryError,
    );
    assert.throws(
      () => followCamera2D(start, { x: 0, y: 0 }, { dampingHalfLifeSeconds: 0.5 }),
      GeometryError,
    );
    assert.throws(() => followCamera2D(start, { x: NaN, y: 0 }), GeometryError);
  });
});

describe('camera2d bounds clamping', () => {
  it('clamps the visible region inside a sufficiently large world', () => {
    const camera = createCamera2D({ center: { x: 5000, y: -5000 } });
    const world = { x: 0, y: -1000, width: 2000, height: 2000 };
    const clamped = clampCameraBounds2D(camera, world, VIEW);
    approxPoint(clamped.center, { x: 2000 - 80, y: -1000 + 120 });
  });

  it('centers axes where the world is smaller than the view', () => {
    const camera = createCamera2D({ center: { x: 1000, y: 1000 } });
    const world = { x: 100, y: 100, width: 200, height: 40 };
    const clamped = clampCameraBounds2D(camera, world, VIEW);
    // x: world (200) is wider than the view (160) -> clamped to the far
    // edge; y: world (40) is smaller than the view (240) -> centered.
    approxPoint(clamped.center, { x: 220, y: 120 });
  });

  it('recomputes the allowed center range when zoom changes', () => {
    const zoomed = createCamera2D({ center: { x: 5000, y: 0 }, zoom: 4 });
    const world = { x: 0, y: 0, width: 1000, height: 1000 };
    const clamped = clampCameraBounds2D(zoomed, world, VIEW);
    // Half view at zoom 4: 20 x 30.
    approxPoint(clamped.center, { x: 1000 - 20, y: 30 });
  });

  it('keeps the conservative rotation policy stable at edges', () => {
    const rotated = createCamera2D({
      center: { x: 5000, y: 5000 },
      rotationRadians: Math.PI / 4,
    });
    const world = { x: 0, y: 0, width: 400, height: 400 };
    const first = clampCameraBounds2D(rotated, world, VIEW);
    const second = clampCameraBounds2D(first, world, VIEW);
    assert.deepEqual(first, second, 'no jitter at the boundary');
    approx(first.center.x, 400 - (80 * Math.SQRT1_2 + 120 * Math.SQRT1_2));
  });

  it('rejects invalid world bounds', () => {
    assert.throws(
      () => clampCameraBounds2D(createCamera2D(), { x: 0, y: 0, width: -1, height: 100 }, VIEW),
      GeometryError,
    );
  });
});

describe('camera2d shake', () => {
  const base = createCamera2D({ center: { x: 10, y: 20 }, zoom: 1.5, rotationRadians: 0.2 });

  it('is deterministic for equal seed and elapsed time', () => {
    const options = { seed: 7, elapsedSeconds: 0.25, durationSeconds: 0.3, amplitude: 4 };
    const first = sampleCameraShake2D(base, options);
    const second = sampleCameraShake2D(base, options);
    assert.deepEqual(first, second);
  });

  it('never mutates the base camera', () => {
    const options = { seed: 3, elapsedSeconds: 0.1, durationSeconds: 0.5, amplitude: 8 };
    const shaken = sampleCameraShake2D(base, options);
    assert.deepEqual(base, { center: { x: 10, y: 20 }, zoom: 1.5, rotationRadians: 0.2 });
    assert.notDeepEqual(shaken.center, base.center);
    assert.equal(shaken.zoom, base.zoom);
    assert.equal(shaken.rotationRadians, base.rotationRadians);
  });

  it('stays within the amplitude envelope and ends exactly at duration', () => {
    const options = { seed: 11, elapsedSeconds: 0.1, durationSeconds: 0.4, amplitude: 5 };
    const shaken = sampleCameraShake2D(base, options);
    // The envelope caps the offset: at t = 0.1 of 0.4 s the peak is
    // amplitude * (1 - 0.25) = 3.75; the two phase-shifted sines never
    // exceed it, and the shake is visibly nonzero.
    const magnitude = Math.hypot(shaken.center.x - base.center.x, shaken.center.y - base.center.y);
    assert.ok(magnitude > 1, `the shake is active (magnitude ${magnitude})`);
    assert.ok(magnitude <= 3.75 + 1e-9, `the envelope caps the shake (magnitude ${magnitude})`);
    const atEnd = sampleCameraShake2D(base, { ...options, elapsedSeconds: 0.4 });
    assert.deepEqual(atEnd, base, 'returns the unmodified base at duration');
    const past = sampleCameraShake2D(base, { ...options, elapsedSeconds: 1.2 });
    assert.deepEqual(past, base);
  });

  it('rejects invalid shake options', () => {
    assert.throws(
      () => sampleCameraShake2D(base, { seed: 1, elapsedSeconds: -1, durationSeconds: 1, amplitude: 1 }),
      GeometryError,
    );
    assert.throws(
      () => sampleCameraShake2D(base, { seed: 1, elapsedSeconds: 0, durationSeconds: 0, amplitude: 1 }),
      GeometryError,
    );
  });
});
