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

import type { CommitFrame } from '../../core/session/types';
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
}: SpriteBatchProps<TScenes, TSceneName, TItem>) {
  const image = source.image as SkImage;
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(
      `SpriteBatch capacity must be a positive integer, got ${String(capacity)}`,
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
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item !== undefined) {
        write(writeApi, item, index);
      }
    }
    // Hide every inactive slot.
    for (let index = count; index < capacity; index += 1) {
      const slot = rects.value[index];
      if (slot !== undefined) {
        slot.setXYWH(0, 0, 0, 0);
      }
    }
    return count;
  }, [commit, alpha, scene, select, write, writeApi]);

  void activeCount;

  // The atlas renders the full buffer; the UI mapper keeps slots aligned.
  const sampling = useMemo(() => 'nearest' as const, []);
  return (
    <Atlas image={image} sprites={rects} transforms={xforms} sampling={sampling as never} />
  );
}
