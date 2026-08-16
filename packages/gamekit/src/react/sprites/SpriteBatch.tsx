/**
 * `SpriteBatch` — the Atlas-backed shared-texture batch (T7.7).
 *
 * Draws many instances of one decoded sprite-sheet image through Skia's
 * `Atlas` with fixed-capacity, UI-owned buffers. The normal path owns all
 * derived-value plumbing: `select` maps the committed snapshot to the item
 * array and `write` is a UI-runtime setter that writes transforms in place —
 * no per-frame allocation, no per-frame React, no author-written
 * `useDerivedValue` side effects.
 *
 * Contract:
 * - `capacity` is fixed for the mounted batch; active count is explicit.
 * - Writes past capacity are rejected in development; inactive slots are
 *   hidden (zero-size) and never remount topology.
 * - Item order is the drawing order; the anchor is uniform per batch.
 * - The batch never disposes the image (the asset lease owns it).
 */
import { useMemo } from 'react';
import { Atlas, type SkImage } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { useRectBuffer, useRSXformBuffer } from '@shopify/react-native-skia';

import type { CameraCut2D } from '../../camera2d';
import type { Aabb2D } from '../../geometry/types';
import type { CommitFrame } from '../../core/session/types';
import { batchVisibleBounds2D, intersectsBounds2D } from './batchVisibility';
import type { ResolvedViewport2D } from '../../viewport2d/types';
export { batchVisibleBounds2D, intersectsBounds2D };
import type { SceneSnapshot } from '../../scene/types';
import type { SceneMap } from '../../definition/types';
import type { LoadedImage, LoadedSpriteSheet } from '../../assets/types';
import { computeSpriteRsxform } from './spriteTransform';
import { batchUpdatePolicy } from './spriteBatchPolicy';

/** The per-item write surface handed to the author's `write` mapper. */
export interface SpriteBatchWrite {
  /**
   * Write one batch slot. `frame` names the sheet frame; `x`/`y` are world
   * logical units; `rotation` is radians around the batch anchor; `scale`
   * is uniform; `visible: false` hides the slot (zero-size rect). Writes
   * past capacity fail in development.
   */
  readonly set: (
    index: number,
    frame: string,
    x: number,
    y: number,
    rotation: number,
    scale: number,
    visible?: boolean,
  ) => void;
}

export interface SpriteBatchProps<
  TScenes extends SceneMap,
  TSceneName extends Extract<keyof TScenes, string>,
  TItem,
> {
  /** The scene whose snapshot `select` reads. */
  readonly scene: TSceneName;
  /** The renderer's latest commit. */
  readonly commit: SharedValue<CommitFrame<TScenes>>;
  /** The renderer's presentation alpha. */
  readonly alpha: SharedValue<number>;
  /** One decoded sheet shared by every instance. */
  readonly source: LoadedImage | LoadedSpriteSheet;
  /** Fixed slot capacity for the mounted batch. */
  readonly capacity: number;
  /** Map the committed snapshot to the item array. */
  readonly select: (context: {
    readonly current: SceneSnapshot<TScenes[TSceneName]>;
    readonly alpha: number;
  }) => readonly TItem[];
  /** Write each item into its batch slot (UI runtime). */
  readonly write: (write: SpriteBatchWrite, item: TItem, index: number) => void;
  /** Uniform anchor in [0, 1] relative to the selected frame. */
  readonly anchor?: { readonly x: number; readonly y: number };
  /**
   * Optional camera culling (T12.6): items whose authored world bounds fall
   * outside the conservative visible region are hidden (zero-size slots)
   * instead of drawn. Slot identity and capacity are unchanged; the
   * simulation never knows culling happened. `bounds` maps an item to its
   * world AABB and runs as a worklet on the UI runtime. A bounds record
   * with non-finite values hides the item (fail-safe: invalid geometry is
   * never drawn); padding must be finite and nonnegative (T12-F5).
   */
  readonly cull?: {
    readonly camera: SharedValue<CameraCut2D | undefined>;
    readonly viewport: SharedValue<ResolvedViewport2D | undefined>;
    readonly bounds: (item: TItem) => Aabb2D;
    /** Optional world-space padding around the visible region. */
    readonly padding?: number;
  };
}

function frameRectOf(
  source: LoadedImage | LoadedSpriteSheet,
  frame: string,
): { x: number; y: number; width: number; height: number } | undefined {
  'worklet';
  if (source.descriptor.kind === 'image') {
    const image = source as LoadedImage;
    return { x: 0, y: 0, width: image.width, height: image.height };
  }
  return (source as LoadedSpriteSheet).frames[frame];
}

export function SpriteBatch<
  TScenes extends SceneMap,
  TSceneName extends Extract<keyof TScenes, string>,
  TItem,
>({
  scene,
  commit,
  alpha,
  source,
  capacity,
  select,
  write,
  anchor = { x: 0, y: 0 },
  cull,
}: SpriteBatchProps<TScenes, TSceneName, TItem>) {
  const image = source.image as SkImage;
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(
      `SpriteBatch capacity must be a positive integer, got ${String(capacity)}`,
    );
  }
  // T12-F5: culling padding is validated ONCE at the React boundary; the UI
  // worklet consumes a trusted finite nonnegative scalar.
  const cullPadding = cull?.padding ?? 0;
  if (!Number.isFinite(cullPadding) || cullPadding < 0) {
    throw new RangeError(
      `SpriteBatch cull.padding must be a finite nonnegative number, got ${String(cullPadding)}`,
    );
  }
  const rects = useRectBuffer(capacity, (rect) => {
    'worklet';
    rect.setXYWH(0, 0, 0, 0);
  });
  const xforms = useRSXformBuffer(capacity, (xform) => {
    'worklet';
    xform.set(1, 0, 0, 0);
  });

  // R7: one stable write coordinator for the batch lifetime; the per-update
  // worklet only calls it (no per-frame coordinator allocation).
  const writeApi: SpriteBatchWrite = useMemo(
    () => ({
      set: (index, frame, x, y, rotation, scale, visible = true) => {
        'worklet';
        if (index < 0 || index >= capacity) {
          throw new Error(
            `SpriteBatch write index ${index} is outside the capacity ${capacity}`,
          );
        }
        const rectSlot = rects.value[index];
        const xformSlot = xforms.value[index];
        if (rectSlot === undefined || xformSlot === undefined) {
          return;
        }
        if (!visible) {
          rectSlot.setXYWH(0, 0, 0, 0);
          return;
        }
        const rect = frameRectOf(source, frame);
        if (rect === undefined) {
          throw new Error(
            `frame ${JSON.stringify(frame)} does not belong to this sprite sheet`,
          );
        }
        rectSlot.setXYWH(rect.x, rect.y, rect.width, rect.height);
        const rsxform = computeSpriteRsxform({
          x,
          y,
          rotation,
          scale,
          flipX: false,
          flipY: false,
          anchorX: anchor.x,
          anchorY: anchor.y,
          frameWidth: rect.width,
          frameHeight: rect.height,
        });
        xformSlot.set(rsxform.scos, rsxform.ssin, rsxform.tx, rsxform.ty);
      },
    }),
    // The buffers, source, and anchor are stable for the mounted batch.
    [capacity, rects, xforms, source, anchor.x, anchor.y],
  );

  // The batch's own UI mapper: one derived value reads the committed
  // snapshot, runs the author's select + write per item, and reports the
  // active count. Buffers are mutated in place; no objects are allocated
  // per item per frame beyond the item array the select returns.
  const activeCount = useDerivedValue(() => {
    'worklet';
    const envelope = commit.value;
    if (envelope.scene !== scene) {
      // RF8: leaving the scene clears every previously active slot so no
      // stale sprite from the old scene stays visible.
      for (let index = 0; index < capacity; index += 1) {
        const slot = rects.value[index];
        if (slot !== undefined) {
          slot.setXYWH(0, 0, 0, 0);
        }
      }
      return 0;
    }
    const items = select({
      current: envelope.current as never as SceneSnapshot<TScenes[TSceneName]>,
      alpha: alpha.value,
    });
    const policy = batchUpdatePolicy(items.length, capacity, __DEV__);
    if (policy.overflow) {
      // RF8: production never crashes the UI runtime for ordinary data
      // growth: hide the overflowing items.
      for (let index = capacity; index < items.length; index += 1) {
        const slot = rects.value[index];
        if (slot !== undefined) {
          slot.setXYWH(0, 0, 0, 0);
        }
      }
    }
    const count = policy.activeCount;
    // T12.6 + T12-F5: culling hides off-screen slots in place, and
    // authored writes run ONLY through `policy.activeCount`. In production
    // an overflowing item (index >= capacity) is never written and never
    // indexes a buffer — the [count, capacity) hide loop below clears the
    // unused tail. The visible bounds are computed once per commit from the
    // PRESENTED camera; hidden slots are cleared directly (zero size)
    // without touching the author's write or reallocating buffers, so slot
    // identity is stable across camera moves.
    const visible =
      cull === undefined
        ? undefined
        : batchVisibleBounds2D(cull.camera.value, cull.viewport.value, cullPadding);
    for (let index = 0; index < count; index += 1) {
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      if (visible !== undefined && !intersectsBounds2D(cull!.bounds(item), visible)) {
        const slot = rects.value[index];
        if (slot !== undefined) {
          slot.setXYWH(0, 0, 0, 0);
        }
        continue;
      }
      write(writeApi, item, index);
    }
    // Hide every inactive slot.
    for (let index = count; index < capacity; index += 1) {
      const slot = rects.value[index];
      if (slot !== undefined) {
        slot.setXYWH(0, 0, 0, 0);
      }
    }
    return count;
  }, [commit, alpha, scene, select, write, writeApi, cull, cullPadding]);

  void activeCount;

  // The atlas renders the full buffer; the UI mapper keeps slots aligned.
  const sampling = useMemo(() => 'nearest' as const, []);
  return (
    <Atlas image={image} sprites={rects} transforms={xforms} sampling={sampling as never} />
  );
}
