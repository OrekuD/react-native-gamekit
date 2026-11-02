import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SharedValue } from 'react-native-reanimated';

import { spriteSheet } from '../src/assets/defineAssets';
import type { LoadedSpriteSheet } from '../src/assets/types';
import { resolveSpriteFrameRect } from '../src/react/sprites/spriteTransform';

const callbacks: Array<() => unknown> = [];
const rectangles: number[][] = [];
const transforms: number[][] = [];

mock.module('@shopify/react-native-skia', {
  namedExports: {
    Atlas: () => null,
    Group: ({ children }: { children?: React.ReactNode }) => children,
    useRectBuffer: (_capacity: number, modifier: (slot: unknown) => void) => {
      modifier({ setXYWH: (...values: number[]) => rectangles.push(values) });
      return { value: [] };
    },
    useRSXformBuffer: (_capacity: number, modifier: (slot: unknown) => void) => {
      modifier({ set: (...values: number[]) => transforms.push(values) });
      return { value: [] };
    },
  },
});

mock.module('react-native-reanimated', {
  namedExports: {
    useDerivedValue: (compute: () => unknown) => {
      callbacks.push(compute);
      return { value: compute() };
    },
  },
});

const descriptor = spriteSheet(123, {
  frames: {
    small: { x: 0, y: 0, width: 16, height: 16 },
    large: { x: 16, y: 0, width: 32, height: 24 },
  },
  animations: {
    grow: { frames: ['small', 'large'], frameDurationMs: 100, mode: 'loop' },
  },
});
const source: LoadedSpriteSheet = {
  descriptor,
  frames: descriptor.frames,
  width: 48,
  height: 24,
  image: undefined as never,
};

describe('retained sprite resolution boundaries', () => {
  it('rejects inherited names in the exported static resolver', () => {
    for (const frame of ['toString', 'constructor', '__proto__']) {
      assert.throws(() => resolveSpriteFrameRect(source, frame), /does not belong/);
    }
  });

  it('allows own frame entries whose names also occur on Object.prototype', () => {
    const frames = { ['__proto__']: descriptor.frames.small };
    assert.equal(resolveSpriteFrameRect({ ...source, frames }, '__proto__'), frames.__proto__);
  });

  it('never returns an inherited rectangle as the static fallback', () => {
    const frames = Object.create({ small: descriptor.frames.small }) as LoadedSpriteSheet['frames'];
    assert.deepEqual(resolveSpriteFrameRect({ ...source, frames }, undefined), {
      x: 0, y: 0, width: 0, height: 0,
    });
  });

  it('resolves clip dimensions for rect and xform, without reading selection for reflection', async () => {
    const { Sprite } = await import('../src/react/sprites/Sprite');
    callbacks.length = 0;
    rectangles.length = 0;
    transforms.length = 0;
    let elapsedReads = 0;
    const elapsedMs = {
      get value() {
        elapsedReads += 1;
        return 150;
      },
    } as SharedValue<number>;
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(createElement(Sprite, {
          source, clip: 'grow', elapsedMs, x: 100, y: 80,
          flipX: true, anchor: { x: 0.5, y: 0.5 },
        }));
      });
      assert.deepEqual(rectangles, [[16, 0, 32, 24]]);
      assert.deepEqual(transforms, [[1, 0, 84, 68]]);
      assert.equal(elapsedReads, 2, 'each buffer resolves once; reflection does not select a frame');
      callbacks[0]?.();
      assert.equal(elapsedReads, 2, 'reflection reevaluation never samples the clip');
    } finally {
      await act(async () => renderer?.unmount());
    }
  });

  it('hides an unpublished clip and renders it after a shared selection is published', async () => {
    const { Sprite } = await import('../src/react/sprites/Sprite');
    rectangles.length = 0;
    transforms.length = 0;
    const clip = { value: undefined } as SharedValue<string | undefined>;
    let renderer: ReactTestRenderer | undefined;
    const props = { source, clip, elapsedMs: 150, x: 100, y: 80, anchor: { x: 0.5, y: 0.5 } };
    try {
      await act(async () => {
        renderer = create(createElement(Sprite, props));
      });
      assert.deepEqual(rectangles.at(-1), [0, 0, 0, 0]);
      assert.deepEqual(transforms.at(-1), [1, 0, 100, 80]);
      clip.value = 'grow';
      // The mock reruns buffer modifiers on update, standing in for the
      // native shared-value reaction without requiring a device runtime.
      await act(async () => renderer?.update(createElement(Sprite, props)));
      assert.deepEqual(rectangles.at(-1), [16, 0, 32, 24]);
      assert.deepEqual(transforms.at(-1), [1, 0, 84, 68]);
    } finally {
      await act(async () => renderer?.unmount());
    }
  });
});
