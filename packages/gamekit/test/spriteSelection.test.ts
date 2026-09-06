import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { spriteSheet } from '../src/index';
import {
  applySpriteFrameSelection,
  selectSpriteFrameRect,
} from '../src/react/sprites/spriteSelection';
import type { LoadedImage, LoadedSpriteSheet } from '../src/assets/types';
import { sampleSpriteClipFrameName } from '../src/index';

function sheetSource(): LoadedSpriteSheet {
  const descriptor = spriteSheet(43, {
    frames: {
      'idle-0': { x: 0, y: 0, width: 32, height: 32 },
      'idle-1': { x: 32, y: 0, width: 32, height: 32 },
    },
    animations: {
      idle: { frames: ['idle-0', 'idle-1'], frameDurationMs: 100, mode: 'loop' },
    },
  });
  return {
    descriptor,
    frames: descriptor.frames,
    width: 64,
    height: 32,
    image: undefined as never,
  };
}

function imageSource(): LoadedImage {
  return {
    descriptor: { kind: 'image', source: 1 },
    width: 64,
    height: 64,
    image: undefined as never,
  };
}

/** A headless stand-in for the Skia rect buffer entry. */
function fakeRect() {
  const calls: Array<readonly [number, number, number, number]> = [];
  return {
    calls,
    setXYWH: (x: number, y: number, width: number, height: number): void => {
      calls.push([x, y, width, height]);
    },
  };
}

describe('GS-ANIMATION-01 shared sprite selection', () => {
  it('an absent selection presents nothing without throwing', () => {
    assert.equal(selectSpriteFrameRect(sheetSource(), {}), undefined);
    const rect = fakeRect();
    applySpriteFrameSelection(rect, sheetSource(), {});
    assert.deepEqual(rect.calls, [[0, 0, 0, 0]]);
  });

  it('an explicit frame resolves its rectangle', () => {
    const source = sheetSource();
    assert.deepEqual(selectSpriteFrameRect(source, { frame: 'idle-1' }), {
      x: 32,
      y: 0,
      width: 32,
      height: 32,
    });
    const rect = fakeRect();
    applySpriteFrameSelection(rect, source, { frame: 'idle-1' });
    assert.deepEqual(rect.calls, [[32, 0, 32, 32]]);
  });

  it('an unknown explicit frame fails clearly', () => {
    assert.throws(
      () => selectSpriteFrameRect(sheetSource(), { frame: 'nope' }),
      /does not belong to this sprite sheet/,
    );
  });

  it('clip plus elapsed matches the sampler path exactly', () => {
    const source = sheetSource();
    const idle = source.descriptor.animations.idle;
    assert.ok(idle !== undefined, 'the fixture clip exists');
    for (let ms = -250; ms <= 500; ms += 13) {
      const expected = sampleSpriteClipFrameName(idle, ms);
      const resolved = selectSpriteFrameRect(source, { clip: 'idle', elapsedMs: ms });
      assert.deepEqual(
        resolved,
        source.frames[expected],
        `clip selection at ${ms}ms matches the sampler`,
      );
    }
  });

  it('an unknown clip throws instead of presenting nothing', () => {
    assert.throws(
      () => selectSpriteFrameRect(sheetSource(), { clip: 'dash', elapsedMs: 0 }),
      /ASSET_UNKNOWN_CLIP/,
    );
    const rect = fakeRect();
    assert.throws(
      () => applySpriteFrameSelection(rect, sheetSource(), { clip: 'dash', elapsedMs: 0 }),
      /ASSET_UNKNOWN_CLIP/,
    );
    assert.equal(rect.calls.length, 0, 'no rect is published for an invalid clip');
  });

  it('a full image resolves its full extent regardless of selection', () => {
    const source = imageSource();
    assert.deepEqual(selectSpriteFrameRect(source, {}), { x: 0, y: 0, width: 64, height: 64 });
    assert.deepEqual(selectSpriteFrameRect(source, { clip: 'idle', elapsedMs: 50 }), {
      x: 0,
      y: 0,
      width: 64,
      height: 64,
    });
  });
});
