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
 * Returns `undefined` until both surface dimensions are positive — a
 * zero-sized layout is normal before the first layout pass. Invalid authored
 * sizes throw a `RangeError` naming the invalid dimension. The result is
 * immutable plain data with no platform dependencies.
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
  if (!isUsableSurface(surfaceSize)) {
    return undefined;
  }

  if (config.mode !== 'fit' && config.mode !== 'fill' && config.mode !== 'extend-world') {
    throw new RangeError(`Unknown viewport mode: ${String(config.mode)}`);
  }

  const { width: surfaceWidth, height: surfaceHeight } = surfaceSize;
  const widthScale = surfaceWidth / logicalWidth;
  const heightScale = surfaceHeight / logicalHeight;

  let scale: number;
  let offsetX: number;
  let offsetY: number;
  let visibleLogicalBounds: Rect;
  let contentBounds: Rect;

  if (config.mode === 'fill') {
    scale = Math.max(widthScale, heightScale);
    offsetX = (surfaceWidth - logicalWidth * scale) / 2;
    offsetY = (surfaceHeight - logicalHeight * scale) / 2;
    visibleLogicalBounds = rect(
      -offsetX / scale,
      -offsetY / scale,
      surfaceWidth / scale,
      surfaceHeight / scale,
    );
    contentBounds = rect(0, 0, surfaceWidth, surfaceHeight);
  } else {
    // `fit` and `extend-world` share the fit (minimum uniform) scale.
    scale = Math.min(widthScale, heightScale);
    offsetX = (surfaceWidth - logicalWidth * scale) / 2;
    offsetY = (surfaceHeight - logicalHeight * scale) / 2;
    if (config.mode === 'extend-world') {
      const worldWidth = surfaceWidth / scale;
      const worldHeight = surfaceHeight / scale;
      visibleLogicalBounds = rect(
        (logicalWidth - worldWidth) / 2,
        (logicalHeight - worldHeight) / 2,
        worldWidth,
        worldHeight,
      );
      contentBounds = rect(0, 0, surfaceWidth, surfaceHeight);
    } else {
      visibleLogicalBounds = rect(0, 0, logicalWidth, logicalHeight);
      contentBounds = rect(offsetX, offsetY, logicalWidth * scale, logicalHeight * scale);
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

/** Convert a logical/world point into surface coordinates. */
export function worldToSurface(viewport: ResolvedViewport2D, point: Point2D): Point2D {
  return Object.freeze({
    x: point.x * viewport.scale + viewport.offsetX,
    y: point.y * viewport.scale + viewport.offsetY,
  });
}

/** Convert a surface point into logical/world coordinates. */
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
