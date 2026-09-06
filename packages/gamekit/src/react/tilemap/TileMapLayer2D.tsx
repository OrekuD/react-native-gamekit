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
  bindingGeneration,
  updateTileLayerUI,
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
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`[rn-gamekit/tilemap] width must be a finite number > 0; got ${String(width)}`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`[rn-gamekit/tilemap] height must be a finite number > 0; got ${String(height)}`);
  }
  if (!Number.isFinite(overscan) || overscan < 0 || !Number.isInteger(overscan)) {
    throw new Error(`[rn-gamekit/tilemap] overscan must be a finite integer >= 0; got ${String(overscan)}`);
  }
  const px = parallax?.x ?? 1;
  const py = parallax?.y ?? 1;
  if (!Number.isFinite(px)) {
    throw new Error(`[rn-gamekit/tilemap] parallax.x must be a finite number; got ${String(px)}`);
  }
  if (!Number.isFinite(py)) {
    throw new Error(`[rn-gamekit/tilemap] parallax.y must be a finite number; got ${String(py)}`);
  }

  const cw = map.cellSize.width;
  const ch = map.cellSize.height;
  const originX = map.origin.x;
  const originY = map.origin.y;
  // Pad world is scalar based on the larger cell dimension (T16-SF2
  // overscan contract). Capacity and bounds must share this exact scalar
  // so they cannot drift for non-square cells.
  const padWorld = overscan * Math.max(cw, ch);
  // px/py already validated above

  // Resolve frames ONCE at bind time (structured errors for missing
  // frames and frame/cell size mismatches — T16-F3).
  const frameTable: TileFrameTable = useMemo(
    () => buildFrameTable(map.tileset, source.frames, cw, ch),
    [map, source, cw, ch],
  );

  // Slot capacity covers the worst rotated AABB at minZoom (T16-SF2):
  // conservative extents approach the viewport diagonal at 45 degrees.
  // Must use the same padWorld as writeLayerVisibleBounds so non-square
  // cells (e.g. 8x64) do not under-size one axis.
  const diagonal = Math.hypot(width, height);
  const slotsX = Math.ceil((diagonal / minZoom + 2 * padWorld) / cw) + 1;
  const slotsY = Math.ceil((diagonal / minZoom + 2 * padWorld) / ch) + 1;
  const capacity = slotsX * slotsY;

  const rects = useRectBuffer(capacity, (rect) => {
    'worklet';
    rect.setXYWH(0, 0, 0, 0);
  });
  const xforms = useRSXformBuffer(capacity, (xform) => {
    'worklet';
    xform.set(1, 0, 0, 0);
  });

  // Bounded transferred window + guards (T16-F4, T16-SF1). The scratch
  // bounds object is written by the worklet every frame — one stable
  // allocation, never per-frame objects (T16-RF2).
  const windowSV = useSharedValue<TileWindowSnapshot>(EMPTY_TILE_WINDOW);
  // GS-TILE-01: one pending request per BINDING (not per component): the
  // stored generation lets a new binding request even when an old binding
  // left its mark behind.
  const pendingGenSV = useSharedValue(-1);
  const warnedCapacitySV = useSharedValue(false);
  const capacityWarnPendingSV = useSharedValue(false);

  // GS-TILE-01: binding identity from everything that defines what a
  // window shows — map, layer, frame source, cell size, and
  // capacity-affecting configuration. A fresh identity mints a fresh
  // generation; windows and requests stamped with older generations are
  // ignored, never displayed.
  // Binding-affecting inputs enumerated deliberately: equivalent values
  // must not remint the identity (no reload churn), and any omitted input
  // would reuse a stale window.
  const bindingKey = useMemo(
    () => ({}),
    [map, layer, source.frames, cw, ch, overscan, capacity, px, py],
  );
  const generation = bindingGeneration(bindingKey);

  // JS handler (React-owned): builds the next bounded snapshot for the
  // requested range. Delivered via scheduleOnRN from the worklet (RF1).
  // GS-TILE-01: the scheduled generation is checked before publishing, and
  // the published window is stamped — the update refuses windows whose
  // stamp differs from the live binding, so late deliveries converge by
  // re-requesting instead of displaying stale tiles.
  const requestWindow = useCallback(
    (gen: number, x0: number, y0: number, x1: number, y1: number) => {
      if (gen !== generation) {
        return;
      }
      // Pad by the overscan so small camera motions don't re-request.
      const snapshot = buildTileWindowSnapshot(
        map,
        layerData.id,
        x0 - overscan,
        y0 - overscan,
        x1 + overscan,
        y1 + overscan,
        frameTable,
      );
      windowSV.value = Object.freeze({ ...snapshot, gen });
      if (pendingGenSV.value === gen) {
        pendingGenSV.value = -1;
      }
    },
    [map, layerData.id, overscan, frameTable, generation, windowSV, pendingGenSV],
  );

  // One-shot RN-side diagnostic when a presented camera zooms beyond the
  // declared capacity (T16-RF2): the layer hides instead of under-filling.
  // Uses its own pending guard so the warning never blocks window requests
  // (T16-SF1).
  const onBeyondCapacity = useCallback(() => {
    capacityWarnPendingSV.value = false;
    if (!warnedCapacitySV.value) {
      warnedCapacitySV.value = true;
      console.warn(
        '[rn-gamekit/tilemap] presented camera zoom is below minZoom; tile layer hides until the camera returns inside the declared capacity',
      );
    }
  }, [warnedCapacitySV, capacityWarnPendingSV]);

  // originX/Y and padWorld already defined above for capacity sizing

  // GS-TILE-01: the update body lives in `updateTileLayerUI` with an
  // explicit scalar-only parameter list — the worklet closure provably
  // carries no map, layer, or frame-table objects (only layer dims and the
  // binding generation). requestWindow's closure stays on the JS side.
  useDerivedValue(() => {
    'worklet';
    return updateTileLayerUI({
      camera: camera as never,
      viewport: viewportSV as never,
      window: windowSV,
      pendingGen: pendingGenSV,
      warnedCapacity: warnedCapacitySV,
      capacityWarnPending: capacityWarnPendingSV,
      rects,
      xforms,
      requestWindow,
      scheduleOnRN: (fn) => scheduleOnRN(fn),
      onBeyondCapacity,
      generation,
      capacity,
      originX,
      originY,
      cw,
      ch,
      layerWidth: layerData.width,
      layerHeight: layerData.height,
      padWorld,
      px,
      py,
      minZoom,
    });
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
