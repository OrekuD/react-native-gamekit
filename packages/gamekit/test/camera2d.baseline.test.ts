/**
 * T12.0 no-camera baseline (Camera2D).
 *
 * Records the exact pre-camera transform pipeline that the camera feature
 * must preserve when `camera2D` is absent: the viewport transform
 * composition order, the coordinate conversion formulas, the fit letterbox
 * containment rule, and the pointer binding's conversion path. Camera work
 * may extend these paths but may not change them for callers that never
 * opt in.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InputController } from '../src/core/input/types';
import type { Point2D } from '../src/geometry/types';
import { PointerBinding } from '../src/react/pointerBinding.ts';
import {
  containsSurfacePoint,
  resolveViewport2D,
  surfaceToWorld,
  worldToSurface,
  type ResolvedViewport2D,
} from '../src/viewport2d/index.ts';

const TOLERANCE = 1e-9;

function approx(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `expected ${actual} ~ ${expected}`);
}

function approxPoint(actual: Point2D, expected: Point2D): void {
  approx(actual.x, expected.x);
  approx(actual.y, expected.y);
}

const FIT = resolveViewport2D(
  { logicalSize: { width: 160, height: 240 }, mode: 'fit' },
  { width: 320, height: 480 },
)!;
const FILL = resolveViewport2D(
  { logicalSize: { width: 160, height: 240 }, mode: 'fill' },
  { width: 320, height: 480 },
)!;
const EXTEND = resolveViewport2D(
  { logicalSize: { width: 160, height: 240 }, mode: 'extend-world' },
  { width: 480, height: 240 },
)!;

describe('camera no-camera baseline (T12.0)', () => {
  it('composes the viewport transform as T(offset) then S(scale)', () => {
    // `worldToSurface` is the pure encoding of the transform list
    // `[T(offsetX), T(offsetY), S(scale), S(scale)]` that `GameWorld2D`
    // feeds Skia: translate first, then uniform scale. Camera work must
    // compose the camera transform BEFORE this list, never after it.
    const point = { x: 7, y: -3 };
    const surface = worldToSurface(FIT, point);
    const viaList = {
      x: (point.x + 0) * 2,
      y: (point.y + 0) * 2,
    };
    approxPoint(surface, viaList);
    approx(surface.x, point.x * 2);
    approx(surface.y, point.y * 2);
  });

  it('converts world -> surface as p * scale + offset and back exactly', () => {
    const point = { x: -12.5, y: 37.25 };
    const surface = worldToSurface(FIT, point);
    approxPoint(surface, { x: -25, y: 74.5 });
    approxPoint(surfaceToWorld(FIT, surface), point);
    // A letterboxed fit viewport carries a real offset: scale 2, so
    // offsetX = (640 - 320) / 2 = 160.
    const letterboxed = resolveViewport2D(
      { logicalSize: { width: 160, height: 240 }, mode: 'fit' },
      { width: 640, height: 480 },
    )!;
    approxPoint(worldToSurface(letterboxed, { x: 0, y: 0 }), { x: 160, y: 0 });
  });

  it('rejects fit letterbox begins and accepts the full fill/extend surface', () => {
    const letterboxed = resolveViewport2D(
      { logicalSize: { width: 160, height: 240 }, mode: 'fit' },
      { width: 640, height: 480 },
    )!;
    assert.equal(containsSurfacePoint(letterboxed, { x: 0, y: 240 }), false);
    assert.equal(containsSurfacePoint(letterboxed, { x: 200, y: 240 }), true);
    assert.equal(containsSurfacePoint(FILL, { x: 0, y: 0 }), true);
    assert.equal(containsSurfacePoint(EXTEND, { x: 479, y: 0 }), true);
  });

  it('maps pointer positions through the viewport only (surface -> world)', () => {
    const events: Array<{ kind: string; point: Point2D }> = [];
    const input = {
      begin: (_action: string, _id: number, point: Point2D) => {
        events.push({ kind: 'begin', point });
      },
      move: (_action: string, _id: number, point: Point2D) => {
        events.push({ kind: 'move', point });
      },
      end: (_action: string, _id: number) => {
        events.push({ kind: 'end', point: { x: 0, y: 0 } });
      },
      cancel: () => undefined,
    } as unknown as InputController<string>;

    let current: ResolvedViewport2D | undefined = FIT;
    const binding = new PointerBinding('move', input, () => current, 1);

    assert.equal(binding.begin(7, { x: 10, y: 20 }), true);
    binding.move(7, { x: 30, y: 40 });
    binding.end(7);
    assert.equal(events.length, 3);
    approxPoint(events[0]!.point, surfaceToWorld(FIT, { x: 10, y: 20 }));
    approxPoint(events[1]!.point, surfaceToWorld(FIT, { x: 30, y: 40 }));

    // A letterbox begin is rejected BEFORE any conversion happens.
    current = resolveViewport2D(
      { logicalSize: { width: 160, height: 240 }, mode: 'fit' },
      { width: 640, height: 480 },
    );
    const before = events.length;
    assert.equal(binding.begin(8, { x: 0, y: 0 }), false);
    assert.equal(events.length, before, 'no begin event is synthesized');
  });

  it('keeps fit and fill conversion consistent with the containment rule', () => {
    // Every accepted begin point converts to the same world coordinate the
    // renderer would draw at that surface location.
    for (const viewport of [FIT, FILL, EXTEND]) {
      const surface = worldToSurface(viewport, { x: 10, y: -20 });
      approxPoint(surfaceToWorld(viewport, surface), { x: 10, y: -20 });
    }
  });
});
