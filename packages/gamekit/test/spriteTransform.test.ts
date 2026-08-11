import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeSpriteRsxform,
  spriteGroupCorrection,
  type SpriteTransformInput,
} from '../src/react/sprites/spriteTransform';

const FRAME = { frameWidth: 32, frameHeight: 64, anchorX: 0, anchorY: 0 };

/** Apply the full transform: group correction (scale/flip around the anchor)
 * first, then the RSXform (rotation around the anchor at the position). */
function apply(input: SpriteTransformInput, px: number, py: number): { x: number; y: number } {
  const xform = computeSpriteRsxform(input);
  const anchorX = input.anchorX * input.frameWidth;
  const anchorY = input.anchorY * input.frameHeight;
  const correction = spriteGroupCorrection(input);
  const scaleX = (correction.find((e) => 'scaleX' in e) as { scaleX: number }).scaleX;
  const scaleY = (correction.find((e) => 'scaleY' in e) as { scaleY: number }).scaleY;
  const sx = (px - anchorX) * scaleX + anchorX;
  const sy = (py - anchorY) * scaleY + anchorY;
  return {
    x: xform.scos * sx - xform.ssin * sy + xform.tx,
    y: xform.ssin * sx + xform.scos * sy + xform.ty,
  };
}

describe('sprite transform math (T7.6)', () => {
  it('places the frame at the world position with no rotation or scale', () => {
    const input = { ...FRAME, x: 100, y: 50, rotation: 0, scale: 1, flipX: false, flipY: false };
    const corner = apply(input, 0, 0);
    assert.equal(corner.x, 100);
    assert.equal(corner.y, 50);
    const far = apply(input, 32, 64);
    assert.equal(far.x, 132, 'untransformed frame extends from the position');
    assert.equal(far.y, 114);
  });

  it('rotates around the top-left anchor at 90 degrees', () => {
    const input = { ...FRAME, x: 0, y: 0, rotation: Math.PI / 2, scale: 1, flipX: false, flipY: false };
    const point = apply(input, 0, 32);
    assert.ok(Math.abs(point.x - -32) < 1e-9, `x=${point.x}`);
    assert.ok(Math.abs(point.y - 0) < 1e-9, `y=${point.y}`);
  });

  it('rotates around the centre anchor and preserves the pivot', () => {
    const input = {
      ...FRAME,
      x: 200,
      y: 150,
      rotation: Math.PI / 2,
      scale: 1,
      flipX: false,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    };
    const pivot = apply(input, 16, 32);
    assert.ok(Math.abs(pivot.x - 200) < 1e-9, `pivot x=${pivot.x}`);
    assert.ok(Math.abs(pivot.y - 150) < 1e-9, `pivot y=${pivot.y}`);
    const bottomCentre = apply(input, 16, 64);
    assert.ok(Math.abs(bottomCentre.x - (200 - 32)) < 1e-9, 'bottom-centre swings left by height');
    assert.ok(Math.abs(bottomCentre.y - 150) < 1e-9);
  });

  it('bottom-centre anchor places the frame above the position', () => {
    const input = {
      ...FRAME,
      x: 100,
      y: 200,
      rotation: 0,
      scale: 1,
      flipX: false,
      flipY: false,
      anchorX: 0.5,
      anchorY: 1,
    };
    const bottomCentre = apply(input, 16, 64);
    assert.equal(bottomCentre.x, 100);
    assert.equal(bottomCentre.y, 200, 'the anchor sits exactly on the world position');
    const topLeft = apply(input, 0, 0);
    assert.equal(topLeft.y, 136, 'the frame extends upward from the anchor');
  });

  it('scale multiplies distances from the anchor', () => {
    const input = {
      ...FRAME,
      x: 50,
      y: 50,
      rotation: 0,
      scale: 2,
      flipX: false,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    };
    const corner = apply(input, 32, 0); // right edge: 16 local units from the pivot
    assert.ok(Math.abs(corner.x - (50 + 32)) < 1e-9, `x=${corner.x}`);
    assert.ok(Math.abs(corner.y - (50 - 64)) < 1e-9, `y=${corner.y}`);
  });

  it('flipX mirrors around the anchor and preserves the pivot', () => {
    const input = {
      ...FRAME,
      x: 10,
      y: 10,
      rotation: 0,
      scale: 1,
      flipX: true,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    };
    const pivot = apply(input, 16, 32);
    assert.equal(pivot.x, 10);
    assert.equal(pivot.y, 10);
    const rightEdge = apply(input, 32, 32);
    assert.ok(Math.abs(rightEdge.x - (10 - 16)) < 1e-9, 'the right edge mirrors to the left of the anchor');
  });

  it('flipY mirrors vertically around the anchor', () => {
    const input = {
      ...FRAME,
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      flipX: false,
      flipY: true,
      anchorX: 0.5,
      anchorY: 0.5,
    };
    const bottomEdge = apply(input, 16, 64);
    assert.ok(Math.abs(bottomEdge.y - -32) < 1e-9, `bottom edge y=${bottomEdge.y}`);
    const pivot = apply(input, 16, 32);
    assert.equal(pivot.x, 0);
    assert.equal(pivot.y, 0);
  });

  it('the group correction exposes the scale/flip part around the anchor', () => {
    const correction = spriteGroupCorrection({
      ...FRAME,
      x: 0,
      y: 0,
      rotation: 0,
      scale: 3,
      flipX: true,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    assert.deepEqual(correction, [
      { translateX: 16 },
      { translateY: 32 },
      { scaleX: -3 },
      { scaleY: 3 },
      { translateX: -16 },
      { translateY: -32 },
    ]);
  });
});
