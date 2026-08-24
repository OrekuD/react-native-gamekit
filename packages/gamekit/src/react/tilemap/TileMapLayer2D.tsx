import { useContext, useMemo, useCallback } from 'react';
import { Atlas, useRectBuffer, useRSXformBuffer } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, runOnJS, type SharedValue } from 'react-native-reanimated';
import type { SkImage } from '@shopify/react-native-skia';

import { GameWorldContext } from '../sprites/GameWorld2D';
import type { CameraCut2D } from '../../camera2d/types';
import type { ResolvedViewport2D } from '../../viewport2d/types';
import type { TileMap2D } from '../../tilemap/types';
import {
  buildFrameTable,
  buildTileWindowSnapshot,
  cameraLayerVisibleBounds,
  fillTileSlots,
  EMPTY_TILE_WINDOW,
  type TileFrameTable,
  type TileWindowSnapshot,
} from './tilePresentation';

export interface TileMapLayer2DProps {
  /** The normalized immutable map. */
  readonly map: TileMap2D;
  /** Which layer to draw. */
  readonly layer: string;
  /**
   * Decoded sheet plus resolved frame rectangles — resolve ONCE at bind
   * time via the asset store. Frame dimensions must equal the map cell
   * dimensions in v1.
   */
  readonly source: {
    readonly image: SkImage;
    readonly frames: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>;
  };
  /** Surface size: px for screen space, world units for world space. */
  readonly width: number;
  readonly height: number;
  /** Extra visible cells around the camera bounds. Default 1. */
  readonly overscan?: number;
  /** Presentation-only parallax factor; 1 = locked to world. */
  readonly parallax?: { readonly x: number; y: number };
}

/**
 * Stable-topology Atlas tile layer (T16.4, reworked per T16-F3/F4).
 *
 * One React node per layer. The slot buffer is sized from the passed
 * surface bounds + overscan + cell size — NOT from map dimensions. The
 * worklet never touches the map value, `layer.data`, or a JS `Map`:
 *
 * - Frame rectangles are pre-resolved into a flat numeric table at bind
 *   time (validated: missing frames and cell/frame size mismatches throw
 *   structured bind errors).
 * - A bounded window snapshot (ids sized by viewport capacity) is built on
 *   JS and transferred via a shared value ONLY when the visible cell span
 *   outgrows the current window; camera interpolation inside the window is
 *   allocation-free scalar math.
 * - Visible bounds derive from the PRESENTED camera (center/zoom/rotation)
 *   with the GameLayer2D parallax model applied once, afterwards.
 * - Culling here can never affect simulation: collision queries read full
 *   layer data through the private chunk index regardless of visibility.
 */
export function TileMapLayer2D({
  map, layer, source, width, height, overscan = 1, parallax,
}: TileMapLayer2DProps) {
  const world = useContext(GameWorldContext);
  const camera = (world?.camera ?? null) as
    | SharedValue<CameraCut2D | undefined>
    | null;
  const viewportSV = (world?.viewport ?? null) as
    | SharedValue<ResolvedViewport2D | undefined>
    | null;

  const layerData = map.layerById[layer];
  if (layerData === undefined) {
    throw new Error(`[rn-gamekit/tilemap] layer "${layer}" does not exist on this map`);
  }

  const cw = map.cellSize.width;
  const ch = map.cellSize.height;

  // Resolve frames ONCE at bind time (structured errors for missing
  // frames and frame/cell size mismatches — T16-F3).
  const frameTable: TileFrameTable = useMemo(
    () => buildFrameTable(map.tileset, source.frames, cw, ch),
    [map, source, cw, ch],
  );

  const slotsX = Math.ceil((width + overscan * cw * 2) / cw) + 1;
  const slotsY = Math.ceil((height + overscan * ch * 2) / ch) + 1;
  const capacity = slotsX * slotsY;

  const rects = useRectBuffer(capacity, (rect) => {
    'worklet';
    rect.setXYWH(0, 0, 0, 0);
  });
  const xforms = useRSXformBuffer(capacity, (xform) => {
    'worklet';
    xform.set(1, 0, 0, 0);
  });

  // Bounded transferred window + one-shot request guard (T16-F4).
  const windowSV = useSharedValue<TileWindowSnapshot>(EMPTY_TILE_WINDOW);
  const pendingSV = useSharedValue(false);

  // JS handler: builds the next bounded snapshot for the requested range.
  // Only runs when the visible span outgrows the current window.
  const requestWindow = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    // Pad by the overscan so small camera motions don't re-request.
    windowSV.value = buildTileWindowSnapshot(
      map, layerData.id,
      x0 - overscan, y0 - overscan, x1 + overscan, y1 + overscan,
      frameTable,
    );
    pendingSV.value = false;
  }, [map, layerData.id, overscan, frameTable]);

  const px = parallax?.x ?? 1;
  const py = parallax?.y ?? 1;
  const originX = map.origin.x;
  const originY = map.origin.y;
  const padWorld = overscan * Math.max(cw, ch);

  useDerivedValue(() => {
    'worklet';
    const bounds = cameraLayerVisibleBounds(camera as never, viewportSV as never, px, py, padWorld);
    if (bounds === undefined) return 0;
    const cx0 = Math.max(0, Math.floor((bounds.minX - originX) / cw));
    const cy0 = Math.max(0, Math.floor((bounds.minY - originY) / ch));
    const cx1 = Math.min(layerData.width - 1, Math.floor((bounds.maxX - originX) / cw));
    const cy1 = Math.min(layerData.height - 1, Math.floor((bounds.maxY - originY) / ch));
    if (cx0 > cx1 || cy0 > cy1) {
      // Off-map view: hide everything.
      for (let i = 0; i < capacity; i++) {
        rects.value[i]?.setXYWH(0, 0, 0, 0);
      }
      return 0;
    }
    // Fill from the transferred window when it covers the visible span.
    const snap = windowSV.value;
    const filled = fillTileSlots(snap, bounds, rects.value, xforms.value, {
      cw, ch, originX, originY, layerWidth: layerData.width, layerHeight: layerData.height, capacity,
    });
    if (filled < 0 && !pendingSV.value) {
      pendingSV.value = true;
      runOnJS(requestWindow)(cx0, cy0, cx1, cy1);
      return -1;
    }
    return filled;
  });

  return <Atlas image={source.image} sprites={rects} transforms={xforms} />;
}
