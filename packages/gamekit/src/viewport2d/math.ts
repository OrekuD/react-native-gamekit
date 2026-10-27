import type { Point2D } from '../geometry/types';
import type { Rect, ResolvedViewport2D, SurfaceSize, Viewport } from './types';

function freezeRect(value: Rect): Rect {
  return Object.freeze(value);
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return freezeRect({ x, y, width, height });
}

function invalidLogicalSize(config: Viewport): string {
  const { width, height } = config.logicalSize;
  return `Viewport logical size must be finite and positive (got ${width} x ${height})`;
}

function isUsableSurface(size: SurfaceSize): boolean {
  return (
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/**
 * Resolve an authored viewport configuration against an actual surface size.
 *
 * Returns `undefined` until both surface dimensions are finite and positive —
 * a zero-sized layout is normal before the first layout pass. Invalid authored
 * sizes or modes throw a `RangeError` even before a usable surface exists.
 * The result is immutable plain data with no platform dependencies.
 *
 * Intended for layout-sized values: finite dimensions alone do not prevent
 * floating-point overflow or underflow at numeric extremes.
 */
export function resolveViewport2D(
  config: Viewport,
  surfaceSize: SurfaceSize,
): ResolvedViewport2D | undefined {
  const { width: logicalWidth, height: logicalHeight } = config.logicalSize;

  if (!Number.isFinite(logicalWidth) || !Number.isFinite(logicalHeight)) {
    throw new RangeError(invalidLogicalSize(config));
  }
  if (!(logicalWidth > 0) || !(logicalHeight > 0)) {
    throw new RangeError(invalidLogicalSize(config));
  }
  if (config.mode !== 'fit' && config.mode !== 'fill' && config.mode !== 'extend-world') {
    throw new RangeError(`Unknown viewport mode: ${String(config.mode)}`);
  }
  if (!isUsableSurface(surfaceSize)) {
    return undefined;
  }

  const { width: surfaceWidth, height: surfaceHeight } = surfaceSize;
  const widthScale = surfaceWidth / logicalWidth;
  const heightScale = surfaceHeight / logicalHeight;

  const scale = config.mode === 'fill'
    ? Math.max(widthScale, heightScale)
    : Math.min(widthScale, heightScale);
  const widthSetsScale = scale === widthScale;
  const heightSetsScale = scale === heightScale;
  // The axis setting the scale exactly meets the surface. Recomputing it
  // through multiplication can create a tiny letterbox and reject edge input.
  const contentWidth = widthSetsScale ? surfaceWidth : logicalWidth * scale;
  const contentHeight = heightSetsScale ? surfaceHeight : logicalHeight * scale;
  const offsetX = widthSetsScale ? 0 : (surfaceWidth - contentWidth) / 2;
  const offsetY = heightSetsScale ? 0 : (surfaceHeight - contentHeight) / 2;
  let visibleLogicalBounds: Rect;
  let contentBounds: Rect;

  if (config.mode === 'fill') {
    visibleLogicalBounds = rect(
      widthSetsScale ? 0 : -offsetX / scale,
      heightSetsScale ? 0 : -offsetY / scale,
      widthSetsScale ? logicalWidth : surfaceWidth / scale,
      heightSetsScale ? logicalHeight : surfaceHeight / scale,
    );
    contentBounds = rect(0, 0, surfaceWidth, surfaceHeight);
  } else {
    // `fit` and `extend-world` share the fit (minimum uniform) scale.
    if (config.mode === 'extend-world') {
      const worldWidth = widthSetsScale ? logicalWidth : surfaceWidth / scale;
      const worldHeight = heightSetsScale ? logicalHeight : surfaceHeight / scale;
      visibleLogicalBounds = rect(
        (logicalWidth - worldWidth) / 2,
        (logicalHeight - worldHeight) / 2,
        worldWidth,
        worldHeight,
      );
      contentBounds = rect(0, 0, surfaceWidth, surfaceHeight);
    } else {
      visibleLogicalBounds = rect(0, 0, logicalWidth, logicalHeight);
      contentBounds = rect(offsetX, offsetY, contentWidth, contentHeight);
    }
  }

  return Object.freeze({
    surfaceSize: Object.freeze({ width: surfaceWidth, height: surfaceHeight }),
    logicalBounds: rect(0, 0, logicalWidth, logicalHeight),
    visibleLogicalBounds,
    contentBounds,
    scale,
    offsetX,
    offsetY,
  });
}

/**
 * Convert a logical/world point into surface coordinates.
 *
 * Expects a resolver-produced viewport and finite point coordinates. Applies
 * unclamped floating-point arithmetic without revalidating those inputs.
 */
export function worldToSurface(viewport: ResolvedViewport2D, point: Point2D): Point2D {
  return Object.freeze({
    x: point.x * viewport.scale + viewport.offsetX,
    y: point.y * viewport.scale + viewport.offsetY,
  });
}

/**
 * Convert a surface point into logical/world coordinates.
 *
 * Expects a resolver-produced viewport and finite point coordinates. Applies
 * unclamped floating-point arithmetic without revalidating those inputs.
 */
export function surfaceToWorld(viewport: ResolvedViewport2D, point: Point2D): Point2D {
  return Object.freeze({
    x: (point.x - viewport.offsetX) / viewport.scale,
    y: (point.y - viewport.offsetY) / viewport.scale,
  });
}

/**
 * Decide whether a surface point lies inside the interactive content area.
 *
 * For `fit` this rejects letterbox space so a pointer cannot begin there. For
 * `fill` and `extend-world` the entire surface is interactive. Conversion
 * itself remains mathematical everywhere; this operation decides whether a
 * gesture may begin.
 */
export function containsSurfacePoint(viewport: ResolvedViewport2D, point: Point2D): boolean {
  const { x, y, width, height } = viewport.contentBounds;
  return point.x >= x && point.y >= y && point.x <= x + width && point.y <= y + height;
}
