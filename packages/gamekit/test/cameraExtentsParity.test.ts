/**
 * GS-CAMERA-03 — rotated-extent parity across the systems that compute it.
 *
 * The same conservative rotated half-extent arithmetic
 * (`|hx·cosθ| + |hy·sinθ|`) is implemented in camera transforms, bounds
 * clamping, sprite batch visibility, and particle culling with different
 * input shapes and validation policies. These tests pin NUMERIC agreement
 * on trusted scalars across all of them — and lock the no-camera path —
 * so any future consolidation is verifiable rather than hopeful.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cameraHalfExtents2D } from '../src/camera2d/bounds.ts';
import { getCameraVisibleBounds2D } from '../src/camera2d/transform.ts';
import type { Camera2D } from '../src/camera2d/types.ts';
import type { Aabb2D } from '../src/geometry/types.ts';
import { batchVisibleBounds2D } from '../src/react/sprites/batchVisibility.ts';
import {
  cameraVisibleWorldBounds,
  screenVisibleBounds,
} from '../src/react/particles/culling.ts';
import type { ResolvedViewport2D } from '../src/viewport2d/types.ts';

interface ExtentCase {
  readonly name: string;
  readonly view: { readonly width: number; readonly height: number };
  readonly center: { readonly x: number; readonly y: number };
  readonly zoom: number;
  readonly rotationRadians: number;
}

const CASES: ExtentCase[] = [
  {
    name: 'square view, unit zoom, no rotation',
    view: { width: 320, height: 320 },
    center: { x: 160, y: 160 },
    zoom: 1,
    rotationRadians: 0,
  },
  {
    name: 'non-square view, zoomed in',
    view: { width: 320, height: 480 },
    center: { x: 100, y: 200 },
    zoom: 2,
    rotationRadians: 0,
  },
  {
    name: 'quarter turn',
    view: { width: 320, height: 480 },
    center: { x: 0, y: 0 },
    zoom: 1,
    rotationRadians: Math.PI / 2,
  },
  {
    name: '45 degrees, zoomed out, negative center',
    view: { width: 400, height: 300 },
    center: { x: -120, y: -80 },
    zoom: 0.5,
    rotationRadians: Math.PI / 4,
  },
  {
    name: 'small rotation, fractional zoom',
    view: { width: 1920, height: 1080 },
    center: { x: 960, y: 540 },
    zoom: 1.5,
    rotationRadians: 0.1,
  },
];

function cameraFor(testCase: ExtentCase): Camera2D {
  return {
    center: { ...testCase.center },
    zoom: testCase.zoom,
    rotationRadians: testCase.rotationRadians,
  };
}

function viewportFor(testCase: ExtentCase): ResolvedViewport2D {
  const { width, height } = testCase.view;
  return {
    surfaceSize: { width, height },
    logicalBounds: { x: 0, y: 0, width, height },
    visibleLogicalBounds: { x: 0, y: 0, width, height },
    contentBounds: { x: 0, y: 0, width, height },
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

function closeTo(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

describe('GS-CAMERA-03 rotated-extent parity', () => {
  for (const testCase of CASES) {
    it(`agrees for ${testCase.name}`, () => {
      const camera = cameraFor(testCase);
      const logicalView: Aabb2D = {
        x: 0,
        y: 0,
        width: testCase.view.width,
        height: testCase.view.height,
      };
      const trusted = cameraHalfExtents2D(camera, logicalView);

      // Headless transform path: same center, extents derived from corners.
      const visible = getCameraVisibleBounds2D(camera, logicalView);
      closeTo((visible.width / 2 - trusted.x) / Math.max(1, trusted.x), 0, `${testCase.name} transform X`);
      closeTo((visible.height / 2 - trusted.y) / Math.max(1, trusted.y), 0, `${testCase.name} transform Y`);
      closeTo(visible.x + visible.width / 2, testCase.center.x, `${testCase.name} transform center X`);
      closeTo(visible.y + visible.height / 2, testCase.center.y, `${testCase.name} transform center Y`);

      // Batch visibility path (padding subtracted back out).
      const padding = 16;
      const batch = batchVisibleBounds2D({ camera, cutId: 1 }, viewportFor(testCase), padding);
      assert.ok(batch !== undefined);
      closeTo(batch.width / 2 - padding, trusted.x, `${testCase.name} batch extent X`);
      closeTo(batch.height / 2 - padding, trusted.y, `${testCase.name} batch extent Y`);
      closeTo(batch.x + batch.width / 2, testCase.center.x, `${testCase.name} batch center X`);

      // Particle culling path (pad subtracted back out).
      const culled = cameraVisibleWorldBounds(
        { value: { camera } },
        { value: viewportFor(testCase) },
        padding,
      );
      assert.ok(culled !== undefined);
      closeTo((culled.maxX - culled.minX) / 2 - padding, trusted.x, `${testCase.name} cull extent X`);
      closeTo((culled.maxY - culled.minY) / 2 - padding, trusted.y, `${testCase.name} cull extent Y`);
      closeTo((culled.minX + culled.maxX) / 2, testCase.center.x, `${testCase.name} cull center X`);
    });
  }

  it('the no-camera viewport path stays unchanged (T12)', () => {
    assert.equal(batchVisibleBounds2D(undefined, viewportFor(CASES[1]!), 16), undefined);
    assert.equal(
      cameraVisibleWorldBounds(null, { value: viewportFor(CASES[1]!) }, 16),
      undefined,
    );
    assert.equal(cameraVisibleWorldBounds({ value: {} }, null, 16), undefined);
    const screen = screenVisibleBounds(320, 480, 16);
    assert.deepEqual(screen, { minX: -16, minY: -16, maxX: 336, maxY: 496 });
  });
});
