import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveViewport2D } from 'rn-gamekit';
import { surfacePoint } from './viewportTransform.ts';

const WORLD = { width: 320, height: 180 };

/**
 * T6 geometry pinning: the renderer maps logical coordinates through a parent
 * Group transform (translate then scale). These tests pin the expected
 * surface positions for fit/fill/extend-world at several surface sizes so a
 * transform-order mistake fails loudly.
 */
describe('T6: renderer viewport transform', () => {
  it('fit: content scales to fit and centers with letterbox offsets', () => {
    // Portrait phone: 440x956 surface, 320x180 world -> scale 1.375, vertical bars.
    const resolved = resolveViewport2D({ logicalSize: WORLD, mode: 'fit' }, { width: 440, height: 956 })!;
    assert.equal(resolved.scale, 1.375);
    assert.equal(resolved.offsetX, 0);
    assert.equal(resolved.offsetY, 354.25);
    assert.deepEqual(surfacePoint({ x: 0, y: 0 }, resolved), { x: 0, y: 354.25 });
    assert.deepEqual(surfacePoint({ x: 320, y: 180 }, resolved), { x: 440, y: 601.75 });
    // World edges stay inside the surface (letterboxed).
    assert.ok(surfacePoint({ x: 0, y: 0 }, resolved).y >= 0);
    assert.ok(surfacePoint({ x: 320, y: 180 }, resolved).y <= 956);
  });

  it('fit: landscape phone centers horizontally', () => {
    const resolved = resolveViewport2D({ logicalSize: WORLD, mode: 'fit' }, { width: 956, height: 440 })!;
    assert.equal(resolved.scale, 2.4444444444444446);
    assert.deepEqual(surfacePoint({ x: 160, y: 90 }, resolved), {
      x: 160 * resolved.scale + resolved.offsetX,
      y: 90 * resolved.scale + resolved.offsetY,
    });
    assert.ok(Math.abs(resolved.offsetX - (956 - 320 * resolved.scale) / 2) < 1e-9);
  });

  it('fill: content bleeds off the surface but maps linearly', () => {
    const resolved = resolveViewport2D({ logicalSize: WORLD, mode: 'fill' }, { width: 440, height: 956 })!;
    // Fill scale is the max ratio; offsets go negative where the world bleeds.
    assert.equal(resolved.scale, 5.311111111111111);
    assert.ok(resolved.offsetX < 0);
    const mapped = surfacePoint({ x: 160, y: 90 }, resolved);
    assert.equal(mapped.x, 160 * resolved.scale + resolved.offsetX);
    assert.equal(mapped.y, 90 * resolved.scale + resolved.offsetY);
  });

  it('extend-world: the world extends beyond the surface and centers it', () => {
    const resolved = resolveViewport2D({ logicalSize: WORLD, mode: 'extend-world' }, { width: 956, height: 440 })!;
    // The whole surface shows content: scale is the fit ratio and the world
    // origin maps through the centering offset.
    assert.equal(resolved.scale, 2.4444444444444446);
    assert.ok(Math.abs(resolved.offsetY) < 1e-9);
    assert.equal(resolved.offsetX, 86.88888888888886);
    const origin = surfacePoint({ x: 0, y: 0 }, resolved);
    assert.equal(origin.x, 86.88888888888886);
    assert.ok(Math.abs(origin.y) < 1e-9);
    const corner = surfacePoint({ x: 320, y: 180 }, resolved);
    assert.ok(Math.abs(corner.x - (320 * resolved.scale + resolved.offsetX)) < 1e-9);
    assert.ok(Math.abs(corner.y - 440) < 1e-9);
    // The world's visible region reaches the left surface edge.
    const leftEdge = resolved.visibleLogicalBounds.x;
    assert.ok(Math.abs(surfacePoint({ x: leftEdge, y: 0 }, resolved).x) < 1e-9);
  });

  it('the world origin maps through the letterbox offset in every mode', () => {
    for (const mode of ['fit', 'fill', 'extend-world'] as const) {
      const resolved = resolveViewport2D({ logicalSize: WORLD, mode }, { width: 390, height: 844 })!;
      const origin = surfacePoint({ x: 0, y: 0 }, resolved);
      assert.deepEqual(origin, { x: resolved.offsetX, y: resolved.offsetY });
    }
  });
});
