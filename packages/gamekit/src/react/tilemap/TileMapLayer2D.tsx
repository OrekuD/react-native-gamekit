import { useContext, useMemo } from 'react';
import { Atlas } from '@shopify/react-native-skia';
import { useRectBuffer, useRSXformBuffer } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { SkImage } from '@shopify/react-native-skia';

import { GameWorldContext } from '../sprites/GameWorld2D';
import type { CameraCut2D } from '../../camera2d/types';
import type { ResolvedViewport2D } from '../../viewport2d/types';
import type {
  TileMap2D,
  TileSet2D,
} from '../../tilemap/types';

/**
 * Resolve tile ids to sheet-frame rectangles ONCE at bind time (T16.4).
 * Exported pure so tests can exercise the structured error directly.
 */
export function resolveTileFrames(
  tileset: TileSet2D,
  frames: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>,
): Map<number, { x: number; y: number; width: number; height: number }> {
  const cache = new Map<number, { x: number; y: number; width: number; height: number }>();
  for (let id = 1; id < tileset.names.length + 1; id++) {
    const name = tileset.nameOfId[id]!;
    const def = tileset.tiles[name]!;
    const rect = frames[def.frame];
    if (rect === undefined) {
      throw new Error(
        `[rn-gamekit/tilemap] frame "${def.frame}" for tile "${name}" is missing from the bound sheet`,
      );
    }
    cache.set(id, rect);
  }
  return cache;
}

export interface TileMapLayer2DProps {
  /** The normalized immutable map. */
  readonly map: TileMap2D;
  /** Which layer to draw. */
  readonly layer: string;
  /**
   * Decoded sheet plus resolved frame rectangles — resolve ONCE at bind
   * time via the asset store (T16.4).
   */
  readonly source: {
    readonly image: SkImage;
    readonly frames: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>;
  };
  /** Presentation-only parallax factor; 1 = locked to world. */
  readonly parallax?: { readonly x: number; readonly y: number };
  /** Extra visible tiles around the camera bounds. Default 1. */
  readonly overscan?: number;
}

/**
 * Stable-topology Atlas tile layer (T16.4).
 *
 * One React node per layer. The slot buffer is sized from the passed
 * surface bounds + overscan + cell size — NOT from map dimensions — and is
 * refilled in place as the presented camera moves. Rendering reads the same
 * immutable map data that collision queries use, but culling here can never
 * affect simulation: collision queries run against full layer data.
 */
/**
 * Resolve tile ids to sheet-frame rectangles ONCE at bind time (T16.4).
 * Exported pure so tests can exercise the structured error directly.
 */
export interface TileMapLayer2DProps {
  readonly map: TileMap2D;
  readonly layer: string;
  readonly source: {
    readonly image: SkImage;
    readonly frames: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>;
  };
  /** Surface size: px for screen space, world units for world space. */
  readonly width: number;
  readonly height: number;
  readonly overscan?: number;
  readonly parallax?: { readonly x: number; readonly y: number };
}

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

  // Resolve every referenced frame rect ONCE at bind time.
  const frameOf = useMemo(
    () => resolveTileFrames(map.tileset, source.frames),
    [map, source],
  );

  const cw = map.cellSize.width;
  const ch = map.cellSize.height;
  const pad = overscan * Math.max(cw, ch);
  const slotsX = Math.ceil((width + pad * 2) / cw) + 1;
  const slotsY = Math.ceil((height + pad * 2) / ch) + 1;
  const capacity = slotsX * slotsY;

  const rects = useRectBuffer(capacity, (rect) => {
    'worklet';
    rect.setXYWH(0, 0, 0, 0);
  });
  const xforms = useRSXformBuffer(capacity, (xform) => {
    'worklet';
    xform.set(1, 0, 0, 0);
  });

  const px = parallax?.x ?? 1;
  const py = parallax?.y ?? 1;

  useDerivedValue(() => {
    'worklet';
    // Camera-visible world bounds (with parallax applied presentation-only).
    const view = viewportSV?.value?.visibleLogicalBounds;
    if (view === undefined) return 0;
    let minX = view.x;
    let minY = view.y;
    if (px !== 1 || py !== 1) {
      // Parallax correction matches GameLayer2D: effective center C' = L + (C-L)*p.
      const logicalCx = view.x + view.width / 2;
      const logicalCy = view.y + view.height / 2;
      const camCut = camera?.value;
      if (camCut !== undefined) {
        minX += (camCut.camera.center.x - logicalCx) * (1 - px);
        minY += (camCut.camera.center.y - logicalCy) * (1 - py);
      }
    }
    const bounds = {
      x: minX - pad,
      y: minY - pad,
      width: view.width + pad * 2,
      height: view.height + pad * 2,
    };

    const originX = map.origin.x;
    const originY = map.origin.y;
    const c0x = Math.max(0, Math.floor((bounds.x - originX) / cw));
    const c0y = Math.max(0, Math.floor((bounds.y - originY) / ch));
    const c1x = Math.min(layerData.width - 1, Math.floor((bounds.x + bounds.width - originX) / cw));
    const c1y = Math.min(layerData.height - 1, Math.floor((bounds.y + bounds.height - originY) / ch));

    let slot = 0;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const id = layerData.data[cy * layerData.width + cx]!;
        if (id === 0) continue;
        const rectSlot = rects.value[slot];
        const xformSlot = xforms.value[slot];
        if (rectSlot === undefined || xformSlot === undefined) continue;
        const frame = frameOf.get(id);
        if (frame === undefined) continue;
        rectSlot.setXYWH(frame.x, frame.y, frame.width, frame.height);
        const wx = originX + cx * cw;
        const wy = originY + cy * ch;
        // Center anchor: pivot at half of the DRAWN extent (cw*ch).
        xformSlot.set(1, 0, wx - cw / 2, wy - ch / 2);
        slot++;
        if (slot >= capacity) break;
      }
      if (slot >= capacity) break;
    }
    // Hide remaining stale slots atomically.
    for (let i = slot; i < capacity; i++) {
      rects.value[i]?.setXYWH(0, 0, 0, 0);
    }
    return slot;
  });

  return <Atlas image={source.image} sprites={rects} transforms={xforms} />;
}

