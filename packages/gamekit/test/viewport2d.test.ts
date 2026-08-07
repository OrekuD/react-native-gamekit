import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  containsSurfacePoint,
  resolveViewport2D,
  surfaceToWorld,
  worldToSurface,
  type Viewport,
} from '../src/viewport2d/index.ts';

const TOLERANCE = 1e-6;

function approx(actual: number, expected: number, tolerance = TOLERANCE) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function approxPoint(actual: { readonly x: number; readonly y: number }, expected: {
  readonly x: number;
  readonly y: number;
}) {
  approx(actual.x, expected.x);
  approx(actual.y, expected.y);
}

function approxRect(
  actual: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  expected: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
) {
  approx(actual.x, expected.x);
  approx(actual.y, expected.y);
  approx(actual.width, expected.width);
  approx(actual.height, expected.height);
}

const authored: Viewport = { logicalSize: { width: 320, height: 180 }, mode: 'fit' };

interface SurfaceCase {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

// Phone, iPad, ultrawide, square, and narrow split-view surfaces.
const SURFACES: readonly SurfaceCase[] = [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'iPad portrait', width: 768, height: 1024 },
  { name: 'iPad landscape', width: 1024, height: 768 },
  { name: 'ultrawide', width: 2000, height: 200 },
  { name: 'square', width: 320, height: 320 },
  { name: 'narrow split-view', width: 160, height: 700 },
];

describe('resolveViewport2D fit mode', () => {
  const cases: Array<{
    readonly surface: SurfaceCase;
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly content: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  }> = [
    {
      surface: { name: 'phone portrait', width: 390, height: 844 },
      scale: 390 / 320,
      offsetX: 0,
      offsetY: (844 - 180 * (390 / 320)) / 2,
      content: { x: 0, y: (844 - 180 * (390 / 320)) / 2, width: 390, height: 180 * (390 / 320) },
    },
    {
      surface: { name: 'phone landscape', width: 844, height: 390 },
      scale: 390 / 180,
      offsetX: (844 - 320 * (390 / 180)) / 2,
      offsetY: 0,
      content: { x: (844 - 320 * (390 / 180)) / 2, y: 0, width: 320 * (390 / 180), height: 390 },
    },
    {
      surface: { name: 'iPad portrait', width: 768, height: 1024 },
      scale: 768 / 320,
      offsetX: 0,
      offsetY: (1024 - 180 * (768 / 320)) / 2,
      content: { x: 0, y: (1024 - 180 * (768 / 320)) / 2, width: 768, height: 180 * (768 / 320) },
    },
    {
      surface: { name: 'iPad landscape', width: 1024, height: 768 },
      scale: 1024 / 320,
      offsetX: 0,
      offsetY: (768 - 180 * (1024 / 320)) / 2,
      content: { x: 0, y: (768 - 180 * (1024 / 320)) / 2, width: 1024, height: 180 * (1024 / 320) },
    },
    {
      surface: { name: 'ultrawide', width: 2000, height: 200 },
      scale: 200 / 180,
      offsetX: (2000 - 320 * (200 / 180)) / 2,
      offsetY: 0,
      content: { x: (2000 - 320 * (200 / 180)) / 2, y: 0, width: 320 * (200 / 180), height: 200 },
    },
    {
      surface: { name: 'square', width: 320, height: 320 },
      scale: 1,
      offsetX: 0,
      offsetY: 70,
      content: { x: 0, y: 70, width: 320, height: 180 },
    },
    {
      surface: { name: 'narrow split-view', width: 160, height: 700 },
      scale: 0.5,
      offsetX: 0,
      offsetY: 305,
      content: { x: 0, y: 305, width: 160, height: 90 },
    },
  ];

  for (const c of cases) {
    it(`resolves ${c.surface.name}`, () => {
      const viewport = resolveViewport2D(authored, {
        width: c.surface.width,
        height: c.surface.height,
      });
      assert.ok(viewport, 'a positive surface resolves');
      approx(viewport.scale, c.scale);
      approx(viewport.offsetX, c.offsetX);
      approx(viewport.offsetY, c.offsetY);
      approxRect(viewport.contentBounds, c.content);
      // Fit always shows the entire authored world.
      approxRect(viewport.visibleLogicalBounds, { x: 0, y: 0, width: 320, height: 180 });
      approxRect(viewport.logicalBounds, { x: 0, y: 0, width: 320, height: 180 });
    });
  }
});

describe('resolveViewport2D fill mode', () => {
  const cases: Array<{
    readonly surface: SurfaceCase;
    readonly scale: number;
    readonly visible: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  }> = [
    {
      surface: { name: 'phone portrait', width: 390, height: 844 },
      scale: 844 / 180,
      visible: {
        x: ((844 / 180 - 390 / 320) * 320) / 2 / (844 / 180),
        y: 0,
        width: 390 / (844 / 180),
        height: 180,
      },
    },
  ];

  for (const c of cases) {
    it(`resolves ${c.surface.name}`, () => {
      const viewport = resolveViewport2D({ ...authored, mode: 'fill' }, {
        width: c.surface.width,
        height: c.surface.height,
      });
      assert.ok(viewport);
      approx(viewport.scale, c.scale);
      // Fill covers the full surface: content bounds are the surface.
      approxRect(viewport.contentBounds, { x: 0, y: 0, width: c.surface.width, height: c.surface.height });
      approxRect(viewport.visibleLogicalBounds, c.visible);
      // Everything on the surface is interactive in fill mode.
      assert.equal(containsSurfacePoint(viewport, { x: 0, y: 0 }), true);
      assert.equal(
        containsSurfacePoint(viewport, { x: c.surface.width - 0.01, y: c.surface.height - 0.01 }),
        true,
      );
    });
  }

  it('fills a phone landscape surface by cropping the vertical axis', () => {
    const viewport = resolveViewport2D({ ...authored, mode: 'fill' }, { width: 844, height: 390 });
    assert.ok(viewport);
    approx(viewport.scale, 844 / 320);
    approx(viewport.offsetX, 0);
    approx(viewport.offsetY, (390 - 180 * (844 / 320)) / 2);
    approxRect(viewport.contentBounds, { x: 0, y: 0, width: 844, height: 390 });
    approxRect(viewport.visibleLogicalBounds, {
      x: 0,
      y: (180 - 390 / (844 / 320)) / 2,
      width: 320,
      height: 390 / (844 / 320),
    });
  });

  it('fills an iPad portrait surface by cropping horizontally', () => {
    const viewport = resolveViewport2D({ ...authored, mode: 'fill' }, { width: 768, height: 1024 });
    assert.ok(viewport);
    approx(viewport.scale, 1024 / 180);
    approxRect(viewport.visibleLogicalBounds, {
      x: (320 - 768 / (1024 / 180)) / 2,
      y: 0,
      width: 768 / (1024 / 180),
      height: 180,
    });
  });
});

describe('resolveViewport2D extend-world mode', () => {
  it('expands vertically on a portrait surface', () => {
    const viewport = resolveViewport2D({ ...authored, mode: 'extend-world' }, { width: 390, height: 844 });
    assert.ok(viewport);
    const scale = 390 / 320;
    approx(viewport.scale, scale);
    const worldHeight = 844 / scale;
    approxRect(viewport.visibleLogicalBounds, {
      x: 0,
      y: (180 - worldHeight) / 2,
      width: 320,
      height: worldHeight,
    });
    approxRect(viewport.contentBounds, { x: 0, y: 0, width: 390, height: 844 });
  });

  it('expands horizontally on an ultrawide surface', () => {
    const viewport = resolveViewport2D({ ...authored, mode: 'extend-world' }, { width: 2000, height: 200 });
    assert.ok(viewport);
    const scale = 200 / 180;
    approx(viewport.scale, scale);
    const worldWidth = 2000 / scale;
    approxRect(viewport.visibleLogicalBounds, {
      x: (320 - worldWidth) / 2,
      y: 0,
      width: worldWidth,
      height: 180,
    });
    approxRect(viewport.contentBounds, { x: 0, y: 0, width: 2000, height: 200 });
  });

  it('uses fit scale and exposes the authored bounds on a matching surface', () => {
    const viewport = resolveViewport2D({ ...authored, mode: 'extend-world' }, { width: 320, height: 180 });
    assert.ok(viewport);
    approx(viewport.scale, 1);
    approxRect(viewport.visibleLogicalBounds, { x: 0, y: 0, width: 320, height: 180 });
  });
});

describe('Viewport2D coordinate conversion', () => {
  it('round-trips every surface in every mode', () => {
    for (const surface of SURFACES) {
      for (const mode of ['fit', 'fill', 'extend-world'] as const) {
        const viewport = resolveViewport2D({ ...authored, mode }, { width: surface.width, height: surface.height });
        assert.ok(viewport, `${surface.name} ${mode}`);
        for (const point of [
          { x: 0, y: 0 },
          { x: 320, y: 180 },
          { x: 160, y: 90 },
          { x: 40.25, y: -12.5 },
          { x: 500, y: 1000 },
        ]) {
          const surfacePoint = worldToSurface(viewport, point);
          const roundTrip = surfaceToWorld(viewport, surfacePoint);
          approxPoint(roundTrip, point);
        }
        for (const point of [
          { x: 0, y: 0 },
          { x: surface.width / 2, y: surface.height / 2 },
          { x: surface.width, y: surface.height },
        ]) {
          const worldPoint = surfaceToWorld(viewport, point);
          const roundTrip = worldToSurface(viewport, worldPoint);
          approxPoint(roundTrip, point);
        }
      }
    }
  });

  it('maps the authored origin and far corner through fit letterboxing', () => {
    const viewport = resolveViewport2D(authored, { width: 390, height: 844 })!;
    const origin = worldToSurface(viewport, { x: 0, y: 0 });
    approxPoint(origin, { x: 0, y: 312.3125 });
    const farCorner = worldToSurface(viewport, { x: 320, y: 180 });
    approxPoint(farCorner, { x: 390, y: 312.3125 + 219.375 });
  });

  it('keeps conversion mathematical outside content bounds', () => {
    const viewport = resolveViewport2D(authored, { width: 390, height: 844 })!;
    // A world point far below the authored world still maps through the transform.
    const below = worldToSurface(viewport, { x: 160, y: 500 });
    approxPoint(below, { x: 160 * (390 / 320), y: 312.3125 + 500 * (390 / 320) });
    // A surface point in the letterbox maps back to world coordinates outside the authored bounds.
    const letterboxPoint = surfaceToWorld(viewport, { x: 195, y: 100 });
    approxPoint(letterboxPoint, { x: 160, y: (100 - 312.3125) / (390 / 320) });
  });

  it('rejects letterbox begins but accepts the authored content in fit mode', () => {
    const viewport = resolveViewport2D(authored, { width: 390, height: 844 })!;
    // Letterbox bars at the top and bottom.
    assert.equal(containsSurfacePoint(viewport, { x: 195, y: 100 }), false);
    assert.equal(containsSurfacePoint(viewport, { x: 195, y: 312.3125 - 0.5 }), false);
    assert.equal(containsSurfacePoint(viewport, { x: 195, y: 700 }), false);
    // Content area is interactive.
    assert.equal(containsSurfacePoint(viewport, { x: 195, y: 312.3125 + 5 }), true);
    assert.equal(containsSurfacePoint(viewport, { x: 389.9, y: 312.3125 + 219.375 - 5 }), true);
  });

  it('treats the full surface as interactive in extend-world mode', () => {
    const viewport = resolveViewport2D({ ...authored, mode: 'extend-world' }, { width: 390, height: 844 })!;
    assert.equal(containsSurfacePoint(viewport, { x: 195, y: 100 }), true);
    assert.equal(containsSurfacePoint(viewport, { x: 195, y: 700 }), true);
  });
});

describe('resolveViewport2D validation', () => {
  it('returns undefined before the first layout pass with a zero-sized surface', () => {
    assert.equal(resolveViewport2D(authored, { width: 0, height: 0 }), undefined);
    assert.equal(resolveViewport2D(authored, { width: 390, height: 0 }), undefined);
    assert.equal(resolveViewport2D(authored, { width: 0, height: 844 }), undefined);
  });

  it('returns undefined for negative, NaN, or infinite surface dimensions', () => {
    assert.equal(resolveViewport2D(authored, { width: -390, height: 844 }), undefined);
    assert.equal(resolveViewport2D(authored, { width: 390, height: -844 }), undefined);
    assert.equal(resolveViewport2D(authored, { width: Number.NaN, height: 844 }), undefined);
    assert.equal(resolveViewport2D(authored, { width: 390, height: Number.NaN }), undefined);
    assert.equal(resolveViewport2D(authored, { width: Number.POSITIVE_INFINITY, height: 844 }), undefined);
    assert.equal(resolveViewport2D(authored, { width: 390, height: Number.POSITIVE_INFINITY }), undefined);
  });

  it('throws a RangeError naming the invalid logical dimension', () => {
    assert.throws(
      () => resolveViewport2D({ logicalSize: { width: 0, height: 180 }, mode: 'fit' }, { width: 390, height: 844 }),
      { name: 'RangeError' },
    );
    assert.throws(
      () => resolveViewport2D({ logicalSize: { width: -320, height: 180 }, mode: 'fit' }, { width: 390, height: 844 }),
      { name: 'RangeError' },
    );
    assert.throws(
      () => resolveViewport2D({ logicalSize: { width: Number.NaN, height: 180 }, mode: 'fit' }, { width: 390, height: 844 }),
      { name: 'RangeError' },
    );
    assert.throws(
      () => resolveViewport2D({ logicalSize: { width: 320, height: Number.POSITIVE_INFINITY }, mode: 'fit' }, { width: 390, height: 844 }),
      { name: 'RangeError' },
    );
  });

  it('never produces NaN transforms for valid configurations', () => {
    for (const surface of SURFACES) {
      for (const mode of ['fit', 'fill', 'extend-world'] as const) {
        const viewport = resolveViewport2D({ ...authored, mode }, { width: surface.width, height: surface.height });
        assert.ok(viewport);
        assert.ok(Number.isFinite(viewport.scale));
        assert.ok(Number.isFinite(viewport.offsetX));
        assert.ok(Number.isFinite(viewport.offsetY));
        assert.ok(Number.isFinite(viewport.contentBounds.x));
        assert.ok(Number.isFinite(viewport.contentBounds.width));
        assert.ok(Number.isFinite(viewport.visibleLogicalBounds.x));
        assert.ok(Number.isFinite(viewport.visibleLogicalBounds.width));
      }
    }
  });

  it('returns immutable resolved viewport values', () => {
    const viewport = resolveViewport2D(authored, { width: 390, height: 844 });
    assert.ok(viewport);
    assert.equal(Object.isFrozen(viewport), true);
    assert.equal(Object.isFrozen(viewport.contentBounds), true);
    assert.equal(Object.isFrozen(viewport.visibleLogicalBounds), true);
    assert.equal(Object.isFrozen(viewport.logicalBounds), true);
    assert.equal(Object.isFrozen(viewport.surfaceSize), true);
    assert.equal(Object.isFrozen(viewport.offsetX as number), true);
  });

});

describe('resolveViewport2D mode validation (feedback)', () => {
  it('throws a RangeError for an unknown viewport mode', () => {
    assert.throws(
      () =>
        resolveViewport2D(
          { logicalSize: { width: 320, height: 180 }, mode: 'zoom' as 'fit' },
          { width: 390, height: 844 },
        ),
      { name: 'RangeError' },
    );
  });
});
