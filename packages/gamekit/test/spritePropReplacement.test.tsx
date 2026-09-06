/**
 * GS-SPRITE-01/03 mounted wiring tests.
 *
 * Static prop replacement must reach the Group correction (the old React
 * memo had no scale/flip dependencies and went stale), and clip-driven
 * frame changes must reach the transform buffers with current frame
 * dimensions (the old xform path only resolved explicit frames).
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

type HostProps = Record<string, unknown> & { readonly children?: unknown };

function host(tag: string) {
  const Component = ({ children, ...props }: HostProps) =>
    createElement(tag, props as never, children as never);
  Component.displayName = tag;
  return Component;
}

const recordedGroups: unknown[] = [];
const recordedXforms: Array<readonly [number, number, number, number]> = [];

mock.module('@shopify/react-native-skia', {
  namedExports: {
    Atlas: host('atlas'),
    Group: ({ children, transform }: HostProps) => {
      const value =
        transform !== null &&
        typeof transform === 'object' &&
        'value' in (transform as Record<string, unknown>)
          ? (transform as { value: unknown }).value
          : transform;
      recordedGroups.push(value);
      return createElement('group', null, children as never);
    },
    useRectBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => ({
        setXYWH: (_x: number, _y: number, _w: number, _h: number) => {},
      })),
    }),
    useRSXformBuffer: (capacity: number, modifier: (slot: unknown) => void) => {
      const slots = Array.from({ length: capacity }, () => ({
        set: (a: number, b: number, c: number, d: number) => {
          recordedXforms.push([a, b, c, d]);
        },
      }));
      for (const slot of slots) {
        modifier(slot);
      }
      return { value: slots };
    },
  },
});

mock.module('react-native-reanimated', {
  namedExports: {
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useFrameCallback: () => {},
  },
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type SpriteModule = typeof import('../src/react/sprites/Sprite');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type SheetModule = typeof import('../src/index');

let Sprite: SpriteModule['Sprite'];
let spriteSheet: SheetModule['spriteSheet'];
let selectSpriteFrameRect: (
  source: never,
  selection: { frame?: string; clip?: string; elapsedMs?: number },
) => { width: number; height: number } | undefined;

async function load(): Promise<void> {
  if (Sprite !== undefined) {
    return;
  }
  const spriteModule = await import('../src/react/sprites/Sprite');
  const index = await import('../src/index');
  const selection = await import('../src/react/sprites/spriteSelection');
  Sprite = spriteModule.Sprite;
  spriteSheet = index.spriteSheet;
  selectSpriteFrameRect = selection.selectSpriteFrameRect as never;
}

function sheetSource() {
  const descriptor = spriteSheet(43, {
    frames: {
      small: { x: 0, y: 0, width: 16, height: 16 },
      large: { x: 16, y: 0, width: 32, height: 32 },
    },
    animations: {
      grow: { frames: ['small', 'large'], frameDurationMs: 100, mode: 'loop' },
    },
  });
  return {
    descriptor,
    frames: descriptor.frames,
    width: 48,
    height: 32,
    image: undefined as never,
  };
}

describe('GS-SPRITE-01/03 mounted sprite wiring', () => {
  it('flip replacement reaches the Group correction', async () => {
    await load();
    recordedGroups.length = 0;
    const source = sheetSource();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        createElement(Sprite, {
          source,
          frame: 'small',
          x: 100,
          y: 100,
          anchor: { x: 0.5, y: 0.5 },
          flipX: false,
        } as never),
      );
    });
    assert.ok(recordedGroups.length >= 1, 'the Group correction renders');
    const before = recordedGroups.at(-1);

    await act(async () => {
      renderer?.update(
        createElement(Sprite, {
          source,
          frame: 'small',
          x: 100,
          y: 100,
          anchor: { x: 0.5, y: 0.5 },
          flipX: true,
        } as never),
      );
    });
    const after = recordedGroups.at(-1);
    assert.notDeepEqual(after, before, 'the flip change updates the Group correction');
    assert.deepEqual(after, [
      { translateX: 100 },
      { translateY: 100 },
      { rotate: 0 },
      { scaleX: -1 },
      { scaleY: 1 },
      { rotate: -0 },
      { translateX: -100 },
      { translateY: -100 },
    ]);
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('clip-driven frame changes move the transform with current dimensions', async () => {
    await load();
    recordedXforms.length = 0;
    const source = sheetSource();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        createElement(Sprite, {
          source,
          clip: 'grow',
          elapsedMs: 0,
          x: 100,
          y: 100,
          anchor: { x: 0.5, y: 0.5 },
        } as never),
      );
    });
    const small = selectSpriteFrameRect(source as never, { clip: 'grow', elapsedMs: 0 });
    assert.deepEqual(
      recordedXforms.at(-1),
      [1, 0, 100 - (small?.width ?? 0) / 2, 100 - (small?.height ?? 0) / 2],
      'the small frame centers on the position',
    );

    await act(async () => {
      renderer?.update(
        createElement(Sprite, {
          source,
          clip: 'grow',
          elapsedMs: 150,
          x: 100,
          y: 100,
          anchor: { x: 0.5, y: 0.5 },
        } as never),
      );
    });
    const large = selectSpriteFrameRect(source as never, { clip: 'grow', elapsedMs: 150 });
    assert.deepEqual(
      recordedXforms.at(-1),
      [1, 0, 100 - (large?.width ?? 0) / 2, 100 - (large?.height ?? 0) / 2],
      'the large frame recenters on the same anchor',
    );
    await act(async () => {
      renderer?.unmount();
    });
  });
});
