import type { GameDefinition, InputMap, SceneMap } from '../../definition/types';
import type { SceneTransitionController } from '../../scene/types';
import { createAnimationFrameDriver, type FrameDriver, type FrameHandle } from '../frameDriver';
import { createInputBuffer } from '../input/createInputBuffer';
import type { InputFrame } from '../input/types';
import {
  GameSessionDisposedError,
  GameSessionLifecycleError,
  type CommitFrame,
  type DeepReadonly,
  type GameRenderFrame,
  type GameSession,
  type GameSessionStatus,
} from './types';
import type { SessionDiagnostics } from './diagnostics';
import { createDeepFreeze, type DeepFreezer } from './deepFreeze';

const DEFAULT_FIXED_STEP_MS = 1000 / 60;
const DEFAULT_MAX_CATCH_UP_STEPS = 5;

interface SessionOptions {
  readonly frameDriver: FrameDriver;
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxFrameDeltaMs?: number;
  /** @internal Performance instrumentation for the playground Performance Lab. */
  readonly diagnostics?: SessionDiagnostics;
}

interface ErasedScene {
  readonly actions: readonly string[];
  readonly transitions: readonly string[];
  create(): unknown;
  update(frame: {
    readonly state: unknown;
    readonly input: InputFrame<string>;
    readonly transition: SceneTransitionController<string>;
    readonly tick: number;
    readonly sceneTick: number;
    readonly deltaSeconds: number;
    readonly elapsedSeconds: number;
    readonly sceneElapsedSeconds: number;
  }): unknown;
  snapshot(context: { readonly state: unknown }): unknown;
  dispose?(state: unknown): void;
}

interface ActiveScene {
  readonly name: string;
  readonly definition: ErasedScene;
  state: unknown;
  sceneTick: number;
}

type TransitionIntent =
  | { readonly kind: 'setScene'; readonly name: string }
  | { readonly kind: 'restart' };

interface UpdateScope {
  intent?: TransitionIntent;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function freezeObject<T>(value: T): T {
  return typeof value === 'object' && value !== null ? Object.freeze(value) : value;
}

function describeIntent(intent: TransitionIntent): string {
  return intent.kind === 'restart' ? 'restartScene()' : `setScene("${intent.name}")`;
}

function sameIntent(a: TransitionIntent, b: TransitionIntent): boolean {
  if (a.kind === 'restart') {
    return b.kind === 'restart';
  }
  return b.kind === 'setScene' && a.name === b.name;
}

/** Create a live session using the platform animation-frame driver. */
export function createGameSession<
  const TScenes extends SceneMap,
  const TInput extends InputMap,
  const TInitialScene extends keyof TScenes,
>(
  definition: GameDefinition<TScenes, TInput, TInitialScene>,
): GameSession<TScenes, TInput> {
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
): GameSession<TScenes, TInput> {
  const fixedStepMs = options.fixedStepMs ?? DEFAULT_FIXED_STEP_MS;
  const maxCatchUpSteps = options.maxCatchUpSteps ?? DEFAULT_MAX_CATCH_UP_STEPS;
  const maxFrameDeltaMs = options.maxFrameDeltaMs ?? fixedStepMs * DEFAULT_MAX_CATCH_UP_STEPS;
  // F4: keep diagnostics optional and guard every measurement — the disabled
  // path must perform no timing reads, callbacks, or wrapper allocations.
  const diagnostics = options.diagnostics;
  const deepFreeze: DeepFreezer = createDeepFreeze();

  if (!(fixedStepMs > 0) || !Number.isFinite(fixedStepMs)) {
    throw new RangeError('fixedStepMs must be a finite positive number');
  }
  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps < 1) {
    throw new RangeError('maxCatchUpSteps must be a positive integer');
  }
  if (!(maxFrameDeltaMs > 0) || !Number.isFinite(maxFrameDeltaMs)) {
    throw new RangeError('maxFrameDeltaMs must be a finite positive number');
  }

  const erasedSceneMap: Record<string, ErasedScene> = {};
  for (const [name, scene] of Object.entries(definition.scenes)) {
    const erased = scene as unknown as ErasedScene;
    for (const action of erased.actions) {
      if (!Object.hasOwn(definition.input, action)) {
        throw new Error(`Scene "${name}" uses undeclared input action: ${action}`);
      }
    }
    for (const target of erased.transitions ?? []) {
      if (!Object.hasOwn(definition.scenes, target)) {
        throw new Error(`Scene "${name}" declares an unknown transition target: ${target}`);
      }
    }
    erasedSceneMap[name] = erased;
  }

  // Create the initial scene instance synchronously.
  const initialSceneName = String(definition.initialScene);
  const initialDefinition = erasedSceneMap[initialSceneName];
  if (initialDefinition === undefined) {
    throw new Error(`Unknown initial scene: ${initialSceneName}`);
  }
  const initialState = freezeObject(initialDefinition.create());
  let initialSnapshot: DeepReadonly<unknown>;
  try {
    initialSnapshot = deepFreeze(initialDefinition.snapshot({ state: initialState }));
  } catch (error) {
    initialDefinition.dispose?.(initialState);
    throw error;
  }

  let activeScene: ActiveScene = {
    name: initialSceneName,
    definition: initialDefinition,
    state: initialState,
    sceneTick: 0,
  };
  let sceneName: string = initialSceneName;
  let currentSnapshot: DeepReadonly<unknown> = initialSnapshot;
  let previousSnapshot: DeepReadonly<unknown> = initialSnapshot;

  let status: GameSessionStatus = 'idle';
  let generation = 0;
  let frameHandle: FrameHandle | undefined;
  let previousTimestampMs: number | undefined;
  let accumulatorMs = 0;
  let tick = 0;
  let pendingTransition: TransitionIntent | undefined;
  let hardCutPending = false;
  let publishedThisCallback = false;
  let updateInProgress = false;
  let revision = 0;
  let commitFrame: CommitFrame<TScenes> = Object.freeze({
    scene: sceneName,
    previous: previousSnapshot,
    current: currentSnapshot,
    tick: 0,
    elapsedSeconds: 0,
    revision: 0,
    hardCut: false,
    stepMs: fixedStepMs,
  }) as unknown as CommitFrame<TScenes>;
  const listeners = new Set<(frame: CommitFrame<TScenes>) => void>();
  const statusListeners = new Set<(status: GameSessionStatus) => void>();
  let deliveringStatus = false;
  const queuedStatuses: GameSessionStatus[] = [];
  let releaseStatusListeners = false;

  // Deliver one transition pass to a snapshot. A throwing listener never
  // aborts the pass: the remaining snapshot listeners still run, and the
  // first failure is rethrown once every queued transition has been
  // delivered (the transition itself is already authoritative).
  const deliverStatusPass = (current: GameSessionStatus): unknown => {
    let firstError: unknown;
    for (const listener of [...statusListeners]) {
      try {
        listener(current);
      } catch (error) {
        if (firstError === undefined) {
          firstError = error;
        }
      }
    }
    return firstError;
  };

  const notifyStatus = (): void => {
    if (deliveringStatus) {
      // Re-entrant transition from inside a listener: queue it so every
      // listener observes complete states, never a half-applied transition.
      queuedStatuses.push(status);
      return;
    }
    deliveringStatus = true;
    let firstError: unknown;
    try {
      const error = deliverStatusPass(status);
      if (firstError === undefined) {
        firstError = error;
      }
      while (queuedStatuses.length > 0) {
        const queued = queuedStatuses.shift() as GameSessionStatus;
        const queuedError = deliverStatusPass(queued);
        if (firstError === undefined) {
          firstError = queuedError;
        }
      }
    } finally {
      deliveringStatus = false;
      if (releaseStatusListeners) {
        releaseStatusListeners = false;
        statusListeners.clear();
      }
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  };

  // Status becomes authoritative only after the command's scheduling and
  // input side effects are safe; listeners then observe the committed value.
  const setStatus = (next: GameSessionStatus): void => {
    if (status === next) {
      return;
    }
    status = next;
    notifyStatus();
  };

  // Error-path pause: complete the transition and notify, but never let a
  // status-listener failure mask the original error that caused the pause.
  const pauseAndRethrow = (original: unknown): never => {
    try {
      pauseInternal();
    } catch {
      // The original error is the actionable one; listeners were notified.
    }
    throw original;
  };

  const assertLive = () => {
    if (status === 'disposed') {
      throw new GameSessionDisposedError();
    }
  };
  const isDisposed = () => status === 'disposed';
  // T10.4: gameplay input is rejected at the shared boundary while paused
  // (before the queue and before the accepted-input diagnostics).
  const inputBuffer = createInputBuffer(definition.input, assertLive, () => status === 'paused');

  // Simulation commits are the only presentation updates (T5): a commit
  // happens on the initial baseline, after every presentation callback that
  // ran at least one fixed step (one commit per callback, carrying the final
  // adjacent snapshot pair), and on every transition/restart. Zero-step
  // callbacks allocate nothing beyond scheduling their successor.
  const commit = () => {
    const hardCut = hardCutPending;
    hardCutPending = false;
    publishedThisCallback = true;
    const publishStart = diagnostics === undefined ? 0 : now();
    const frame = Object.freeze({
      scene: sceneName,
      previous: previousSnapshot,
      current: currentSnapshot,
      tick,
      elapsedSeconds: (tick * fixedStepMs) / 1000,
      revision: ++revision,
      hardCut,
      stepMs: fixedStepMs,
    }) as unknown as CommitFrame<TScenes>;
    commitFrame = frame;
    for (const listener of [...listeners]) {
      listener(frame);
    }
    if (diagnostics !== undefined) {
      diagnostics.onPublish(now() - publishStart);
      diagnostics.onCommitNotification();
      diagnostics.onListenerCount(listeners.size);
    }
  };

  const pauseInternal = () => {
    if (status !== 'running') {
      return;
    }
    generation += 1;
    if (frameHandle !== undefined) {
      options.frameDriver.cancelFrame(frameHandle);
      frameHandle = undefined;
    }
    previousTimestampMs = undefined;
    accumulatorMs = 0;
    inputBuffer.reset();
    setStatus('paused');
  };

  const commitOrPause = () => {
    try {
      commit();
    } catch (error) {
      pauseAndRethrow(error);
    }
  };

  /**
   * Transition to `targetName` following the deterministic ordering:
   * prepare the target -> dispose the outgoing scene exactly once -> advance
   * session time when the request came from a successful update -> install
   * the new scene with scene-local time reset -> clear scene-local input edges
   * and interpolation debt -> install hard-cut snapshots. An update-scoped
   * transition may retain a physically active pointer when the target scene
   * consumes the same action; external transitions still perform a full reset.
   *
   * On any preparation or disposal failure the old scene and its state are
   * retained, session tick/time are left unchanged, and the original error is
   * rethrown after cleaning up any partially created target.
   */
  const commitTransition = (
    intent: TransitionIntent,
    outgoingFinalState: unknown,
    advanceTimeTick: number | undefined,
    preserveActivePointers = false,
  ) => {
    const targetName = intent.kind === 'restart' ? activeScene.name : intent.name;
    const targetDefinition = erasedSceneMap[targetName];
    if (targetDefinition === undefined) {
      throw new GameSessionLifecycleError(`Unknown scene: ${targetName}`);
    }

    let targetState: unknown;
    let targetCreated = false;
    let targetSnapshot: DeepReadonly<unknown>;
    try {
      targetState = freezeObject(targetDefinition.create());
      targetCreated = true;
      targetSnapshot = deepFreeze(targetDefinition.snapshot({ state: targetState }));
    } catch (error) {
      if (targetCreated) {
        try {
          targetDefinition.dispose?.(targetState);
        } catch {
          // Cleanup failures during failure handling are best effort.
        }
      }
      throw error;
    }

    try {
      activeScene.definition.dispose?.(outgoingFinalState);
    } catch (error) {
      // The outgoing scene's dispose already ran (possibly partially) and is
      // not retried; the old scene remains active with that honest caveat.
      if (targetCreated) {
        try {
          targetDefinition.dispose?.(targetState);
        } catch {
          // Best effort.
        }
      }
      throw error;
    }

    if (advanceTimeTick !== undefined) {
      tick = advanceTimeTick;
    }
    activeScene = {
      name: targetName,
      definition: targetDefinition,
      state: targetState,
      sceneTick: 0,
    };
    sceneName = targetName;
    currentSnapshot = targetSnapshot;
    previousSnapshot = targetSnapshot;
    if (preserveActivePointers) {
      inputBuffer.resetForTransition(targetDefinition.actions);
    } else {
      inputBuffer.reset();
    }
    // Keep the accumulated timing fraction: discarding it would make the tick
    // count depend on presentation rate (acceptance criterion 11). The hard cut
    // is still published with alpha 0 via `hardCutPending`.
    hardCutPending = true;
  };

  const requestPendingTransition = (intent: TransitionIntent) => {
    if (pendingTransition !== undefined && !sameIntent(pendingTransition, intent)) {
      throw new GameSessionLifecycleError(
        `Conflicting pending scene transition (${describeIntent(pendingTransition)} then ${describeIntent(intent)})`,
      );
    }
    pendingTransition = intent;
  };

  let activeUpdateScope: UpdateScope | undefined;

  const makeTransitionController = (scope: UpdateScope): SceneTransitionController<string> => {
    const assertActive = () => {
      if (activeUpdateScope !== scope) {
        throw new GameSessionLifecycleError(
          'Scene transition controller is only valid during its owning scene update',
        );
      }
    };
    return Object.freeze({
      setScene(name: string) {
        assertActive();
        if (name === activeScene.name) {
          return; // Idempotent no-op.
        }
        if (!Object.hasOwn(definition.scenes, name)) {
          throw new GameSessionLifecycleError(`Unknown scene: ${name}`);
        }
        const declared = activeScene.definition.transitions ?? [];
        if (!declared.includes(name)) {
          throw new GameSessionLifecycleError(
            `Scene "${activeScene.name}" can only transition to its declared targets (missing "${name}")`,
          );
        }
        if (
          scope.intent !== undefined &&
          !(scope.intent.kind === 'setScene' && scope.intent.name === name)
        ) {
          throw new GameSessionLifecycleError(
            `Conflicting scene transition requests in one update (${describeIntent(scope.intent)} then setScene("${name}"))`,
          );
        }
        scope.intent = { kind: 'setScene', name };
      },
      restartScene() {
        assertActive();
        if (scope.intent !== undefined && scope.intent.kind !== 'restart') {
          throw new GameSessionLifecycleError(
            `Conflicting scene transition requests in one update (${describeIntent(scope.intent)} then restartScene())`,
          );
        }
        scope.intent = { kind: 'restart' };
      },
    });
  };

  const schedule = (activeGeneration: number) => {
    frameHandle = options.frameDriver.requestFrame((timestampMs) => {
      if (status !== 'running' || generation !== activeGeneration) {
        return;
      }
      frameHandle = undefined;
      publishedThisCallback = false;
      if (diagnostics !== undefined) {
        diagnostics.onDisplayCallback();
      }

      // A pending external transition commits at the next fixed-step boundary
      // without advancing simulation tick/time.
      if (pendingTransition !== undefined) {
        const pending = pendingTransition;
        pendingTransition = undefined;
        try {
          commitTransition(pending, activeScene.state, undefined);
        } catch (error) {
          pauseAndRethrow(error);
        }
        commitOrPause();
        if (status !== 'running' || generation !== activeGeneration) {
          return;
        }
      }

      if (previousTimestampMs === undefined) {
        previousTimestampMs = timestampMs;
        if (!publishedThisCallback) {
          commitOrPause();
        }
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
      let stepsRan = false;

      try {
        while (
          accumulatorMs + tolerance >= fixedStepMs &&
          catchUpSteps < maxCatchUpSteps &&
          status === 'running' &&
          generation === activeGeneration
        ) {
          stepsRan = true;
          const nextTick = tick + 1;
          const nextSceneTick = activeScene.sceneTick + 1;
          const sampleStart = diagnostics === undefined ? 0 : now();
          const input = inputBuffer.sample();
          if (diagnostics !== undefined) {
            diagnostics.onInputSample(now() - sampleStart);
          }
          const scope: UpdateScope = {};
          activeUpdateScope = scope;
          updateInProgress = true;
          const updateStart = diagnostics === undefined ? 0 : now();
          const nextState = freezeObject(
            activeScene.definition.update({
              state: activeScene.state,
              input,
              transition: makeTransitionController(scope),
              tick: nextTick,
              sceneTick: nextSceneTick,
              deltaSeconds: fixedStepMs / 1000,
              elapsedSeconds: (nextTick * fixedStepMs) / 1000,
              sceneElapsedSeconds: (nextSceneTick * fixedStepMs) / 1000,
            }),
          );
          activeUpdateScope = undefined;
          updateInProgress = false;
          if (diagnostics !== undefined) {
            diagnostics.onUpdate(now() - updateStart);
          }
          const intent = scope.intent;
          if (isDisposed()) {
            return;
          }
          if (intent !== undefined) {
            // A transition requested during update commits after this update
            // completes successfully. The update consumed one fixed step; the
            // hard-cut frame publishes at the end of this presentation callback.
            commitTransition(intent, nextState, nextTick, true);
            accumulatorMs = Math.max(0, accumulatorMs - fixedStepMs);
            // F4: the transition consumed one fixed step; report it as such
            // and never as a zero-step callback (zero-step fires only when
            // no step ran at all).
            if (diagnostics !== undefined) {
              diagnostics.onFixedStep();
            }
            break;
          }
          const snapshotStart = diagnostics === undefined ? 0 : now();
          const rawSnapshot = activeScene.definition.snapshot({ state: nextState });
          if (diagnostics !== undefined) {
            diagnostics.onSnapshot(now() - snapshotStart);
          }
          const freezeStart = diagnostics === undefined ? 0 : now();
          const nextSnapshot = deepFreeze(rawSnapshot);
          if (diagnostics !== undefined) {
            diagnostics.onDeepFreeze(now() - freezeStart);
          }
          if (isDisposed()) {
            return;
          }
          activeScene.state = nextState;
          activeScene.sceneTick = nextSceneTick;
          previousSnapshot = currentSnapshot;
          currentSnapshot = nextSnapshot;
          tick = nextTick;
          accumulatorMs = Math.max(0, accumulatorMs - fixedStepMs);
          catchUpSteps += 1;
          if (diagnostics !== undefined) {
            diagnostics.onFixedStep();
            if (catchUpSteps > 1) {
              diagnostics.onCatchUpStep();
            }
          }
        }
      } catch (error) {
        activeUpdateScope = undefined;
        updateInProgress = false;
        pauseAndRethrow(error);
      }

      if (catchUpSteps === maxCatchUpSteps && accumulatorMs >= fixedStepMs) {
        const droppedSteps = Math.floor(accumulatorMs / fixedStepMs);
        accumulatorMs %= fixedStepMs;
        if (diagnostics !== undefined) {
          diagnostics.onDroppedDebt(droppedSteps);
        }
      }

      if (catchUpSteps === 0 && !stepsRan) {
        if (diagnostics !== undefined) {
          diagnostics.onZeroStepCallback();
        }
      }

      if (stepsRan && !publishedThisCallback) {
        // One commit per presentation callback, with the final adjacent pair:
        // `previous`/`current` already hold the last two committed snapshots.
        // A transition inside the loop also counts as a run step: its hard
        // cut commits here (zero-step callbacks never reach this branch).
        commitOrPause();
      }
      if (status === 'running' && generation === activeGeneration) {
        schedule(activeGeneration);
      }
    });
  };

  const session: GameSession<TScenes, TInput> = {
    get status() {
      return status;
    },
    get scene() {
      return sceneName as keyof TScenes;
    },
    viewport: definition.viewport,
    input: inputBuffer.controller,
    start() {
      assertLive();
      if (status === 'running') {
        return;
      }
      const previous = status;
      previousTimestampMs = undefined;
      accumulatorMs = 0;
      const activeGeneration = ++generation;
      try {
        schedule(activeGeneration);
      } catch (error) {
        // Do not publish `running` when scheduling could not be established.
        status = previous;
        throw error;
      }
      setStatus('running');
    },
    pause() {
      assertLive();
      pauseInternal();
      if (pendingTransition !== undefined) {
        const pending = pendingTransition;
        pendingTransition = undefined;
        commitTransition(pending, activeScene.state, undefined);
        commitOrPause();
      }
    },
    setScene(name: keyof TScenes) {
      assertLive();
      if (updateInProgress) {
        throw new GameSessionLifecycleError(
          'External scene transitions cannot be requested during a scene update',
        );
      }
      const nameString = String(name);
      if (nameString === sceneName) {
        return; // Idempotent no-op.
      }
      if (!Object.hasOwn(definition.scenes, nameString)) {
        throw new GameSessionLifecycleError(`Unknown scene: ${nameString}`);
      }
      if (status === 'running') {
        requestPendingTransition({ kind: 'setScene', name: nameString });
        return;
      }
      commitTransition({ kind: 'setScene', name: nameString }, activeScene.state, undefined);
      commitOrPause();
    },
    restartScene() {
      assertLive();
      if (updateInProgress) {
        throw new GameSessionLifecycleError(
          'External scene transitions cannot be requested during a scene update',
        );
      }
      if (status === 'running') {
        requestPendingTransition({ kind: 'restart' });
        return;
      }
      commitTransition({ kind: 'restart' }, activeScene.state, undefined);
      commitOrPause();
    },
    dispose() {
      if (status === 'disposed') {
        return;
      }
      if (frameHandle !== undefined) {
        options.frameDriver.cancelFrame(frameHandle);
        frameHandle = undefined;
      }
      generation += 1;
      previousTimestampMs = undefined;
      accumulatorMs = 0;
      pendingTransition = undefined;
      inputBuffer.reset();
      // `disposed` is delivered exactly once, including when dispose runs
      // from inside a status listener; the listener set is released only
      // after every queued transition has been delivered.
      setStatus('disposed');
      releaseStatusListeners = true;
      listeners.clear();
      activeScene.definition.dispose?.(activeScene.state);
    },
    getRenderFrame() {
      const alpha = commitFrame.hardCut
        ? 0
        : Math.max(0, Math.min(accumulatorMs / fixedStepMs, 1 - Number.EPSILON));
      return Object.freeze({ ...commitFrame, alpha }) as unknown as GameRenderFrame<TScenes>;
    },
    addCommitListener(listener) {
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
    addStatusListener(listener) {
      assertLive();
      statusListeners.add(listener);
      let removed = false;
      return Object.freeze({
        remove() {
          if (removed) {
            return;
          }
          removed = true;
          statusListeners.delete(listener);
        },
      });
    },
  };

  return Object.freeze(session);
}
