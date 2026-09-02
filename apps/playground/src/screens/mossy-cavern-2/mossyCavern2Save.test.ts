import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_MOSSY_CAVERN_2_PROFILE,
  validateMossyCavern2Profile,
} from './mossyCavern2Save.ts';

describe('Mossy Cavern 2 journal profile', () => {
  it('accepts and owns a durable plain-data profile projection', () => {
    const input = {
      ...DEFAULT_MOSSY_CAVERN_2_PROFILE,
      relicsRecovered: 7,
      checkpointsReached: 2,
      completedRuns: 1,
      bestTimeMs: 82_400,
    };
    const profile = validateMossyCavern2Profile(input);

    assert.deepEqual(profile, input);
    assert.notEqual(profile, input);
  });

  it('rejects corrupt negative, non-integral, and non-boolean save data', () => {
    assert.throws(() =>
      validateMossyCavern2Profile({
        ...DEFAULT_MOSSY_CAVERN_2_PROFILE,
        relicsRecovered: -1,
      }),
    );
    assert.throws(() =>
      validateMossyCavern2Profile({
        ...DEFAULT_MOSSY_CAVERN_2_PROFILE,
        checkpointsReached: 1.5,
      }),
    );
    assert.throws(() =>
      validateMossyCavern2Profile({
        ...DEFAULT_MOSSY_CAVERN_2_PROFILE,
        muted: 'false',
      }),
    );
  });
});
