/**
 * Presented camera binding (T12.3).
 *
 * Joins authored camera data to the UI presentation pipeline: `commit`
 * runs per simulation commit on the JS runtime and evaluates the
 * definition's selector (with the frozen cut semantics), `present` runs on
 * the UI runtime per display frame and interpolates the previous and
 * current cuts by the presentation alpha, writing the read-only
 * `CameraCut2D` into the GameView-owned shared value that renderer and
 * pointer adapter both consume.
 *
 * Cuts (snap instead of interpolate): scene transitions (`hardCut` or a
 * scene-name change), explicit `cut` predicate hits, session replacement
 * and definition replacement (binding regeneration). A throwing selector
 * leaves the previous presented value untouched.
 */
import { useMemo, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { interpolateCamera2D, type Camera2D, type CameraCut2D } from '../../camera2d';
import type { CommitFrame } from '../../core/session/types';
import type { SceneMap } from '../../definition/types';
import type { GameCamera2DDefinition } from './defineGameCamera2D';

/** A UI-side camera binding for one session presentation. */
export interface PresentedCameraBinding<TScenes extends SceneMap> {
  /** Evaluate the selector against one committed frame (JS runtime). */
  commit(frame: CommitFrame<TScenes>): void;
  /** Advance presentation by the current alpha (UI runtime worklet). */
  present(alpha: number): void;
  /** Drop the current state; the presented value stays as-is. */
  dispose(): void;
}

function sameSceneName(first: string | undefined, second: string | undefined): boolean {
  return first === second;
}

/**
 * Create the camera binding for one presentation.
 *
 * The `presented` shared value is owned by `GameView` so the pointer
 * adapter (a sibling of the renderer) reads the same generation.
 */
export function usePresentedCameraBinding<TScenes extends SceneMap>(
  definition: GameCamera2DDefinition<CommitFrame<TScenes>> | undefined,
  presented: SharedValue<CameraCut2D | undefined>,
): PresentedCameraBinding<TScenes> {
  const authoredPrevious = useSharedValue<CameraCut2D | undefined>(undefined);
  const authoredCurrent = useSharedValue<CameraCut2D | undefined>(undefined);
  const cutId = useSharedValue(0);
  const sceneNameRef = useRef<string | undefined>(undefined);

  const definitionRef = useRef(definition);
  const definitionChanged = definitionRef.current !== definition;
  definitionRef.current = definition;

  const binding = useMemo<PresentedCameraBinding<TScenes>>(
    () => ({
      commit: (frame) => {
        if (definition === undefined) {
          return;
        }
        // Binding regeneration: a new definition starts a fresh generation.
        if (definitionChanged) {
          authoredPrevious.value = undefined;
          authoredCurrent.value = undefined;
          sceneNameRef.current = undefined;
          cutId.value += 1;
          presented.value = undefined;
        }
        let camera: Camera2D;
        try {
          camera = definition.select(frame);
        } catch {
          // A throwing selector leaves the previous valid surface safe.
          return;
        }
        const sceneChanged = !sameSceneName(sceneNameRef.current, String(frame.scene));
        const explicitCut = definition.cut?.(frame) === true;
        sceneNameRef.current = String(frame.scene);
        const current: CameraCut2D = { camera, cutId: cutId.value };
        if (sceneChanged || explicitCut || frame.hardCut) {
          authoredPrevious.value = undefined;
          cutId.value += 1;
          authoredCurrent.value = { camera, cutId: cutId.value };
        } else {
          authoredPrevious.value = authoredCurrent.value;
          authoredCurrent.value = current;
        }
      },
      present: (alpha: number) => {
        'worklet';
        const current = authoredCurrent.value;
        if (current === undefined) {
          return;
        }
        presented.value = {
          camera: interpolateCamera2D(authoredPrevious.value, current, alpha),
          cutId: current.cutId,
        };
      },
      dispose: () => {
        authoredPrevious.value = undefined;
        authoredCurrent.value = undefined;
        presented.value = undefined;
      },
    }),
    [definition, presented],
  );

  return binding;
}
