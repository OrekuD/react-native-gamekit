import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveSpriteFrameRect,
  type SpriteFrameRect,
} from '../src/react/sprites/spriteTransform';

/**
 * Static frame-resolution contract (T7.4/RF4/T8).
 *
 * The dynamic clip/elapsed mode passes no static frame; the resolution must
 * present nothing instead of throwing, and the anchor baseline must fall
 * back to the sheet's first frame so the correction math stays sane.
 */

function sheetWith(frames: Record<string, SpriteFrameRect>, animations: Record<string, { frames: readonly string[] }>): never {
  return {
    descriptor: {
      kind: 'sprite-sheet',
      animations,
    },
    frames,
  } as never;
}

describe('resolveSpriteFrameRect (RF4/T8 static baseline)', () => {
  it('resolves an explicit static frame', () => {
    const sheet = sheetWith(
      { 'run-0': { x: 0, y: 0, width: 32, height: 32 } },
      { run: { frames: ['run-0'] } },
    );
    assert.deepEqual(resolveSpriteFrameRect(sheet, 'run-0'), { x: 0, y: 0, width: 32, height: 32 });
  });

  it('an absent selection never throws: it falls back to the first frame for the anchor baseline', () => {
    const sheet = sheetWith(
      {
        'idle-0': { x: 0, y: 0, width: 16, height: 16 },
        'idle-1': { x: 16, y: 0, width: 16, height: 16 },
      },
      { idle: { frames: ['idle-0', 'idle-1'] } },
    );
    assert.deepEqual(resolveSpriteFrameRect(sheet, undefined), {
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });

  it('a sheet without animations still hides instead of throwing', () => {
    const sheet = sheetWith({ 'frame-0': { x: 0, y: 0, width: 8, height: 8 } }, {});
    assert.deepEqual(resolveSpriteFrameRect(sheet, undefined), { x: 0, y: 0, width: 0, height: 0 });
  });

  it('an explicit unknown frame still fails loudly in development', () => {
    const sheet = sheetWith({ 'run-0': { x: 0, y: 0, width: 32, height: 32 } }, {});
    assert.throws(
      () => resolveSpriteFrameRect(sheet, 'missing'),
      /does not belong to this sprite sheet/,
    );
  });
});
