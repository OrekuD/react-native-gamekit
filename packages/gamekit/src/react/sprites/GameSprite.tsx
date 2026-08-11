/**
 * `GameSprite` — the common GameKit sprite integration (T7.6).
 *
 * Accepts the renderer's commit/alpha shared values, narrows the snapshot
 * by `scene`, invokes one worklet `select` mapper, and drives the
 * underlying `Sprite` through coherent derived values. The selector's scene
 * typing is exact — a `scene="play"` selector receives only the play
 * snapshot without casts.
 */
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { CommitFrame } from '../../core/session/types';
import type { SceneSnapshot } from '../../scene/types';
import type { SceneMap } from '../../definition/types';
import type { LoadedImage, LoadedSpriteSheet } from '../../assets/types';
import { Sprite, type SpriteAnimatable, type SpriteAnimatableBoolean, type SpriteProps } from './Sprite';

/** Interpolation context for the select mapper. */
export interface GameSpriteSelectContext<
  TScenes extends SceneMap,
  TSceneName extends Extract<keyof TScenes, string>,
> {
  /** The previous commit's snapshot for the selected scene. */
  readonly previous: SceneSnapshot<TScenes[TSceneName]>;
  /** The current commit's snapshot for the selected scene. */
  readonly current: SceneSnapshot<TScenes[TSceneName]>;
  /** Presentation interpolation alpha in [0, 1]. */
  readonly alpha: number;
}

/** The discrete + interpolated presentation selection. */
export interface GameSpriteSelection {
  /** World position (interpolated when the selector requests it). */
  readonly x: number;
  readonly y: number;
  /** Rotation in radians around the anchor. */
  readonly rotation?: number;
  /** Uniform scale around the anchor. */
  readonly scale?: number;
  /** The clip to select from the sprite sheet (discrete). */
  readonly clip?: string;
  /** Elapsed time within the clip in milliseconds (discrete). */
  readonly elapsedMs?: number;
  /** The exact frame name (discrete; overrides clip + elapsedMs). */
  readonly frame?: string;
  /** Explicit flips (discrete). */
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  /** Opacity in [0, 1]. */
  readonly opacity?: number;
  /** Hide the sprite. */
  readonly visible?: boolean;
}

export interface GameSpriteProps<
  TScenes extends SceneMap,
  TSceneName extends Extract<keyof TScenes, string>,
> {
  /** The scene whose snapshot the selector reads. */
  readonly scene: TSceneName;
  /** The renderer's latest commit. */
  readonly commit: SharedValue<CommitFrame<TScenes>>;
  /** The renderer's presentation alpha. */
  readonly alpha: SharedValue<number>;
  /** The loaded asset; the renderer borrows and never disposes it. */
  readonly source: LoadedImage | LoadedSpriteSheet;
  /** Normalized anchor in [0, 1] relative to the selected frame. */
  readonly anchor?: { readonly x: number; readonly y: number };
  /** Worklet mapper from the scene snapshots to presentation values. */
  readonly select: (context: GameSpriteSelectContext<TScenes, TSceneName>) => GameSpriteSelection;
}

/** Select the frame name for a clip + elapsed time (loop/once semantics). */
export function spriteFrameNameForClip(
  frames: Readonly<Record<string, unknown>>,
  clip: string,
  elapsedMs: number,
): string {
  'worklet';
  const source = frames as Readonly<Record<string, { readonly frames?: readonly string[]; readonly frameDurationMs?: number; readonly mode?: 'loop' | 'once' }>>;
  const animation = source[clip];
  if (animation === undefined || animation.frames === undefined || animation.frames.length === 0) {
    return clip;
  }
  const duration = animation.frameDurationMs ?? 1;
  const count = animation.frames.length;
  const index =
    animation.mode === 'once'
      ? Math.min(Math.floor(elapsedMs / duration), count - 1)
      : Math.floor(elapsedMs / duration) % count;
  return animation.frames[index] ?? animation.frames[0] ?? clip;
}

export function GameSprite<
  TScenes extends SceneMap,
  TSceneName extends Extract<keyof TScenes, string>,
>({
  scene,
  commit,
  alpha,
  source,
  anchor,
  select,
}: GameSpriteProps<TScenes, TSceneName>) {
  const selection = useDerivedValue(() => {
    'worklet';
    const envelope = commit.value;
    if (envelope.scene !== scene) {
      return undefined;
    }
    const current = envelope.current as never as SceneSnapshot<TScenes[TSceneName]>;
    const context = {
      // The first commit has no previous snapshot; the current one stands in
      // so the initial presentation interpolates from itself (alpha 0).
      previous:
        (envelope.previous ?? envelope.current) as never as SceneSnapshot<TScenes[TSceneName]>,
      current,
      alpha: alpha.value,
    } as GameSpriteSelectContext<TScenes, TSceneName>;
    return select(context);
  }, [commit, alpha, scene, select]);

  const x = useDerivedValue(() => selection.value?.x ?? 0);
  const y = useDerivedValue(() => selection.value?.y ?? 0);
  const rotation = useDerivedValue(() => selection.value?.rotation ?? 0);
  const scale = useDerivedValue(() => selection.value?.scale ?? 1);
  const opacity = useDerivedValue(() => selection.value?.opacity ?? 1);
  const flipX = useDerivedValue(() => selection.value?.flipX ?? false);
  const flipY = useDerivedValue(() => selection.value?.flipY ?? false);
  const visible = useDerivedValue(() => selection.value?.visible ?? true);
  const frameName = useDerivedValue(() => {
    'worklet';
    const selectionValue = selection.value;
    if (selectionValue === undefined) {
      return undefined;
    }
    if (selectionValue.frame !== undefined) {
      return selectionValue.frame;
    }
    if (selectionValue.clip === undefined) {
      return undefined;
    }
    if (source.descriptor.kind !== 'sprite-sheet') {
      return undefined;
    }
    const sheet = source as LoadedSpriteSheet;
    return spriteFrameNameForClip(
      sheet.frames,
      selectionValue.clip,
      selectionValue.elapsedMs ?? 0,
    );
  });

  const animated = {
    x: x as SpriteAnimatable,
    y: y as SpriteAnimatable,
    rotation: rotation as SpriteAnimatable,
    scale: scale as SpriteAnimatable,
    opacity: opacity as SpriteAnimatable,
    flipX: flipX as SpriteAnimatableBoolean,
    flipY: flipY as SpriteAnimatableBoolean,
    visible: visible as SpriteAnimatableBoolean,
  };

  const props = {
    source,
    frame: source.descriptor.kind === 'sprite-sheet' ? (frameName as never) : undefined,
    anchor,
    ...animated,
  } as unknown as SpriteProps;
  return <Sprite {...props} />;
}
