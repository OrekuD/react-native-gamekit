/**
 * GS-SPRITE-02/04 mounted batch tests.
 *
 * The actual batch setter must write scaled RSXform coefficients with
 * pivot-compensated translation (scale was previously dropped), including
 * zero scale, changing frame dimensions, and nonzero rotation. Production
 * overflow must visit at most capacity slots, and fractional indices must
 * fail clearly.
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const recordedRects: Array<readonly [number, number, number, number]> = [];
const recordedXforms: Array<readonly [number, number, number, number]> = [];

// The batch reads the bundler-provided dev flag; the harness pins the
// production path (development overflow is covered at the policy level).
(globalThis as Record<string, unknown>).__DEV__ = false;

mock.module('@shopify/react-native-skia', {
  namedExports: {
    Atlas: () => null,
    useRectBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => ({
        setXYWH: (x: number, y: number, w: number, h: number) => {
          recordedRects.push([x, y, w, h]);
        },
      })),
    }),
    useRSXformBuffer: (capacity: number) => ({
      value: Array.from({ length: capacity }, () => ({
        set: (a: number, b: number, c: number, d: number) => {
          recordedXforms.push([a, b, c, d]);
        },
      })),
    }),
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
type BatchModule = typeof import('../src/react/sprites/SpriteBatch');
import type { SpriteBatchWrite } from '../src/react/sprites/SpriteBatch';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type SheetModule = typeof import('../src/index');

let SpriteBatch: BatchModule['SpriteBatch'];
let spriteSheet: SheetModule['spriteSheet'];

async function load(): Promise<void> {
  if (SpriteBatch !== undefined) {
    return;
  }
  SpriteBatch = (await import('../src/react/sprites/SpriteBatch')).SpriteBatch;
  spriteSheet = (await import('../src/index')).spriteSheet;
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

function near(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: got ${actual}, want ${expected}`);
}

describe('GS-SPRITE-02/04 mounted batch writes', () => {
  it('the setter writes scaled coefficients with compensated translation', async () => {
    await load();
    recordedRects.length = 0;
    recordedXforms.length = 0;
    const source = sheetSource();
    // small frame, centred anchor, scale 2, 90-degree rotation:
    // pivot (8,8); coefficients 2cos/2sin; translation p - s*R*pivot.
    const rotation = Math.PI / 2;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        createElement(SpriteBatch, {
          scene: 'play',
          commit: { value: { scene: 'play', current: {} } },
          alpha: { value: 0 },
          source,
          capacity: 4,
          select: () => [{ frame: 'small', x: 100, y: 50, rotation, scale: 2 }],
          write: (w: SpriteBatchWrite, item: never, index: number) => {
            const typed = item as unknown as {
              frame: string;
              x: number;
              y: number;
              rotation: number;
              scale: number;
            };
            w.set(index, typed.frame, typed.x, typed.y, typed.rotation, typed.scale);
          },
          anchor: { x: 0.5, y: 0.5 },
        } as never),
      );
    });
    assert.equal(recordedXforms.length, 1, 'one slot written');
    const [scos, ssin, tx, ty] = recordedXforms[0]!;
    near(scos, 2 * Math.cos(rotation), 'scaled cosine');
    near(ssin, 2 * Math.sin(rotation), 'scaled sine');
    near(tx, 100 - 2 * (8 * Math.cos(rotation) - 8 * Math.sin(rotation)), 'compensated tx');
    near(ty, 50 - 2 * (8 * Math.sin(rotation) + 8 * Math.cos(rotation)), 'compensated ty');
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('zero scale and changing frame dimensions stay anchored', async () => {
    await load();
    recordedXforms.length = 0;
    const source = sheetSource();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        createElement(SpriteBatch, {
          scene: 'play',
          commit: { value: { scene: 'play', current: {} } },
          alpha: { value: 0 },
          source,
          capacity: 4,
          select: () => [
            { frame: 'small', x: 100, y: 100, rotation: 0, scale: 0 },
            { frame: 'large', x: 100, y: 100, rotation: 0, scale: 1 },
          ],
          write: (w: SpriteBatchWrite, item: never, index: number) => {
            const typed = item as unknown as {
              frame: string;
              x: number;
              y: number;
              rotation: number;
              scale: number;
            };
            w.set(index, typed.frame, typed.x, typed.y, typed.rotation, typed.scale);
          },
          anchor: { x: 0.5, y: 0.5 },
        } as never),
      );
    });
    assert.equal(recordedXforms.length, 2, 'both slots written');
    // Zero scale collapses onto the anchor: coefficients 0, translation (x,y).
    assert.deepEqual(recordedXforms[0], [0, 0, 100, 100]);
    // The large frame (32x32, centred) compensates its own pivot, not small's.
    assert.deepEqual(recordedXforms[1], [1, 0, 100 - 16, 100 - 16]);
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('production overflow writes at most capacity slots and rejects fractions', async () => {
    await load();
    recordedXforms.length = 0;
    const source = sheetSource();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        createElement(SpriteBatch, {
          scene: 'play',
          commit: { value: { scene: 'play', current: {} } },
          alpha: { value: 0 },
          source,
          capacity: 2,
          select: () => [
            { frame: 'small', x: 0, y: 0, rotation: 0, scale: 1 },
            { frame: 'small', x: 10, y: 0, rotation: 0, scale: 1 },
            { frame: 'small', x: 20, y: 0, rotation: 0, scale: 1 },
          ],
          write: (w: SpriteBatchWrite, item: never, index: number) => {
            const typed = item as unknown as {
              frame: string;
              x: number;
              y: number;
              rotation: number;
              scale: number;
            };
            w.set(index, typed.frame, typed.x, typed.y, typed.rotation, typed.scale);
          },
        } as never),
      );
    });
    assert.equal(recordedXforms.length, 2, 'only capacity slots are written');
    await act(async () => {
      renderer?.unmount();
    });

    // A fractional index fails clearly instead of missing every slot. The
    // setter throws during render, so the synchronous act rethrows it.
    let thrown: unknown;
    try {
      act(() => {
        create(
          createElement(SpriteBatch, {
            scene: 'play',
            commit: { value: { scene: 'play', current: {} } },
            alpha: { value: 0 },
            source,
            capacity: 2,
            select: () => [{ frame: 'small', x: 0, y: 0, rotation: 0, scale: 1 }],
            write: (w: SpriteBatchWrite) => {
              w.set(0.5, 'small', 0, 0, 0, 1);
            },
          } as never),
        );
      });
    } catch (error) {
      thrown = error;
    }
    assert.match(String(thrown), /outside the capacity/);
  });
});
