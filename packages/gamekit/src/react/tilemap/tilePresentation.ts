import type { TileMap2D, TileSet2D } from '../../tilemap/types';

/**
 * Tile presentation binding (T16-F3/F4).
 *
 * Pure module shared between the JS thread and UI-runtime worklets:
 *
 * - `buildFrameTable` runs ONCE on JS at bind time and produces a flat,
 *   worklet-safe numeric lookup (`frameFlat[id*4..id*4+3]`) — no `Map`,
 *   no objects, no per-frame lookups on the UI runtime.
 * - `buildTileWindowSnapshot` runs on JS whenever the visible cell window
 *   or source binding changes and produces a BOUNDED snapshot sized by the
 *   viewport capacity, never by map dimensions.
 * - `writeLayerVisibleBounds` / `fillTileSlots` are worklet-callable and
 *   allocation-free: camera interpolation inside the transferred window
 *   only reads scalars and pre-transferred arrays.
 *
 * Full map authority stays on the simulation side; the UI runtime never
 * sees `layer.data`, the chunk index, or the map value itself.
 */

/** Flat numeric frame lookup: frameFlat[tileId*4] = x, [+1]=y, [+2]=w, [+3]=h. */
export type TileFrameTable = readonly number[];

/**
 * Resolve every declared tile to sheet-frame rectangles ONCE at bind time.
 *
 * Throws a structured error when a referenced frame is missing from the
 * bound sheet OR when its size differs from the map cell — v1 requires
 * frame dimensions to equal cell dimensions (T16-F3).
 */
export function buildFrameTable(
  tileset: TileSet2D,
  frames: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>,
  cellWidth: number,
  cellHeight: number,
): TileFrameTable {
  const maxId = tileset.names.length;
  const flat: number[] = new Array((maxId + 1) * 4).fill(0);
  for (let id = 1; id <= maxId; id++) {
    const name = tileset.nameOfId[id]!;
    const def = tileset.tiles[name]!;
    const rect = frames[def.frame];
    if (rect === undefined) {
      throw new Error(
        `[rn-gamekit/tilemap] frame "${def.frame}" for tile "${name}" is missing from the bound sheet`,
      );
    }
    if (rect.width !== cellWidth || rect.height !== cellHeight) {
      throw new Error(
        `[rn-gamekit/tilemap] frame "${def.frame}" for tile "${name}" is ${rect.width}x${rect.height} but the map cell is ${cellWidth}x${cellHeight}; v1 requires frame dimensions to equal cell dimensions`,
      );
    }
    flat[id * 4] = rect.x;
    flat[id * 4 + 1] = rect.y;
    flat[id * 4 + 2] = rect.width;
    flat[id * 4 + 3] = rect.height;
  }
  return Object.freeze(flat);
}

/** Bounded visible-window snapshot transferred to the UI runtime. */
export interface TileWindowSnapshot {
  /** Window origin in cell coordinates. */
  readonly x0: number;
  readonly y0: number;
  /** Window extent in cells (ids.length === w*h). */
  readonly w: number;
  readonly h: number;
  /** Row-major tile ids for the window; 0 = empty. */
  readonly ids: readonly number[];
  /** Flat frame lookup shared by all windows of one binding. */
  readonly frameFlat: readonly number[];
}

export const EMPTY_TILE_WINDOW: TileWindowSnapshot = Object.freeze({
  x0: 0,
  y0: 0,
  w: 0,
  h: 0,
  ids: Object.freeze([]),
  frameFlat: Object.freeze([]),
});

/**
 * Build a bounded snapshot for the inclusive cell range [x0..x1]×[y0..y1].
 * The range is clamped to the layer; the result size depends ONLY on the
 * requested range (bounded by viewport capacity), never on map size.
 */
export function buildTileWindowSnapshot(
  map: TileMap2D,
  layerId: string,
  x0: number, y0: number, x1: number, y1: number,
  frameFlat: TileFrameTable,
): TileWindowSnapshot {
  const layer = map.layerById[layerId];
  if (layer === undefined) return EMPTY_TILE_WINDOW;
  const cx0 = Math.max(0, Math.min(x0, x1));
  const cy0 = Math.max(0, Math.min(y0, y1));
  const cx1 = Math.min(layer.width - 1, Math.max(x0, x1));
  const cy1 = Math.min(layer.height - 1, Math.max(y0, y1));
  if (cx0 > cx1 || cy0 > cy1) return EMPTY_TILE_WINDOW;
  const w = cx1 - cx0 + 1;
  const h = cy1 - cy0 + 1;
  const ids: number[] = new Array(w * h).fill(0);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const id = layer.data[cy * layer.width + cx]!;
      if (id !== 0) ids[(cy - cy0) * w + (cx - cx0)] = id;
    }
  }
  return Object.freeze({
    x0: cx0,
    y0: cy0,
    w,
    h,
    ids: Object.freeze(ids),
    frameFlat,
  });
}

/** Whether the snapshot fully covers the inclusive cell range. */
export function windowCovers(
  snap: TileWindowSnapshot,
  x0: number, y0: number, x1: number, y1: number,
): boolean {
  'worklet';
  if (snap.w === 0 || snap.h === 0) return false;
  return snap.x0 <= x0 && snap.y0 <= y0 && snap.x0 + snap.w - 1 >= x1 && snap.y0 + snap.h - 1 >= y1;
}

// Minimal structural mirrors of the shared refs, keeping this pure module
// free of Reanimated/RN imports while accepting real SharedValues.
interface SharedLike<T> {
  readonly value?: T;
}
export type SharedCameraRef = SharedLike<
  { camera?: { center: { x: number; y: number }; zoom: number; rotationRadians: number } } | undefined
>;
export type SharedViewportRef = SharedLike<
  { visibleLogicalBounds?: { x: number; y: number; width: number; height: number } } | undefined
>;

export interface LayerBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Write the conservative world-space bounds visible through the PRESENTED
 * camera into `out` (T16-F3, reworked per T16-RF2).
 *
 * - With a presented camera: the logical view rect is rotated/zoomed by the
 *   camera, so its axis-aligned world bounds are the center plus rotated
 *   half-extents; the GameLayer2D parallax model applies ONCE afterwards
 *   (effective layer center C′ = L + (C − L)·p; zoom and rotation apply
 *   fully at every factor). Padding is world units.
 * - WITHOUT a presented camera, GameWorld2D's viewport-only path applies:
 *   the bounds are `viewport.visibleLogicalBounds` expanded by the padding.
 *
 * Worklet-callable and allocation-free on the steady path: scalars only,
 * results written into the caller-owned `out` scratch object. Returns false
 * when no viewport bounds exist yet.
 */
export function writeLayerVisibleBounds(
  camera: SharedCameraRef | null,
  viewport: SharedViewportRef | null,
  parallaxX: number,
  parallaxY: number,
  paddingWorld: number,
): LayerBounds | null {
  'worklet';
  const view = viewport?.value?.visibleLogicalBounds;
  if (view === undefined) return null;
  const cam = camera?.value?.camera;
  if (cam === undefined) {
    // Viewport-only world: no zoom, no rotation, no parallax correction.
    return {
      minX: view.x - paddingWorld,
      minY: view.y - paddingWorld,
      maxX: view.x + view.width + paddingWorld,
      maxY: view.y + view.height + paddingWorld,
    };
  }
  const hx = view.width / (2 * cam.zoom);
  const hy = view.height / (2 * cam.zoom);
  const t = cam.rotationRadians;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const ex = Math.abs(hx * cos) + Math.abs(hy * sin) + paddingWorld;
  const ey = Math.abs(hx * sin) + Math.abs(hy * cos) + paddingWorld;
  // Parallax AFTER base bounds: shift the center contribution only.
  let centerX = cam.center.x;
  let centerY = cam.center.y;
  if (parallaxX !== 1 || parallaxY !== 1) {
    const logicalCx = view.x + view.width / 2;
    const logicalCy = view.y + view.height / 2;
    centerX = logicalCx + (centerX - logicalCx) * parallaxX;
    centerY = logicalCy + (centerY - logicalCy) * parallaxY;
  }
  return {
    minX: centerX - ex,
    minY: centerY - ey,
    maxX: centerX + ex,
    maxY: centerY + ey,
  };
}

/** Slot-buffer contract shared by the component and tests. */
export interface TileSlotBuffers {
  readonly rects: readonly (SlotRect | undefined)[];
  readonly xforms: readonly (SlotXform | undefined)[];
}
export interface SlotRect {
  setXYWH(x: number, y: number, w: number, h: number): void;
}
export interface SlotXform {
  set(scos: number, ssin: number, tx: number, ty: number): void;
}

export interface FillParams {
  readonly cw: number;
  readonly ch: number;
  readonly originX: number;
  readonly originY: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly capacity: number;
}

/**
 * Fill Atlas slot buffers from the transferred window for the currently
 * visible cell span (worklet-callable, T16-F3/F4).
 *
 * - Cell range derives from `bounds` (already camera+parallax+padding).
 * - Tiles place UNROTATED at their CELL TOP-LEFT: the RSXform translation
 *   is the cell's world top-left corner.
 * - Stale slots past the filled count are hidden atomically (zero-size).
 * - Returns the filled slot count on success; returns -1 when the window
 *   does not cover the visible span (caller should request a new window)
 *   and -2 when the visible span exceeds the fixed capacity (caller must
 *   hide the whole layer and never claim partial success) — T16-SF2.
 */
export function fillTileSlots(
  snap: TileWindowSnapshot,
  bounds: LayerBounds,
  rects: readonly (SlotRect | undefined)[],
  xforms: readonly (SlotXform | undefined)[],
  params: FillParams,
): number {
  'worklet';
  const { cw, ch, originX, originY, layerWidth, layerHeight, capacity } = params;
  let cx0 = Math.floor((bounds.minX - originX) / cw);
  let cy0 = Math.floor((bounds.minY - originY) / ch);
  let cx1 = Math.floor((bounds.maxX - originX) / cw);
  let cy1 = Math.floor((bounds.maxY - originY) / ch);
  cx0 = Math.max(0, cx0);
  cy0 = Math.max(0, cy0);
  cx1 = Math.min(layerWidth - 1, cx1);
  cy1 = Math.min(layerHeight - 1, cy1);
  if (cx0 > cx1 || cy0 > cy1) {
    hideRange(rects, 0, capacity);
    return 0;
  }
  // Preflight the span against capacity so a rotated AABB never produces a
  // partial visible region (T16-SF2). Every cell in the span could be
  // occupied, so compare the worst-case span size to the fixed buffer.
  const spanCells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
  if (spanCells > capacity) {
    hideRange(rects, 0, capacity);
    return -2;
  }
  if (!windowCovers(snap, cx0, cy0, cx1, cy1)) {
    return -1;
  }
  let slot = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const id = snap.ids[(cy - snap.y0) * snap.w + (cx - snap.x0)]!;
      if (id === 0) continue;
      if (slot >= capacity) {
        hideRange(rects, 0, capacity);
        return -2;
      }
      const rectSlot = rects[slot];
      const xformSlot = xforms[slot];
      if (rectSlot === undefined || xformSlot === undefined) continue;
      rectSlot.setXYWH(
        snap.frameFlat[id * 4]!,
        snap.frameFlat[id * 4 + 1]!,
        snap.frameFlat[id * 4 + 2]!,
        snap.frameFlat[id * 4 + 3]!,
      );
      // Unrotated placement at the cell's world TOP-LEFT corner.
      xformSlot.set(1, 0, originX + cx * cw, originY + cy * ch);
      slot++;
    }
  }
  // Hide remaining stale slots atomically.
  for (let i = slot; i < capacity; i++) {
    rects[i]?.setXYWH(0, 0, 0, 0);
  }
  return slot;
}

function hideRange(rects: readonly (SlotRect | undefined)[], from: number, to: number): void {
  'worklet';
  for (let i = from; i < to; i++) {
    rects[i]?.setXYWH(0, 0, 0, 0);
  }
}
