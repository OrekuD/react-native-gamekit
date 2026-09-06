import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeSpriteRsxform,
  spriteGroupCorrection,
  type SpriteTransformInput,
} from '../src/react/sprites/spriteTransform';

const FRAME = { frameWidth: 32, frameHeight: 64, anchorX: 0, anchorY: 0 };

type Element =
  | { readonly translateX: number }
  | { readonly translateY: number }
  | { readonly scaleX: number }
  | { readonly scaleY: number }
  | { readonly rotate: number };

/**
 * Apply the FULL Skia composition in Skia order (GS-SPRITE-01): the Atlas
 * RSXform is the innermost transform, then the Group correction elements
 * apply last-element-first (the first list element is outermost).
 */
function applyComposed(
  input: SpriteTransformInput,
  px: number,
  py: number,
): { x: number; y: number } {
  const xform = computeSpriteRsxform(input);
  let x = xform.scos * px - xform.ssin * py + xform.tx;
  let y = xform.ssin * px + xform.scos * py + xform.ty;
  const elements = spriteGroupCorrection(input) as readonly Element[];
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]!;
    if ('translateX' in element) {
      x += element.translateX;
    } else if ('translateY' in element) {
      y += element.translateY;
    } else if ('scaleX' in element) {
      x *= element.scaleX;
    } else if ('scaleY' in element) {
      y *= element.scaleY;
    } else {
      const cos = Math.cos(element.rotate);
      const sin = Math.sin(element.rotate);
      const nx = x * cos - y * sin;
      y = x * sin + y * cos;
      x = nx;
    }
  }
  return { x, y };
}

function near(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: got ${actual}, want ${expected}`);
}

function anchorOf(input: SpriteTransformInput): { x: number; y: number } {
  return applyComposed(input, input.anchorX * input.frameWidth, input.anchorY * input.frameHeight);
}

describe('sprite transform math (T7.6)', () => {
  it('places the frame at the world position with no rotation or scale', () => {
    const input = { ...FRAME, x: 100, y: 50, rotation: 0, scale: 1, flipX: false, flipY: false };
    const corner = applyComposed(input, 0, 0);
    assert.equal(corner.x, 100);
    assert.equal(corner.y, 50);
    const far = applyComposed(input, 32, 64);
    assert.equal(far.x, 132, 'untransformed frame extends from the position');
    assert.equal(far.y, 114);
  });

  it('rotates around the top-left anchor at 90 degrees', () => {
    const input = { ...FRAME, x: 0, y: 0, rotation: Math.PI / 2, scale: 1, flipX: false, flipY: false };
    const point = applyComposed(input, 0, 32);
    near(point.x, -32, 'x');
    near(point.y, 0, 'y');
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
    const pivot = anchorOf(input);
    near(pivot.x, 200, 'pivot x');
    near(pivot.y, 150, 'pivot y');
    const bottomCentre = applyComposed(input, 16, 64);
    near(bottomCentre.x, 200 - 32, 'bottom-centre swings left by height');
    near(bottomCentre.y, 150, 'bottom-centre y');
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
    const bottomCentre = applyComposed(input, 16, 64);
    assert.equal(bottomCentre.x, 100);
    assert.equal(bottomCentre.y, 200, 'the anchor sits exactly on the world position');
    const topLeft = applyComposed(input, 0, 0);
    assert.equal(topLeft.y, 136, 'the frame extends upward from the anchor');
  });

  it('scale multiplies distances from the anchor (GS-SPRITE-01 review case)', () => {
    // The review's failing case: 20x20 frame, centred anchor, (100,100),
    // scale 2 — the composed anchor must stay (100,100), not (190,190).
    const input = {
      frameWidth: 20,
      frameHeight: 20,
      x: 100,
      y: 100,
      rotation: 0,
      scale: 2,
      flipX: false,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    };
    const pivot = anchorOf(input);
    near(pivot.x, 100, 'scaled anchor x stays on the world position');
    near(pivot.y, 100, 'scaled anchor y stays on the world position');
    const corner = applyComposed(input, 0, 0);
    near(corner.x, 80, 'top-left corner scales out from the anchor');
    near(corner.y, 80, 'top-left corner scales out from the anchor');
  });

  it('scale 0 collapses every point onto the anchor without NaN', () => {
    const input = {
      ...FRAME,
      x: 50,
      y: 60,
      rotation: 0.7,
      scale: 0,
      flipX: false,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    };
    for (const [px, py] of [[0, 0], [32, 64], [16, 32]] as const) {
      const point = applyComposed(input, px, py);
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 'finite output');
      near(point.x, 50, `collapsed x for (${px},${py})`);
      near(point.y, 60, `collapsed y for (${px},${py})`);
    }
  });

  it('half scale composes with rotation around a noncentral anchor', () => {
    const input = {
      ...FRAME,
      x: 200,
      y: 150,
      rotation: Math.PI / 2,
      scale: 0.5,
      flipX: false,
      flipY: false,
      anchorX: 0.25,
      anchorY: 0.75,
    };
    const pivot = anchorOf(input);
    near(pivot.x, 200, 'anchor invariant under rotation and half scale');
    near(pivot.y, 150, 'anchor invariant under rotation and half scale');
    // Local +x from the anchor (8,48) points along world +y after a 90-degree
    // turn, halved by the scale: (200, 150 + 4).
    const right = applyComposed(input, 16, 48);
    near(right.x, 200, 'rotated x');
    near(right.y, 154, 'rotated and halved y');
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
    const pivot = anchorOf(input);
    assert.equal(pivot.x, 10);
    assert.equal(pivot.y, 10);
    const rightEdge = applyComposed(input, 32, 32);
    near(rightEdge.x, 10 - 16, 'the right edge mirrors to the left of the anchor');
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
    const bottomEdge = applyComposed(input, 16, 64);
    near(bottomEdge.y, -32, `bottom edge y=${bottomEdge.y}`);
    const pivot = anchorOf(input);
    assert.equal(pivot.x, 0);
    assert.equal(pivot.y, 0);
  });

  it('flipX under 90-degree rotation mirrors about the rotated axis', () => {
    const input = {
      ...FRAME,
      x: 100,
      y: 100,
      rotation: Math.PI / 2,
      scale: 1,
      flipX: true,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    };
    const pivot = anchorOf(input);
    near(pivot.x, 100, 'anchor invariant under flip plus rotation');
    near(pivot.y, 100, 'anchor invariant under flip plus rotation');
    // Local +x from the anchor maps along world +y unflipped; the flip
    // negates it to the other side of the anchor line.
    const right = applyComposed(input, 32, 32);
    near(right.x, 100, 'mirrored x stays on the anchor line');
    near(right.y, 100 - 16, 'mirrored y flips to the other side');
  });

  it('the batch RSXform encodes uniform scale with pivot compensation (GS-SPRITE-02)', () => {
    const xform = computeSpriteRsxform({
      ...FRAME,
      x: 100,
      y: 50,
      rotation: 0,
      scale: 2,
      flipX: false,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    assert.equal(xform.scos, 2, 'unit rotation scaled by 2');
    assert.equal(xform.ssin, 0);
    assert.equal(xform.tx, 100 - 2 * 16, 'pivot compensation scales with the coefficients');
    assert.equal(xform.ty, 50 - 2 * 32, 'pivot compensation scales with the coefficients');
  });

  it('no flip needs no group correction', () => {
    const correction = spriteGroupCorrection({
      ...FRAME,
      x: 100,
      y: 50,
      rotation: 0.3,
      scale: 2,
      flipX: false,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    assert.deepEqual(correction, [], 'the RSXform alone carries the transform');
  });

  it('the flip correction is an anchor-fixing mirror', () => {
    const correction = spriteGroupCorrection({
      ...FRAME,
      x: 100,
      y: 50,
      rotation: 0,
      scale: 3,
      flipX: true,
      flipY: false,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    assert.deepEqual(correction, [
      { translateX: 100 },
      { translateY: 50 },
      { rotate: 0 },
      { scaleX: -1 },
      { scaleY: 1 },
      { rotate: -0 },
      { translateX: -100 },
      { translateY: -50 },
    ]);
  });
});
