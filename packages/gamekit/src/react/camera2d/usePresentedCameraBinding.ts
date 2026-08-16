/**
 * Presented camera binding (T12.3, T12-F2, T12-F3).
 *
 * Joins authored camera data to the UI presentation pipeline: `commit`
 * runs per simulation commit on the JS runtime and evaluates the
 * definition's selector AND cut predicate as ONE exception-safe
 * transaction, validating the selected camera before any shared value is
 * published. `present` runs on the UI runtime per display frame and
 * delegates to the trusted scalar projector (a complete worklet call
 * graph), writing the read-only `CameraCut2D` into the GameView-owned
 * shared value that renderer and pointer adapter both consume.
 *
 * Cut semantics (snap instead of interpolate): scene transitions
 * (`hardCut` or a scene-name change), explicit `cut` predicate hits,
 * session replacement, and definition replacement — which is modeled as
 * ONE pending cut owned by the replacement and consumed on its first
 * successful commit, so later commits interpolate normally (T12-F3).
 * A throwing selector or cut predicate retains the last valid presented
 * value and leaves no half-updated state; the next valid commit recovers.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { interpolateCameraScalar2D, type CameraCut2D } from '../../camera2d';
import { assertValidCamera2D } from '../../camera2d/validation';
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
  // T12-F3: definition replacement is ONE pending cut, consumed by the
  // first successful commit of the replacement binding — never a
  // render-time boolean that stays true for the binding lifetime.
  const pendingCutRef = useRef(false);

  const definitionRef = useRef(definition);
  useEffect(() => {
    if (definitionRef.current === definition) {
      return;
    }
    definitionRef.current = definition;
    pendingCutRef.current = true;
    authoredPrevious.value = undefined;
    authoredCurrent.value = undefined;
    sceneNameRef.current = undefined;
    cutId.value += 1;
    presented.value = undefined;
  }, [authoredCurrent, authoredPrevious, cutId, definition, presented]);

  const binding = useMemo<PresentedCameraBinding<TScenes>>(
    () => ({
      commit: (frame) => {
        if (definition === undefined) {
          return;
        }
        // One exception-safe transaction: select + cut + validation. A
        // failure retains the last valid presented value and leaves no
        // half-updated scene/cut state.
        let camera;
        let explicitCut = false;
        try {
          camera = definition.select(frame);
          assertValidCamera2D(camera);
          explicitCut = definition.cut?.(frame) === true;
        } catch {
          return;
        }
        const pendingCut = pendingCutRef.current;
        pendingCutRef.current = false;
        const sceneChanged = !sameSceneName(sceneNameRef.current, String(frame.scene));
        sceneNameRef.current = String(frame.scene);
        const current: CameraCut2D = { camera, cutId: cutId.value };
        if (pendingCut || explicitCut || sceneChanged || frame.hardCut) {
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
          camera: interpolateCameraScalar2D(authoredPrevious.value, current, alpha),
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
