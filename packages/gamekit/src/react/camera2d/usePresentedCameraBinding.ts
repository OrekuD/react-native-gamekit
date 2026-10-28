/**
 * A commit-boundary camera transaction, owned by one GameView presentation.
 * Selectors run on RN. Accepted frame/camera packets publish in one UI task;
 * failures freeze the last valid frame, alpha, and camera until recovery.
 */
import { useEffect, useMemo } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { interpolateCameraScalar2D, type CameraCut2D } from '../../camera2d';
import { cloneValidCamera2D } from '../../camera2d/validation';
import type { CommitFrame } from '../../core/session/types';
import type { SceneMap } from '../../definition/types';
import type { GameCamera2DDefinition } from './defineGameCamera2D';

interface AuthoredCamera {
  readonly previous: CameraCut2D | undefined;
  readonly current: CameraCut2D;
}

/** Frame publication and readiness belong to the mounted presentation. */
export interface CameraPresentationTarget<TScenes extends SceneMap> {
  readonly frame: SharedValue<CommitFrame<TScenes>>;
  readonly nextCutId: () => number;
  readonly onReady: (ready: boolean) => void;
}

export interface PresentedCameraBinding<TScenes extends SceneMap> {
  /** Disabled cameras leave frame publication on GameView's existing path. */
  commit(frame: CommitFrame<TScenes>): 'accepted' | 'rejected' | 'disabled';
  present(alpha: number): void;
  /** Failure freezes both frame interpolation and camera presentation. */
  readonly blocked: SharedValue<boolean>;
  /** Re-arm effect replay without allowing stale callbacks after cleanup. */
  activate(): void;
  dispose(): void;
  /** Apply a replacement to the latest attempted frame, including paused time. */
  replace(definition: GameCamera2DDefinition<CommitFrame<TScenes>> | undefined): void;
}

/**
 * Authored cameras and cut counters are RN-owned: committing never reads a
 * SharedValue. Only immutable packets cross to UI, where the frame and
 * camera become visible together before another render/input callback runs.
 */
export function usePresentedCameraBinding<TScenes extends SceneMap>(
  definition: GameCamera2DDefinition<CommitFrame<TScenes>> | undefined,
  presented: SharedValue<CameraCut2D | undefined>,
  target?: CameraPresentationTarget<TScenes>,
): PresentedCameraBinding<TScenes> {
  const authored = useSharedValue<AuthoredCamera | undefined>(undefined);
  const blocked = useSharedValue(false);
  const activeOnUI = useSharedValue(true);
  const generationOnUI = useSharedValue(0);

  const binding = useMemo<PresentedCameraBinding<TScenes>>(() => {
    let activeDefinition = definition;
    let latestFrame: CommitFrame<TScenes> | undefined;
    let current: CameraCut2D | undefined;
    let scene: string | undefined;
    let pendingCut = true;
    let failed = false;
    let reported = false;
    let active = true;
    let generation = 0;
    let ready = false;
    let readinessPending = false;
    let cutId = 0;
    const nextCutId = target?.nextCutId ?? (() => { cutId += 1; return cutId; });

    const reportReady = (expectedGeneration: number): void => {
      if (!active || generation !== expectedGeneration || ready) return;
      ready = true;
      readinessPending = false;
      target?.onReady(true);
    };
    const publish = (
      nextFrame: CommitFrame<TScenes>,
      next: AuthoredCamera,
      hardCut: boolean,
    ): void => {
      const frameValue = target?.frame;
      const expectedGeneration = generation;
      const needsReady = !ready && !readinessPending && target !== undefined;
      if (needsReady) readinessPending = true;
      scheduleOnUI(() => {
        'worklet';
        if (!activeOnUI.value || generationOnUI.value !== expectedGeneration) return;
        authored.value = next;
        if (frameValue !== undefined) frameValue.value = nextFrame;
        if (hardCut) presented.value = next.current;
        blocked.value = false;
        if (needsReady) scheduleOnRN(reportReady, expectedGeneration);
      });
    };
    const reject = (): void => {
      failed = true;
      const expectedGeneration = generation;
      scheduleOnUI(() => {
        'worklet';
        if (activeOnUI.value && generationOnUI.value === expectedGeneration) blocked.value = true;
      });
    };
    const commit = (frame: CommitFrame<TScenes>): 'accepted' | 'rejected' | 'disabled' => {
      latestFrame = frame;
      if (!active) return 'rejected';
      if (activeDefinition === undefined) return 'disabled';
      let camera;
      let explicitCut = false;
      let phase: 'select' | 'cut' | 'validate' = 'select';
      try {
        const selected = activeDefinition.select(frame);
        phase = 'cut';
        explicitCut = activeDefinition.cut?.(frame) === true;
        phase = 'validate';
        camera = cloneValidCamera2D(selected);
      } catch (error) {
        reject();
        if (!reported && activeDefinition.onError !== undefined) {
          reported = true;
          try { activeDefinition.onError({ phase, error, scene: String(frame.scene) }); } catch {
            // Diagnostics cannot break last-valid presentation.
          }
        }
        return 'rejected';
      }
      const recovery = failed;
      const hardCut = pendingCut || recovery || explicitCut || scene !== String(frame.scene) || frame.hardCut;
      const next: CameraCut2D = { camera, cutId: hardCut ? nextCutId() : current!.cutId };
      const previous = hardCut ? undefined : current;
      const nextFrame = recovery ? { ...frame, previous: frame.current, hardCut: true } : frame;
      current = next;
      scene = String(frame.scene);
      pendingCut = false;
      failed = false;
      reported = false;
      publish(nextFrame, { previous, current: next }, hardCut);
      return 'accepted';
    };
    return {
      commit,
      blocked,
      present: (alpha: number) => {
        'worklet';
        if (!activeOnUI.value || blocked.value) return;
        const value = authored.value;
        if (value === undefined) return;
        presented.value = {
          camera: interpolateCameraScalar2D(value.previous, value.current, alpha),
          cutId: value.current.cutId,
        };
      },
      activate: () => {
        active = true;
        generation += 1;
        const expectedGeneration = generation;
        scheduleOnUI(() => {
          'worklet';
          if (generationOnUI.value > expectedGeneration) return;
          generationOnUI.value = expectedGeneration;
          activeOnUI.value = true;
        });
      },
      dispose: () => {
        active = false;
        generation += 1;
        current = undefined;
        scene = undefined;
        pendingCut = true;
        ready = false;
        readinessPending = false;
        const expectedGeneration = generation;
        scheduleOnUI(() => {
          'worklet';
          if (generationOnUI.value > expectedGeneration) return;
          generationOnUI.value = expectedGeneration;
          activeOnUI.value = false;
          authored.value = undefined;
          presented.value = undefined;
          blocked.value = false;
        });
      },
      replace: (nextDefinition) => {
        if (activeDefinition === nextDefinition) return;
        activeDefinition = nextDefinition;
        pendingCut = true;
        if (nextDefinition === undefined) {
          current = undefined;
          scene = undefined;
          failed = false;
          reported = false;
          ready = false;
          readinessPending = false;
          generation += 1;
          target?.onReady(false);
          const frameValue = target?.frame;
          const nextFrame = latestFrame;
          const expectedGeneration = generation;
          scheduleOnUI(() => {
            'worklet';
            if (!activeOnUI.value || generationOnUI.value > expectedGeneration) return;
            generationOnUI.value = expectedGeneration;
            authored.value = undefined;
            presented.value = undefined;
            blocked.value = false;
            if (frameValue !== undefined && nextFrame !== undefined) frameValue.value = nextFrame;
          });
        } else if (latestFrame !== undefined) {
          commit(latestFrame);
        }
      },
    };
  // These values belong to one presentation lifetime. Definition updates
  // enter through replace; they never tear down the session binding.
  }, [presented]);

  useEffect(() => { binding.replace(definition); }, [binding, definition]);
  return binding;
}
