/**
 * T12.6: visibility predicates and stable-order filtering.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createCamera2D,
  filterCameraVisible2D,
  getCameraVisibleBounds2D,
  intersectsCameraView2D,
} from '../src/camera2d/index.ts';

const VIEW = { x: -80, y: -120, width: 160, height: 240 };
const IDENTITY = createCamera2D();

describe('camera2d visibility', () => {
  it('classifies objects fully inside, outside, touching, and crossing', () => {
    assert.equal(
      intersectsCameraView2D({ kind: 'aabb', bounds: { x: -10, y: -10, width: 20, height: 20 } }, IDENTITY, VIEW),
      true,
      'fully inside',
    );
    assert.equal(
      intersectsCameraView2D({ kind: 'aabb', bounds: { x: 500, y: 500, width: 20, height: 20 } }, IDENTITY, VIEW),
      false,
      'fully outside',
    );
    assert.equal(
      intersectsCameraView2D({ kind: 'aabb', bounds: { x: -90, y: -10, width: 10, height: 10 } }, IDENTITY, VIEW),
      true,
      'touching the edge',
    );
    assert.equal(
      intersectsCameraView2D({ kind: 'aabb', bounds: { x: -200, y: -200, width: 400, height: 400 } }, IDENTITY, VIEW),
      true,
      'crossing through',
    );
  });

  it('tests points and circles against the view', () => {
    assert.equal(
      intersectsCameraView2D({ kind: 'point', point: { x: 0, y: 0 } }, IDENTITY, VIEW),
      true,
    );
    assert.equal(
      intersectsCameraView2D({ kind: 'point', point: { x: 1000, y: 0 } }, IDENTITY, VIEW),
      false,
    );
    assert.equal(
      intersectsCameraView2D({ kind: 'circle', circle: { x: -70, y: 0, radius: 20 } }, IDENTITY, VIEW),
      true,
    );
    assert.equal(
      intersectsCameraView2D({ kind: 'circle', circle: { x: -200, y: 0, radius: 10 } }, IDENTITY, VIEW),
      false,
    );
  });

  it('accepts optional world-space padding', () => {
    const far = { kind: 'aabb' as const, bounds: { x: -100, y: 0, width: 10, height: 10 } };
    assert.equal(intersectsCameraView2D(far, IDENTITY, VIEW), false);
    assert.equal(intersectsCameraView2D(far, IDENTITY, VIEW, 40), true);
  });

  it('never false-negatives under rotation', () => {
    const rotated = createCamera2D({ rotationRadians: Math.PI / 4 });
    // A point near the rotated corner must stay visible: the conservative
    // AABB contains the rotated view.
    const visible = getCameraVisibleBounds2D(rotated, VIEW);
    for (const probe of [
      { x: 0, y: 0 },
      { x: visible.x, y: visible.y },
      { x: visible.x + visible.width, y: visible.y + visible.height },
    ]) {
      assert.equal(
        intersectsCameraView2D({ kind: 'point', point: probe }, rotated, VIEW),
        true,
        `probe (${probe.x}, ${probe.y}) stays visible`,
      );
    }
  });

  it('handles negative world coordinates and distant worlds', () => {
    const camera = createCamera2D({ center: { x: -5000, y: -5000 }, zoom: 3 });
    assert.equal(
      intersectsCameraView2D({ kind: 'aabb', bounds: { x: -4990, y: -4990, width: 10, height: 10 } }, camera, VIEW),
      true,
    );
    assert.equal(
      intersectsCameraView2D({ kind: 'aabb', bounds: { x: 0, y: 0, width: 10, height: 10 } }, camera, VIEW),
      false,
    );
  });

  it('filters indexed records in stable order', () => {
    const items = [
      { id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } },
      { id: 'b', bounds: { x: 900, y: 900, width: 10, height: 10 } },
      { id: 'c', bounds: { x: -5, y: -5, width: 10, height: 10 } },
      { id: 'd', bounds: { x: 400, y: 0, width: 10, height: 10 } },
    ];
    const visible = filterCameraVisible2D(items, IDENTITY, VIEW);
    assert.deepEqual(
      visible.map((item) => item.id),
      ['a', 'c'],
      'stable order preserved, off-screen records dropped',
    );
  });

  it('keeps the returned filter result immutable', () => {
    const items = [{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } }];
    const visible = filterCameraVisible2D(items, IDENTITY, VIEW);
    assert.deepEqual(visible, items);
    assert.ok(Object.isFrozen(visible));
  });
});
