import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveViewport2D } from 'rn-gamekit';
import { fitGameStage } from './fitGameStage.ts';

const logicalSize = Object.freeze({ width: 320, height: 480 });

describe('fitGameStage', () => {
  it('fills most of an iPhone portrait stage without creating hidden letterbox input', () => {
    const available = Object.freeze({ width: 416, height: 787 });
    const stage = fitGameStage(available, logicalSize);

    assert.equal(stage.width, 416);
    assert.equal(stage.height, 624);
    assert.ok(stage.height / available.height >= 0.79);

    const viewport = resolveViewport2D({ logicalSize, mode: 'fit' }, stage);
    assert.ok(viewport !== undefined);
    assert.ok(Math.abs(viewport.contentBounds.x) < Number.EPSILON);
    assert.ok(Math.abs(viewport.contentBounds.y) < Number.EPSILON);
    assert.ok(Math.abs(viewport.contentBounds.width - stage.width) < Number.EPSILON);
    assert.ok(Math.abs(viewport.contentBounds.height - stage.height) < Number.EPSILON);
  });

  it('becomes height-limited on iPad and landscape surfaces', () => {
    assert.deepEqual(fitGameStage({ width: 810, height: 1_074 }, logicalSize), {
      width: 716,
      height: 1_074,
    });
    assert.deepEqual(fitGameStage({ width: 900, height: 600 }, logicalSize), {
      width: 400,
      height: 600,
    });
  });

  it('returns a zero stage until both measured dimensions are usable', () => {
    assert.deepEqual(fitGameStage({ width: 0, height: 600 }, logicalSize), {
      width: 0,
      height: 0,
    });
  });
});
