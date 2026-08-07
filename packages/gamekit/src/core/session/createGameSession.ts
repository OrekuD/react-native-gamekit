import type { GameDefinition, InputMap, SceneMap } from '../../definition/types';
import type { SceneSnapshot } from '../../scene/types';
import { createAnimationFrameDriver, type FrameDriver, type FrameHandle } from '../frameDriver';
import { createInputBuffer } from '../input/createInputBuffer';
import type { InputFrame } from '../input/types';
import {
  GameSessionDisposedError,
  type DeepReadonly,
  type GameSession,
  type GameSessionStatus,
  type RenderFrame,
} from './types';

const DEFAULT_FIXED_STEP_MS = 1000 / 60;
const DEFAULT_MAX_CATCH_UP_STEPS = 5;

interface SessionOptions {
  readonly frameDriver: FrameDriver;
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxFrameDeltaMs?: number;
}

interface ErasedScene<TSnapshot> {
  readonly actions: readonly string[];
  create(): unknown;
  update(frame: {
    readonly state: unknown;
    readonly input: InputFrame<string>;
    readonly tick: number;
    readonly deltaSeconds: number;
    readonly elapsedSeconds: number;
  }): unknown;
  snapshot(context: { readonly state: unknown }): TSnapshot;
  dispose?(state: unknown): void;
}

function freezeObject<T>(value: T): T {
  return typeof value === 'object' && value !== null ? Object.freeze(value) : value;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): DeepReadonly<T> {
  if (typeof value !== 'object' || value === null) {
    return value as DeepReadonly<T>;
  }
  if (seen.has(value)) {
    return value as DeepReadonly<T>;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

/** Create a live session using the platform animation-frame driver. */
export function createGameSession<
  const TScenes extends SceneMap,
  const TInput extends InputMap,
  const TInitialScene extends keyof TScenes,
>(
  definition: GameDefinition<TScenes, TInput, TInitialScene>,
): GameSession<
  Extract<keyof TInput, string>,
  SceneSnapshot<TScenes[TInitialScene]>
> {
  return createGameSessionWithDriver(definition, {
    frameDriver: createAnimationFrameDriver(),
  });
}

/** @internal Deterministic construction seam used by the headless test suite. */
export function createGameSessionWithDriver<
  const TScenes extends SceneMap,
  const TInput extends InputMap,
  const TInitialScene extends keyof TScenes,
>(
  definition: GameDefinition<TScenes, TInput, TInitialScene>,
  options: SessionOptions,
): GameSession<
  Extract<keyof TInput, string>,
  SceneSnapshot<TScenes[TInitialScene]>
> {
  type ActionName = Extract<keyof TInput, string>;
  type Snapshot = SceneSnapshot<TScenes[TInitialScene]>;

  const fixedStepMs = options.fixedStepMs ?? DEFAULT_FIXED_STEP_MS;
  const maxCatchUpSteps = options.maxCatchUpSteps ?? DEFAULT_MAX_CATCH_UP_STEPS;
  const maxFrameDeltaMs = options.maxFrameDeltaMs ?? fixedStepMs * DEFAULT_MAX_CATCH_UP_STEPS;

  if (!(fixedStepMs > 0) || !Number.isFinite(fixedStepMs)) {
    throw new RangeError('fixedStepMs must be a finite positive number');
  }
  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps < 1) {
    throw new RangeError('maxCatchUpSteps must be a positive integer');
  }
  if (!(maxFrameDeltaMs > 0) || !Number.isFinite(maxFrameDeltaMs)) {
    throw new RangeError('maxFrameDeltaMs must be a finite positive number');
  }

  const sceneName = String(definition.initialScene);
  const scene = definition.scenes[definition.initialScene] as unknown as ErasedScene<Snapshot>;

  for (const action of scene.actions) {
    if (!Object.hasOwn(definition.input, action)) {
      throw new Error(`Scene "${sceneName}" uses undeclared input action: ${action}`);
    }
  }

  let state: unknown = freezeObject(scene.create());
  let currentSnapshot: DeepReadonly<Snapshot>;

  try {
    currentSnapshot = deepFreeze(scene.snapshot({ state }));
  } catch (error) {
    scene.dispose?.(state);
    throw error;
  }

  let status: GameSessionStatus = 'idle';
  let generation = 0;
  let frameHandle: FrameHandle | undefined;
  let previousTimestampMs: number | undefined;
  let accumulatorMs = 0;
  let tick = 0;
  let previousSnapshot = currentSnapshot;
  let renderFrame: RenderFrame<Snapshot> = Object.freeze({
    previous: previousSnapshot,
    current: currentSnapshot,
    alpha: 0,
    tick: 0,
    elapsedSeconds: 0,
  });
  const listeners = new Set<(frame: RenderFrame<Snapshot>) => void>();

  const assertLive = () => {
    if (status === 'disposed') {
      throw new GameSessionDisposedError();
    }
  };
  const isDisposed = () => status === 'disposed';
  const inputBuffer = createInputBuffer(definition.input, assertLive);

  const publish = () => {
    const alpha = Math.max(0, Math.min(accumulatorMs / fixedStepMs, 1 - Number.EPSILON));
    renderFrame = Object.freeze({
      previous: previousSnapshot,
      current: currentSnapshot,
      alpha,
      tick,
      elapsedSeconds: (tick * fixedStepMs) / 1000,
    });
    for (const listener of [...listeners]) {
      listener(renderFrame);
    }
  };

  const pauseInternal = () => {
    if (status !== 'running') {
      return;
    }
    status = 'paused';
    generation += 1;
    if (frameHandle !== undefined) {
      options.frameDriver.cancelFrame(frameHandle);
      frameHandle = undefined;
    }
    previousTimestampMs = undefined;
    accumulatorMs = 0;
    inputBuffer.reset();
  };

  const publishOrPause = () => {
    try {
      publish();
    } catch (error) {
      pauseInternal();
      throw error;
    }
  };

  const schedule = (activeGeneration: number) => {
    frameHandle = options.frameDriver.requestFrame((timestampMs) => {
      if (status !== 'running' || generation !== activeGeneration) {
        return;
      }
      frameHandle = undefined;

      if (previousTimestampMs === undefined) {
        previousTimestampMs = timestampMs;
        publishOrPause();
        if (status === 'running' && generation === activeGeneration) {
          schedule(activeGeneration);
        }
        return;
      }

      const wallDeltaMs = Math.max(0, timestampMs - previousTimestampMs);
      previousTimestampMs = timestampMs;
      accumulatorMs += Math.min(wallDeltaMs, maxFrameDeltaMs);
      const tolerance = fixedStepMs * 1e-9;
      let catchUpSteps = 0;

      try {
        while (
          accumulatorMs + tolerance >= fixedStepMs &&
          catchUpSteps < maxCatchUpSteps &&
          status === 'running' &&
          generation === activeGeneration
        ) {
          const nextTick = tick + 1;
          const input = inputBuffer.sample();
          const nextState = freezeObject(
            scene.update({
              state,
              input,
              tick: nextTick,
              deltaSeconds: fixedStepMs / 1000,
              elapsedSeconds: (nextTick * fixedStepMs) / 1000,
            }),
          );
          if (isDisposed()) {
            return;
          }
          const nextSnapshot = deepFreeze(scene.snapshot({ state: nextState }));
          if (isDisposed()) {
            return;
          }
          state = nextState;
          previousSnapshot = currentSnapshot;
          currentSnapshot = nextSnapshot;
          tick = nextTick;
          accumulatorMs = Math.max(0, accumulatorMs - fixedStepMs);
          catchUpSteps += 1;
        }
      } catch (error) {
        pauseInternal();
        throw error;
      }

      if (catchUpSteps === maxCatchUpSteps && accumulatorMs >= fixedStepMs) {
        accumulatorMs %= fixedStepMs;
      }

      publishOrPause();
      if (status === 'running' && generation === activeGeneration) {
        schedule(activeGeneration);
      }
    });
  };

  const session: GameSession<ActionName, Snapshot> = {
    get status() {
      return status;
    },
    scene: sceneName,
    input: inputBuffer.controller,
    start() {
      assertLive();
      if (status === 'running') {
        return;
      }
      status = 'running';
      previousTimestampMs = undefined;
      accumulatorMs = 0;
      const activeGeneration = ++generation;
      schedule(activeGeneration);
    },
    pause() {
      assertLive();
      pauseInternal();
    },
    dispose() {
      if (status === 'disposed') {
        return;
      }
      if (frameHandle !== undefined) {
        options.frameDriver.cancelFrame(frameHandle);
        frameHandle = undefined;
      }
      status = 'disposed';
      generation += 1;
      previousTimestampMs = undefined;
      accumulatorMs = 0;
      inputBuffer.reset();
      listeners.clear();
      scene.dispose?.(state);
    },
    getRenderFrame() {
      return renderFrame;
    },
    addRenderFrameListener(listener) {
      assertLive();
      listeners.add(listener);
      let removed = false;
      return Object.freeze({
        remove() {
          if (removed) {
            return;
          }
          removed = true;
          listeners.delete(listener);
        },
      });
    },
  };

  return Object.freeze(session);
}
