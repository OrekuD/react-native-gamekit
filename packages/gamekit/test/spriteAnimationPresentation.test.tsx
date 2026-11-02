import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { spriteSheet, sampleSpriteClipFrameName } from '../src/index';
import type { LoadedImage, LoadedSpriteSheet } from '../src/assets/types';
import type { Sprite as SpriteComponent } from '../src/react/sprites/Sprite';
import type { GameSprite as GameSpriteComponent } from '../src/react/sprites/GameSprite';
import { selectSpriteFrameRect } from '../src/react/sprites/spriteSelection';

type Shared<T> = { value: T };
type Rect = readonly [number, number, number, number];
type HostProps = Record<string, unknown> & { readonly children?: ReactElement };
const rectCallbacks: Array<() => Rect | undefined> = [];
const groupProps: HostProps[] = [];

// Execute the actual mounted callbacks against current shared inputs. This
// models values changing without React rerenders, not native mapper ordering.
mock.module('@shopify/react-native-skia', {
  namedExports: {
    Atlas: () => null,
    Group: (props: HostProps) => {
      groupProps.push(props);
      return props.children;
    },
    useRectBuffer: (_capacity: number, modifier: (rect: {
      setXYWH(x: number, y: number, width: number, height: number): void;
    }) => void) => {
      rectCallbacks.push(() => {
        let result: Rect | undefined;
        modifier({ setXYWH: (x, y, width, height) => { result = [x, y, width, height]; } });
        return result;
      });
      return { value: [] };
    },
    useRSXformBuffer: () => ({ value: [] }),
  },
});
mock.module('react-native-reanimated', {
  namedExports: {
    useDerivedValue: (compute: () => unknown) => ({ get value() { return compute(); } }),
  },
});

let Sprite: typeof SpriteComponent;
let GameSprite: typeof GameSpriteComponent;
async function load() {
  ({ Sprite } = await import('../src/react/sprites/Sprite'));
  ({ GameSprite } = await import('../src/react/sprites/GameSprite'));
}

function sheetSource(): LoadedSpriteSheet {
  const descriptor = spriteSheet(43, {
    frames: {
      small: { x: 0, y: 0, width: 16, height: 16 },
      large: { x: 16, y: 0, width: 32, height: 32 },
    },
    animations: {
      loop: { frames: ['small', 'large'], frameDurationMs: 100, mode: 'loop' },
      once: { frames: ['small', 'large'], frameDurationMs: 100, mode: 'once' },
    },
  });
  return { descriptor, frames: descriptor.frames, width: 48, height: 32, image: undefined as never };
}
function imageSource(): LoadedImage {
  return { descriptor: { kind: 'image', source: 1 }, width: 32, height: 32, image: undefined as never };
}
async function mount(element: ReactElement) {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => { renderer = create(element); });
  return async () => { await act(async () => { renderer?.unmount(); }); };
}
function currentRect() {
  return rectCallbacks.at(-1)?.();
}
function currentOpacity() {
  return (groupProps.at(-1)?.opacity as Shared<number>).value;
}

describe('mounted sprite animation selection', () => {
  it('rejects inherited frame names while preserving explicitly declared names', () => {
    const source = sheetSource();
    for (const frame of ['toString', 'constructor', '__proto__']) {
      assert.throws(() => selectSpriteFrameRect(source, { frame }), /does not belong/);
    }
    const rect = { x: 0, y: 0, width: 8, height: 8 };
    assert.equal(selectSpriteFrameRect({ ...source, frames: { toString: rect } }, { frame: 'toString' }), rect);
  });

  it('direct Sprite and GameSprite callbacks agree with headless loop and once sampling', async () => {
    await load();
    const source = sheetSource();
    const elapsedMs = { value: 0 };
    const clip = { value: 'loop' };
    let selected = { x: 0, y: 0, clip: 'loop', elapsedMs: 0 };
    const times = [-250, -1, 0, 99, 100, 199, 200, 400];
    for (const clipName of ['loop', 'once']) {
      clip.value = clipName;
      const unmountDirect = await mount(createElement(Sprite, { source, clip, elapsedMs } as never));
      const directRect = rectCallbacks.at(-1);
      const unmountGame = await mount(createElement(GameSprite, {
        source, scene: 'play', commit: { value: { scene: 'play', current: {} } },
        alpha: { value: 0 }, select: () => selected,
      } as never));
      const gameRect = rectCallbacks.at(-1);
      try {
        for (const time of times) {
          elapsedMs.value = time;
          selected = { x: 0, y: 0, clip: clipName, elapsedMs: time };
          const animation = source.descriptor.animations[clipName];
          assert.ok(animation);
          const frame = source.frames[sampleSpriteClipFrameName(animation, time)];
          assert.ok(frame);
          const expected = [frame.x, frame.y, frame.width, frame.height];
          assert.deepEqual(directRect?.(), expected, `Sprite ${clipName} at ${time}`);
          assert.deepEqual(gameRect?.(), expected, `GameSprite ${clipName} at ${time}`);
        }
      } finally {
        await unmountGame();
        await unmountDirect();
      }
    }
  });

  it('keeps unseeded and other-scene full images hidden, then shows a selected image', async () => {
    await load();
    const commit: Shared<{ scene: string; current: object | undefined }> = {
      value: { scene: 'menu', current: {} },
    };
    let calls = 0;
    let selectedVisible = true;
    const unmount = await mount(createElement(GameSprite, {
      source: imageSource(), scene: 'play', commit, alpha: { value: 0 },
      select: () => { calls += 1; return { x: 12, y: 20, visible: selectedVisible }; },
    } as never));
    try {
      assert.equal(currentOpacity(), 0, 'another scene must not flash the image at the origin');
      assert.equal(calls, 0);
      commit.value = { scene: 'play', current: undefined };
      assert.equal(currentOpacity(), 0, 'an unseeded commit has no presentation');
      assert.equal(calls, 0);
      commit.value = { scene: 'play', current: {} };
      assert.equal(currentOpacity(), 1);
      assert.ok(calls > 0);
      selectedVisible = false;
      assert.equal(currentOpacity(), 0);
      commit.value = { scene: 'menu', current: {} };
      assert.equal(currentOpacity(), 0);
    } finally { await unmount(); }
  });

  it('direct Sprite distinguishes absent selection, explicit frame priority and invalid clip', async () => {
    await load();
    const source = sheetSource();
    const frame: Shared<string | undefined> = { value: undefined };
    const clip = { value: 'missing' };
    const unmount = await mount(createElement(Sprite, { source, frame, clip } as never));
    try {
      assert.throws(currentRect, /ASSET_UNKNOWN_CLIP/);
      frame.value = 'large';
      assert.deepEqual(currentRect(), [16, 0, 32, 32], 'explicit frame overrides invalid clip');
      frame.value = 'toString';
      assert.throws(currentRect, /does not belong/);
    } finally { await unmount(); }
    const unmountAbsent = await mount(createElement(Sprite, { source }));
    try { assert.deepEqual(currentRect(), [0, 0, 0, 0]); }
    finally { await unmountAbsent(); }
  });

  it('GameSprite distinguishes absent selection, explicit frame priority and invalid clip', async () => {
    await load();
    let selected: { x: number; y: number; clip?: string; frame?: string } = { x: 0, y: 0 };
    const unmount = await mount(createElement(GameSprite, {
      source: sheetSource(), scene: 'play', commit: { value: { scene: 'play', current: {} } },
      alpha: { value: 0 }, select: () => selected,
    } as never));
    try {
      assert.deepEqual(currentRect(), [0, 0, 0, 0]);
      selected = { x: 0, y: 0, clip: 'missing' };
      assert.throws(currentRect, /ASSET_UNKNOWN_CLIP/);
      selected = { x: 0, y: 0, clip: 'missing', frame: 'large' };
      assert.deepEqual(currentRect(), [16, 0, 32, 32]);
      selected = { x: 0, y: 0, frame: 'toString' };
      assert.throws(currentRect, /does not belong/);
    } finally { await unmount(); }
  });
});
