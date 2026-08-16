/**
 * T12.1: pure Camera2D math — types, validation, transforms, interpolation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createCamera2D,
  getCameraVisibleBounds2D,
  interpolateCamera2D,
  logicalToWorld2D,
  surfaceToWorld2D,
  worldToLogical2D,
  worldToSurface2D,
  type Camera2D,
  type CameraCut2D,
} from '../src/camera2d/index.ts';
import { GeometryError } from '../src/geometry/index.ts';
import { resolveViewport2D } from '../src/viewport2d/index.ts';

const TOLERANCE = 1e-9;
const VIEW = { x: -80, y: -120, width: 160, height: 240 };
const CENTERED = { x: 0, y: 0 };

function approx(actual: number, expected: number, tolerance = TOLERANCE): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function approxPoint(
  actual: { readonly x: number; readonly y: number },
  expected: { readonly x: number; readonly y: number },
): void {
  approx(actual.x, expected.x);
  approx(actual.y, expected.y);
}

function rejects(fn: () => unknown, field: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof GeometryError, `throws GeometryError, got ${String(error)}`);
    assert.equal((error as GeometryError).field, field);
    return true;
  });
}

describe('camera2d values', () => {
  it('creates a full identity camera from nothing', () => {
    const camera = createCamera2D();
    assert.deepEqual(camera, { center: { x: 0, y: 0 }, zoom: 1, rotationRadians: 0 });
    assert.ok(Object.isFrozen(camera));
    assert.ok(Object.isFrozen(camera.center));
  });

  it('fills partial values and keeps the rest at identity', () => {
    const camera = createCamera2D({ center: { x: 10, y: -20 }, zoom: 2 });
    assert.deepEqual(camera, { center: { x: 10, y: -20 }, zoom: 2, rotationRadians: 0 });
  });

  it('rejects non-finite centers, zoom, and rotation', () => {
    rejects(() => createCamera2D({ center: { x: NaN, y: 0 } }), 'center.x');
    rejects(() => createCamera2D({ center: { x: 0, y: Infinity } }), 'center.y');
    rejects(() => createCamera2D({ zoom: NaN }), 'zoom');
    rejects(() => createCamera2D({ zoom: 0 }), 'zoom');
    rejects(() => createCamera2D({ zoom: -1 }), 'zoom');
    rejects(() => createCamera2D({ rotationRadians: Infinity }), 'rotationRadians');
    rejects(() => createCamera2D({ rotationRadians: NaN }), 'rotationRadians');
  });
});

describe('camera2d transforms', () => {
  it('maps identity at origin onto the logical view center', () => {
    const camera = createCamera2D();
    approxPoint(worldToLogical2D({ x: 0, y: 0 }, camera, VIEW), CENTERED);
    approxPoint(worldToLogical2D({ x: 5, y: 5 }, camera, VIEW), { x: 5, y: 5 });
  });

  it('translates world points by the camera center', () => {
    const camera = createCamera2D({ center: { x: 100, y: 50 } });
    approxPoint(worldToLogical2D({ x: 100, y: 50 }, camera, VIEW), CENTERED);
    approxPoint(worldToLogical2D({ x: 105, y: 45 }, camera, VIEW), { x: 5, y: -5 });
  });

  it('supports negative world coordinates and large worlds', () => {
    const camera = createCamera2D({ center: { x: -1000, y: 2000 } });
    const point = { x: -1003, y: 1997 };
    approxPoint(worldToLogical2D(point, camera, VIEW), { x: -3, y: -3 });
    approxPoint(logicalToWorld2D({ x: -3, y: -3 }, camera, VIEW), point);
  });

  it('zooms in and out around the logical view center', () => {
    const zoomIn = createCamera2D({ zoom: 2 });
    approxPoint(worldToLogical2D({ x: 5, y: 5 }, zoomIn, VIEW), { x: 10, y: 10 });
    const zoomOut = createCamera2D({ zoom: 0.5 });
    approxPoint(worldToLogical2D({ x: 5, y: 5 }, zoomOut, VIEW), { x: 2.5, y: 2.5 });
  });

  it('rotates quarter, half, negative, and wrapped rotations', () => {
    // Frozen forward formula: logical = L + rotate(P - C, -R) * Z. A
    // positive rotation turns the camera clockwise, so the world point
    // below the center appears on the RIGHT of the view.
    const quarter = createCamera2D({ rotationRadians: Math.PI / 2 });
    approxPoint(worldToLogical2D({ x: 0, y: 10 }, quarter, VIEW), { x: 10, y: 0 });
    const half = createCamera2D({ rotationRadians: Math.PI });
    approxPoint(worldToLogical2D({ x: 5, y: 3 }, half, VIEW), { x: -5, y: -3 });
    const negative = createCamera2D({ rotationRadians: -Math.PI / 2 });
    approxPoint(worldToLogical2D({ x: 0, y: 10 }, negative, VIEW), { x: -10, y: 0 });
    const wrapped = createCamera2D({ rotationRadians: Math.PI * 5 });
    approxPoint(worldToLogical2D({ x: 5, y: 3 }, wrapped, VIEW), { x: -5, y: -3 });
  });

  it('uses a non-origin logical view for the logical offset', () => {
    const offCenter = { x: 40, y: 60, width: 160, height: 240 }; // center (120, 180)
    const camera = createCamera2D({ center: { x: 120, y: 180 } });
    approxPoint(worldToLogical2D({ x: 120, y: 180 }, camera, offCenter), { x: 120, y: 180 });
    approxPoint(worldToLogical2D({ x: 125, y: 175 }, camera, offCenter), { x: 125, y: 175 });
  });

  it('round-trips forward and inverse across representative values', () => {
    const cameras: Camera2D[] = [
      createCamera2D(),
      createCamera2D({ center: { x: 300, y: -150 }, zoom: 2.5 }),
      createCamera2D({ center: { x: -5, y: 5 }, zoom: 0.25, rotationRadians: 1.1 }),
      createCamera2D({ center: { x: 0, y: 0 }, zoom: 3, rotationRadians: -0.7 }),
    ];
    for (const camera of cameras) {
      for (const point of [
        { x: 0, y: 0 },
        { x: 123.456, y: -789.012 },
        { x: -2000, y: 3000 },
      ]) {
        approxPoint(logicalToWorld2D(worldToLogical2D(point, camera, VIEW), camera, VIEW), point);
      }
    }
  });

  it('round-trips world/surface through fit, fill, and extend-world viewports', () => {
    const fit = resolveViewport2D(
      { logicalSize: { width: 160, height: 240 }, mode: 'fit' },
      { width: 320, height: 480 },
    )!;
    const fill = resolveViewport2D(
      { logicalSize: { width: 160, height: 240 }, mode: 'fill' },
      { width: 640, height: 320 },
    )!;
    const extend = resolveViewport2D(
      { logicalSize: { width: 160, height: 240 }, mode: 'extend-world' },
      { width: 480, height: 240 },
    )!;
    const camera = createCamera2D({ center: { x: 40, y: -30 }, zoom: 1.5, rotationRadians: 0.4 });
    for (const viewport of [fit, fill, extend]) {
      for (const point of [
        { x: 40, y: -30 },
        { x: 200, y: 100 },
        { x: -300, y: -250 },
      ]) {
        approxPoint(surfaceToWorld2D(worldToSurface2D(point, viewport, camera), viewport, camera), point);
      }
    }
  });

  it('matches the no-camera viewport path exactly for the identity camera', () => {
    // Frozen identity semantics (T12.0): the camera that reproduces the
    // no-camera view is the camera whose center equals the logical view
    // center (here the fit viewport's visible bounds center) with zoom 1
    // and no rotation. The convenience surface functions derive the
    // logical view from the resolved viewport, so the composition is
    // surface = (P + L - L) * scale + offset = the no-camera path.
    const fit = resolveViewport2D(
      { logicalSize: { width: 160, height: 240 }, mode: 'fit' },
      { width: 320, height: 480 },
    )!;
    const identity = createCamera2D({
      center: {
        x: fit.visibleLogicalBounds.x + fit.visibleLogicalBounds.width / 2,
        y: fit.visibleLogicalBounds.y + fit.visibleLogicalBounds.height / 2,
      },
    });
    const point = { x: 12.5, y: -7.25 };
    const plain = {
      x: point.x * fit.scale + fit.offsetX,
      y: point.y * fit.scale + fit.offsetY,
    };
    const viaCamera = worldToSurface2D(point, fit, identity);
    approxPoint(viaCamera, plain);
  });

  it('computes the conservative visible world bounds', () => {
    const identity = createCamera2D();
    const bounds = getCameraVisibleBounds2D(identity, VIEW);
    approxPoint(bounds, { x: -80, y: -120 });
    approx(bounds.width, 160);
    approx(bounds.height, 240);

    const zoomed = createCamera2D({ center: { x: 100, y: 50 }, zoom: 2 });
    const zoomedBounds = getCameraVisibleBounds2D(zoomed, VIEW);
    approxPoint(zoomedBounds, { x: 60, y: -10 });
    approx(zoomedBounds.width, 80);
    approx(zoomedBounds.height, 120);

    const rotated = createCamera2D({ center: { x: 0, y: 0 }, rotationRadians: Math.PI / 2 });
    const rotatedBounds = getCameraVisibleBounds2D(rotated, VIEW);
    // A quarter turn swaps the half extents: 120 wide, 80 tall.
    approx(rotatedBounds.width, 240, 1e-6);
    approx(rotatedBounds.height, 160, 1e-6);
  });
});

describe('camera2d interpolation', () => {
  const previous: CameraCut2D = { camera: createCamera2D({ center: { x: 0, y: 0 } }), cutId: 1 };
  const current: CameraCut2D = {
    camera: createCamera2D({ center: { x: 100, y: 0 }, zoom: 2, rotationRadians: Math.PI }),
    cutId: 1,
  };

  it('interpolates center, zoom, and rotation by alpha', () => {
    const half = interpolateCamera2D(previous, current, 0.5);
    approx(half.center.x, 50);
    approx(half.center.y, 0);
    approx(half.zoom, 1.5);
    approx(half.rotationRadians, Math.PI / 2, 1e-6);
    const quarter = interpolateCamera2D(previous, current, 0.25);
    approx(quarter.center.x, 25);
    approx(quarter.rotationRadians, Math.PI / 4, 1e-6);
  });

  it('interpolates rotation across the shortest arc', () => {
    // Crossing zero: the short way from 0.1 to -0.1 passes through 0.
    const from = createCamera2D({ rotationRadians: 0.1 });
    const to = createCamera2D({ rotationRadians: -0.1 });
    const half = interpolateCamera2D({ camera: from, cutId: 1 }, { camera: to, cutId: 1 }, 0.5);
    approx(half.rotationRadians, 0, 1e-6);
    // Crossing the wrap: the short way from pi - 0.1 to -pi + 0.1 passes
    // through pi (0.2 rad), not through zero (6.08 rad).
    const wrapped = interpolateCamera2D(
      { camera: createCamera2D({ rotationRadians: Math.PI - 0.1 }), cutId: 1 },
      { camera: createCamera2D({ rotationRadians: -Math.PI + 0.1 }), cutId: 1 },
      0.5,
    );
    approx(wrapped.rotationRadians, Math.PI, 1e-6);
  });

  it('snaps on a cut id change', () => {
    const snapped = interpolateCamera2D(previous, { ...current, cutId: 2 }, 0.25);
    approx(snapped.center.x, 100);
    approx(snapped.zoom, 2);
    approx(snapped.rotationRadians, Math.PI, 1e-6);
  });

  it('snaps when there is no previous camera', () => {
    const snapped = interpolateCamera2D(undefined, current, 0.1);
    assert.deepEqual(snapped, current.camera);
  });
});
