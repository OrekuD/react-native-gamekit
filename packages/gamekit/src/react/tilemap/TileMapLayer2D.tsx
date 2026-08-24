import { useContext, useMemo, useCallback } from 'react';
import {
  Atlas,
  Group,
  useRectBuffer,
  useRSXformBuffer,
} from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { SkImage } from '@shopify/react-native-skia';

import { GameWorldContext, layerParallaxTransform2D } from '../sprites/GameWorld2D';
import type { CameraCut2D } from '../../camera2d/types';
import type { ResolvedViewport2D } from '../../viewport2d/types';
import type { TileMap2D } from '../../tilemap/types';
import {
  buildFrameTable,
  buildTileWindowSnapshot,
  writeLayerVisibleBounds,
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
  /**
   * Coherent parallax contract (T16-RF2): ONE factor drives BOTH the visual
   * correction applied to this layer's Atlas AND the culling bounds —
   * callers never wrap this component in an outer GameLayer2D to duplicate
   * the factor.
   */
  readonly parallax?: { readonly x: number; y: number };
  /**
   * Bounded zoom-out contract (T16-RF2): the slot buffer is sized for a
   * camera zoomed out to AT MOST `1 / minZoom`. Presented cameras zooming
   * below this bound are rejected — every slot hides and a one-shot RN-side
   * diagnostic fires — rather than silently returning a partially filled
   * region. Default 1 (no zoom-out headroom).
   */
  readonly minZoom?: number;
}

/**
 * Stable-topology Atlas tile layer (T16.4, reworked per T16-F3/F4/RF1/RF2).
 *
 * One React node per layer. The slot buffer is sized from the passed
 * surface bounds + minZoom + overscan + cell size — NOT from map
 * dimensions. The worklet never touches the map value, `layer.data`, or a
 * JS `Map`:
 *
 * - Frame rectangles are pre-resolved into a flat numeric table at bind
 *   time (validated: missing frames and cell/frame size mismatches throw
 *   structured bind errors).
 * - A bounded window snapshot (ids sized by slot capacity) is built on JS
 *   and transferred via a shared value ONLY when the visible cell span
 *   outgrows the current window; requests cross to React through
 *   `scheduleOnRN` (Reanimated 4 / react-native-worklets), and camera
 *   interpolation inside the window is allocation-free scalar math.
 * - Culling bounds derive from the presented camera (center/zoom/rotation)
 *   with the SAME parallax factor applied to the visual transform and the
 *   bounds; without a presented camera the viewport-only world path applies.
 * - Culling here can never affect simulation: collision queries read full
 *   layer data through the private chunk index regardless of visibility.
 */
export function TileMapLayer2D({
  map, layer, source, width, height, overscan = 1, parallax, minZoom = 1,
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
  if (!(minZoom > 0) || !Number.isFinite(minZoom)) {
    throw new Error(`[rn-gamekit/tilemap] minZoom must be a finite number > 0; got ${String(minZoom)}`);
  }

  const cw = map.cellSize.width;
  const ch = map.cellSize.height;

  // Resolve frames ONCE at bind time (structured errors for missing
  // frames and frame/cell size mismatches — T16-F3).
  const frameTable: TileFrameTable = useMemo(
    () => buildFrameTable(map.tileset, source.frames, cw, ch),
    [map, source, cw, ch],
  );

  // Slot capacity covers the widest visible span: zoomed out to 1/minZoom.
  const slotsX = Math.ceil(width / (cw * minZoom)) + overscan * 2 + 1;
  const slotsY = Math.ceil(height / (ch * minZoom)) + overscan * 2 + 1;
  const capacity = slotsX * slotsY;

  const rects = useRectBuffer(capacity, (rect) => {
    'worklet';
    rect.setXYWH(0, 0, 0, 0);
  });
  const xforms = useRSXformBuffer(capacity, (xform) => {
    'worklet';
    xform.set(1, 0, 0, 0);
  });

  // Bounded transferred window + one-shot request guard (T16-F4). The
  // scratch bounds object is written by the worklet every frame — one
  // stable allocation, never per-frame objects (T16-RF2).
  const windowSV = useSharedValue<TileWindowSnapshot>(EMPTY_TILE_WINDOW);
  const pendingSV = useSharedValue(false);
  const warnedCapacitySV = useSharedValue(false);
  const boundsScratch = useSharedValue({ minX: 0, minY: 0, maxX: 0, maxY: 0 });

  // Stable fill params: built once per binding, never per frame.
  const fillParams = useMemo(
    () => ({
      cw,
      ch,
      originX: map.origin.x,
      originY: map.origin.y,
      layerWidth: layerData.width,
      layerHeight: layerData.height,
      capacity,
    }),
    [cw, ch, map.origin.x, map.origin.y, layerData.width, layerData.height, capacity],
  );

  // JS handler (React-owned): builds the next bounded snapshot for the
  // requested range. Delivered via scheduleOnRN from the worklet (RF1).
  const requestWindow = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    // Pad by the overscan so small camera motions don't re-request.
    windowSV.value = buildTileWindowSnapshot(
      map, layerData.id,
      x0 - overscan, y0 - overscan, x1 + overscan, y1 + overscan,
      frameTable,
    );
    pendingSV.value = false;
  }, [map, layerData.id, overscan, frameTable]);

  // One-shot RN-side diagnostic when a presented camera zooms beyond the
  // declared capacity (T16-RF2): the layer hides instead of under-filling.
  const onBeyondCapacity = useCallback(() => {
    if (!warnedCapacitySV.value) {
      warnedCapacitySV.value = true;
      console.warn(
        '[rn-gamekit/tilemap] presented camera zoom is below minZoom; tile layer hides until the camera returns inside the declared capacity',
      );
    }
  }, [warnedCapacitySV]);

  const px = parallax?.x ?? 1;
  const py = parallax?.y ?? 1;
  const originX = map.origin.x;
  const originY = map.origin.y;
  const padWorld = overscan * Math.max(cw, ch);

  useDerivedValue(() => {
    'worklet';
    // Rejected camera state: zoomed out beyond the declared capacity.
    const camZoom = camera?.value?.camera?.zoom;
    if (camZoom !== undefined && camZoom < minZoom * (1 - 1e-3)) {
      for (let i = 0; i < capacity; i++) {
        rects.value[i]?.setXYWH(0, 0, 0, 0);
      }
      if (!pendingSV.value) {
        pendingSV.value = true;
        scheduleOnRN(onBeyondCapacity);
      }
      return -2;
    }
    const bounds = boundsScratch.value;
    if (!writeLayerVisibleBounds(camera as never, viewportSV as never, px, py, padWorld, bounds)) {
      return 0;
    }
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
    const filled = fillTileSlots(snap, bounds, rects.value, xforms.value, fillParams);
    if (filled < 0 && !pendingSV.value) {
      pendingSV.value = true;
      scheduleOnRN(requestWindow, cx0, cy0, cx1, cy1);
      return -1;
    }
    return filled;
  });

  // Coherent parallax: the visual correction uses the SAME factor as the
  // culling bounds above, so callers never wrap this component in an outer
  // GameLayer2D (T16-RF2). At factor 1 no transform applies.
  const visualTransform = useDerivedValue(() => {
    'worklet';
    if (px === 1 && py === 1) {
      return [];
    }
    return layerParallaxTransform2D(camera?.value, viewportSV?.value, px, py);
  });

  const atlas = <Atlas image={source.image} sprites={rects} transforms={xforms} />;
  if (px === 1 && py === 1) {
    return atlas;
  }
  return <Group transform={visualTransform as never}>{atlas}</Group>;
}
