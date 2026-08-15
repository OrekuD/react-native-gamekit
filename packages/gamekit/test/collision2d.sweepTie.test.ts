/**
 * T11-TF1: equal-time sweep candidates keep the frozen first-evaluated
 * order.
 *
 * The frozen rule: at equal times the candidate evaluated first wins —
 * the X face before the Y face, faces before corners, corners in index
 * order. The allocation refactor must not change observable ties.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sweepCircleAabb2D } from '../src/collision2d/sweeps.ts';

describe('circle sweep equal-time precedence (T11-TF1)', () => {
  it('keeps the first-evaluated face candidate at a perfect corner tie', () => {
    // A radius-zero point circle moving diagonally from (-1, -1) by (2, 2)
    // hits the (0, 0) corner of the AABB at t = 0.5 on both the X face
    // and the Y face. The X face is evaluated first and must retain its
    // normal and contact point.
    const options = {
      circle: { x: -1, y: -1, radius: 0 },
      displacement: { x: 2, y: 2 },
      target: { x: 0, y: 0, width: 10, height: 10 },
    };
    const hit = sweepCircleAabb2D(options);
    assert.deepEqual(hit, {
      time: 0.5,
      normal: { x: -1, y: 0 },
      point: { x: 0, y: 0 },
    });
  });

  it('produces the identical result for identical inputs (repeatability)', () => {
    const options = {
      circle: { x: -1, y: -1, radius: 0 },
      displacement: { x: 2, y: 2 },
      target: { x: 0, y: 0, width: 10, height: 10 },
    };
    const first = sweepCircleAabb2D(options);
    const second = sweepCircleAabb2D(options);
    const third = sweepCircleAabb2D(options);
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
  });
});
