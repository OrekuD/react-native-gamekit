import type { AssetGroupMap } from '../../assets/types';
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
import type { GameEventDescriptor } from '../../events/types';
import type { AnyGameEventEnvelope } from '../../events/types';
import { GameEventError } from '../../events/errors';
import { cloneAndValidatePayload } from '../../events/payload';

const DEFAULT_FIXED_STEP_MS = 1000 / 60;

/**
 * A captured failure: an explicit boolean record so an arbitrary thrown
 * value (including `undefined`) is never confused with "no failure".
 */
interface CapturedFailure {
  readonly failed: true;
  readonly value: unknown;
}

type FailureRecord = { readonly failed: false } | CapturedFailure;

const NO_FAILURE: FailureRecord = { failed: false };

/** Run a closure and capture its thrown value, whatever its type. */
function captureFailure(run: () => void): FailureRecord {
  try {
    run();
    return NO_FAILURE;
  } catch (error) {
    return { failed: true, value: error };
  }
}

/** Surface a captured failure, throwing `undefined` if that was the value. */
function throwFailure(record: FailureRecord): void {
  if (record.failed) {
    throw record.value;
  }
}

/** Finish every lifecycle stage before surfacing its failures in order. */
function throwFailures(...records: readonly FailureRecord[]): void {
  const errors = records.flatMap((record) => record.failed ? [record.value] : []);
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Lifecycle operation failed with multiple errors');
  }
}

/**
 * Immutably compose two failures into one lossless error: an AggregateError
 * with a stable message and ordered `errors`. Neither thrown value is
 * mutated or wrapped away.
 */
function composeFailures(first: unknown, second: unknown): unknown {
  return new AggregateError(
    [first, second],
    'Lifecycle operation failed with multiple errors',
  );
}
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
  readonly emits?: readonly string[];
  readonly events?: unknown;
  create(): unknown;
  update(frame: {
    readonly state: unknown;
    readonly input: InputFrame<string>;
    readonly transition: SceneTransitionController<string>;
    readonly events: { emit(name: string, payload: unknown): void };
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
  /**
   * Set before user cleanup runs: a throwing disposer never runs again —
   * not on retry, not on session disposal — for this scene instance.
   */
  disposalAttempted: boolean;
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
  const TEventDefs extends Record<string, GameEventDescriptor<unknown>> = Record<string, never>,
>(
  definition: GameDefinition<TScenes, TInput, TInitialScene, AssetGroupMap, TEventDefs>,
): GameSession<TScenes, TInput, TEventDefs> {
  return createGameSessionWithDriver(definition, {
    frameDriver: createAnimationFrameDriver(),
  });
}

/** @internal Deterministic construction seam used by the headless test suite. */
export function createGameSessionWithDriver<
  const TScenes extends SceneMap,
  const TInput extends InputMap,
  const TInitialScene extends keyof TScenes,
  const TEventDefs extends Record<string, GameEventDescriptor<unknown>> = Record<string, never>,
>(
  definition: GameDefinition<TScenes, TInput, TInitialScene, AssetGroupMap, TEventDefs>,
  options: SessionOptions,
): GameSession<TScenes, TInput, TEventDefs> {
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

  // T13: event definitions and per-scene emit declarations.
  const eventDefs = (definition as unknown as { events?: Record<string, GameEventDescriptor<unknown>> }).events;
  const hasEvents = eventDefs !== undefined && eventDefs !== null;
  const allowedEventNames = hasEvents ? new Set(Object.keys(eventDefs!)) : new Set<string>();
  const allowedEmitsByScene = new Map<string, Set<string>>();
  // Validate per-scene emits are declared events and that the scene's `events` reference matches the game's.
  for (const [name, scene] of Object.entries(definition.scenes)) {
    const erased = scene as unknown as ErasedScene;
    const emits = erased.emits ?? [];
    for (const ev of emits) {
      if (!allowedEventNames.has(ev)) {
        throw new Error(`Scene "${name}" declares unknown event "${ev}"`);
      }
    }
    allowedEmitsByScene.set(name, new Set(emits as string[]));
    // Runtime identity check for the branded event definitions.
    if (erased.events !== undefined) {
      if (!hasEvents) {
        throw new Error(`Scene "${name}" is bound to events but the game has no events map`);
      }
      if (erased.events !== eventDefs) {
        throw new Error(
          `Scene "${name}" is bound to a different events object than the game. Pass the same defineGameEvents() result to both defineScene({ events }) and defineGame({ events }).`,
        );
      }
    } else if (emits.length > 0) {
      throw new Error(
        `Scene "${name}" declares emits but is not bound to the game's events. Pass \`events\` to defineScene.`,
      );
    }
  }
  const erasedSceneMap: Record<string, ErasedScene> = Object.create(null);
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
  // Ownership starts when create returns, before freezing can invoke a
  // user-defined proxy trap or reject an unsupported state container.
  const initialState = initialDefinition.create();
  let initialSnapshot: DeepReadonly<unknown>;
  try {
    freezeObject(initialState);
    initialSnapshot = deepFreeze(initialDefinition.snapshot({ state: initialState }), {
      scene: initialSceneName,
    });
  } catch (error) {
    // GS-SCENE-02: the cleanup failure must not replace the snapshot
    // failure — compose losslessly in a stable order instead.
    const cleanupFailure = captureFailure(() => initialDefinition.dispose?.(initialState));
    if (cleanupFailure.failed) {
      throw composeFailures(error, cleanupFailure.value);
    }
    throw error;
  }

  let activeScene: ActiveScene = {
    name: initialSceneName,
    definition: initialDefinition,
    state: initialState,
    sceneTick: 0,
    disposalAttempted: false,
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
  /**
   * Set when an outgoing scene disposal throws: the retained scene is
   * explicitly non-resumable — `start()` refuses to update it until a
   * transition or restart replaces it. Cleared on every successful install.
   */
  let sceneFaulted = false;
  let hardCutPending = false;
  let publishedThisCallback = false;
  let updateInProgress = false;
  let transitionInProgress = false;
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
  // Membership changes at control frequency. Each publication traverses the
  // current immutable array, so reentrant subscription changes affect only
  // later passes without allocating a listener snapshot on every commit.
  let listeners: readonly ((frame: CommitFrame<TScenes>) => void)[] = [];
  const statusListeners = new Set<(status: GameSessionStatus) => void>();
  let deliveringStatus = false;
  const queuedStatuses: GameSessionStatus[] = [];
  let releaseStatusListeners = false;

  // T13: per-session event listeners.
  const eventListeners = new Map<string, Set<(event: AnyGameEventEnvelope) => void | Promise<void>>>();

  // Centralized, non-recursive error sink for game event listeners.
  // A failing reporter must not pause the session or escape into the fixed-step loop.
  const reportGameEventListenerError = (name: string, error: unknown): void => {
    try {
      console.error(`Game event listener for "${name}" threw:`, error);
    } catch {
      // Swallow reporter failures — the session must remain running and siblings must still run.
    }
  };

  const deliverEvents = (envelopes: readonly AnyGameEventEnvelope[]): void => {
    // Snapshot per tick: a listener added during this tick's delivery receives
    // only later ticks, and a removal prevents only future ticks.
    const snapshots = new Map<string, readonly ((event: AnyGameEventEnvelope) => void | Promise<void>)[]>();
    for (const env of envelopes) {
      if (!snapshots.has(env.name)) {
        const set = eventListeners.get(env.name);
        snapshots.set(env.name, set ? [...set] : []);
      }
    }
    for (const envelope of envelopes) {
      const snapshot = snapshots.get(envelope.name) ?? [];
      for (const listener of snapshot) {
        let result: unknown;
        try {
          result = listener(envelope);
        } catch (error) {
          reportGameEventListenerError(envelope.name, error);
          continue;
        }
        if (result !== null && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).catch((error) => {
            reportGameEventListenerError(envelope.name, error);
          });
        }
      }
    }
  };

  const NO_EVENT_EMITTER = Object.freeze({
    emit() {
      throw new GameEventError('This game has no events or this scene does not emit any events');
    },
  }) as { emit(name: string, payload: unknown): void };

  // Deliver one transition pass to a snapshot. A throwing listener never
  // aborts the pass: the remaining snapshot listeners still run, and the
  // first failure is rethrown once every queued transition has been
  // delivered (the transition itself is already authoritative).
  const deliverStatusPass = (current: GameSessionStatus): FailureRecord => {
    let firstFailure: FailureRecord = NO_FAILURE;
    for (const listener of [...statusListeners]) {
      try {
        listener(current);
      } catch (error) {
        if (!firstFailure.failed) {
          firstFailure = { failed: true, value: error };
        }
      }
    }
    return firstFailure;
  };

  const notifyStatus = (): void => {
    if (deliveringStatus) {
      // Re-entrant transition from inside a listener: queue it so every
      // listener observes complete states, never a half-applied transition.
      queuedStatuses.push(status);
      return;
    }
    deliveringStatus = true;
    let firstFailure: FailureRecord = NO_FAILURE;
    try {
      const passFailure = deliverStatusPass(status);
      if (!firstFailure.failed) {
        firstFailure = passFailure;
      }
      while (queuedStatuses.length > 0) {
        const queued = queuedStatuses.shift() as GameSessionStatus;
        const queuedFailure = deliverStatusPass(queued);
        if (!firstFailure.failed) {
          firstFailure = queuedFailure;
        }
      }
    } finally {
      deliveringStatus = false;
      if (releaseStatusListeners) {
        releaseStatusListeners = false;
        statusListeners.clear();
        diagnostics?.onStatusListenerCount?.(statusListeners.size);
      }
    }
    throwFailure(firstFailure);
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
  // ran at least one fixed step (one commit carrying the final adjacent pair),
  // and on every transition/restart. A callback containing a transition
  // publishes one hard cut at its final snapshot. Ordinary zero-step
  // callbacks allocate nothing beyond scheduling their successor.
  const commit = () => {
    const hardCut = hardCutPending;
    hardCutPending = false;
    if (hardCut) {
      previousSnapshot = currentSnapshot;
    }
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
    for (const listener of listeners) {
      listener(frame);
    }
    if (diagnostics !== undefined) {
      diagnostics.onPublish(now() - publishStart);
      diagnostics.onCommitNotification();
      diagnostics.onListenerCount(listeners.length);
    }
  };

  const cancelPendingFrame = (): FailureRecord => {
    const handle = frameHandle;
    frameHandle = undefined;
    return captureFailure(() => {
      if (handle !== undefined) options.frameDriver.cancelFrame(handle);
    });
  };

  const pauseInternal = () => {
    if (status !== 'running') {
      return;
    }
    generation += 1;
    const cancellationFailure = cancelPendingFrame();
    previousTimestampMs = undefined;
    accumulatorMs = 0;
    inputBuffer.reset();
    const notificationFailure = captureFailure(() => setStatus('paused'));
    throwFailures(cancellationFailure, notificationFailure);
  };

  const commitOrPause = () => {
    try {
      commit();
    } catch (error) {
      pauseAndRethrow(error);
    }
  };

  /**
   * Dispose one scene instance exactly once. The attempt flag is set before
   * user cleanup runs, so a throwing disposer is never retried for this
   * instance — by transition retries or by session disposal.
   */
  const disposeSceneInstance = (scene: ActiveScene, state: unknown): void => {
    if (scene.disposalAttempted) {
      return;
    }
    scene.disposalAttempted = true;
    scene.definition.dispose?.(state);
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
   * rethrown after cleaning up any partially created target. Disposal of
   * the session from a lifecycle callback aborts installation and releases
   * the prepared target; false tells the caller not to publish that transition.
   */
  const commitTransition = (
    intent: TransitionIntent,
    outgoingFinalState: unknown,
    advanceTimeTick: number | undefined,
    preserveActivePointers = false,
  ): boolean => {
    const targetName = intent.kind === 'restart' ? activeScene.name : intent.name;
    const targetDefinition = erasedSceneMap[targetName];
    if (targetDefinition === undefined) {
      throw new GameSessionLifecycleError(`Unknown scene: ${targetName}`);
    }

    let targetState: unknown;
    let ownsTarget = false;
    const disposeTarget = () => {
      if (ownsTarget) {
        // Release ownership before user cleanup: even a throwing disposer
        // must never be retried by the preparation catch below.
        ownsTarget = false;
        targetDefinition.dispose?.(targetState);
      }
    };
    transitionInProgress = true;
    try {
      let targetSnapshot: DeepReadonly<unknown>;
      try {
        targetState = targetDefinition.create();
        ownsTarget = true;
        if (isDisposed()) {
          disposeTarget();
          return false;
        }
        freezeObject(targetState);
        if (isDisposed()) {
          disposeTarget();
          return false;
        }
        const rawSnapshot = targetDefinition.snapshot({ state: targetState });
        if (isDisposed()) {
          disposeTarget();
          return false;
        }
        targetSnapshot = deepFreeze(rawSnapshot, { scene: targetName });
      } catch (error) {
        const cleanupFailure = captureFailure(disposeTarget);
        if (cleanupFailure.failed) {
          throw composeFailures(error, cleanupFailure.value);
        }
        throw error;
      }

      if (isDisposed()) {
        disposeTarget();
        return false;
      }
      try {
        disposeSceneInstance(activeScene, outgoingFinalState);
      } catch (error) {
        // The outgoing scene's dispose already ran (possibly partially)
        // and cannot be retried. Keep its state explicitly non-resumable.
        sceneFaulted = true;
        const targetFailure = captureFailure(disposeTarget);
        if (targetFailure.failed) {
          throw composeFailures(error, targetFailure.value);
        }
        throw error;
      }
      if (isDisposed()) {
        disposeTarget();
        return false;
      }

      if (advanceTimeTick !== undefined) {
        tick = advanceTimeTick;
      }
      activeScene = {
        name: targetName,
        definition: targetDefinition,
        state: targetState,
        sceneTick: 0,
        disposalAttempted: false,
      };
      ownsTarget = false;
      sceneFaulted = false;
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
      return true;
    } finally {
      transitionInProgress = false;
    }
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

  // One scheduler-failure policy for successor scheduling (GS-SESSION-02).
  // The initial `start()` path keeps its own restore-previous-status policy
  // because no running state was ever published there. On failure: clear the
  // handle, invalidate the generation so late callbacks are no-ops,
  // neutralize input via the pause path, and publish paused while preserving
  // the scheduling error — a throwing status listener composes with it
  // instead of masking it. Never retries automatically.
  const failScheduling = (error: unknown): never => {
    frameHandle = undefined;
    try {
      pauseInternal();
    } catch (statusError) {
      throw composeFailures(error, statusError);
    }
    throw error;
  };

  const scheduleSuccessor = (activeGeneration: number): void => {
    try {
      schedule(activeGeneration);
    } catch (error) {
      failScheduling(error);
    }
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

      // Apply an external transition without advancing time. Due steps below
      // update the target in this callback, then one hard cut publishes its
      // latest snapshot. Zero-step callbacks publish the initial target.
      if (pendingTransition !== undefined) {
        const pending = pendingTransition;
        pendingTransition = undefined;
        try {
          if (!commitTransition(pending, activeScene.state, undefined)) {
            return;
          }
        } catch (error) {
          pauseAndRethrow(error);
        }
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
          scheduleSuccessor(activeGeneration);
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
          const sceneNameForTick = activeScene.name;
          const allowedEmits = allowedEmitsByScene.get(sceneNameForTick) ?? new Set<string>();

          // T13: per-tick transactional emitter.
          let stagedThisTick: AnyGameEventEnvelope[] = [];
          let ordinal = 0;
          let emitterInvalidated = false;
          const emitter: { emit(name: string, payload: unknown): void } = hasEvents
            ? {
                emit(name: string, payload: unknown) {
                  if (emitterInvalidated) {
                    throw new GameEventError('Game event emitter is only valid during its owning scene update');
                  }
                  if (!allowedEventNames.has(name)) {
                    throw new GameEventError(`Event "${name}" is not declared by this game`);
                  }
                  if (!allowedEmits.has(name)) {
                    throw new GameEventError(`Scene "${sceneNameForTick}" cannot emit event "${name}" (missing from its emits list)`);
                  }
                  const cloned = cloneAndValidatePayload(payload, name, 'payload');
                  const envelope = Object.freeze({
                    name,
                    payload: cloned,
                    tick: nextTick,
                    scene: sceneNameForTick,
                    sceneTick: nextSceneTick,
                    ordinal: ordinal++,
                  }) as AnyGameEventEnvelope;
                  stagedThisTick.push(envelope);
                },
              }
            : (NO_EVENT_EMITTER as { emit(name: string, payload: unknown): void });
          if (hasEvents) {
            Object.freeze(emitter);
          }

          const sampleStart = diagnostics === undefined ? 0 : now();
          const input = inputBuffer.sample();
          if (diagnostics !== undefined) {
            diagnostics.onInputSample(now() - sampleStart);
          }
          const scope: UpdateScope = {};
          activeUpdateScope = scope;
          updateInProgress = true;
          const updateStart = diagnostics === undefined ? 0 : now();
          let nextState: unknown;
          try {
            nextState = freezeObject(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (activeScene.definition.update as any)({
                state: activeScene.state,
                input,
                transition: makeTransitionController(scope),
                events: emitter,
                tick: nextTick,
                sceneTick: nextSceneTick,
                deltaSeconds: fixedStepMs / 1000,
                elapsedSeconds: (nextTick * fixedStepMs) / 1000,
                sceneElapsedSeconds: (nextSceneTick * fixedStepMs) / 1000,
              }),
            );
          } catch (error) {
            // Update failed: discard staged events, invalidate emitter.
            stagedThisTick = [];
            emitterInvalidated = true;
            activeUpdateScope = undefined;
            updateInProgress = false;
            throw error;
          }
          emitterInvalidated = true;
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
            try {
              if (!commitTransition(intent, nextState, nextTick, true)) {
                return;
              }
            } catch (error) {
              // Transition preparation/disposal failed: discard staged events.
              stagedThisTick = [];
              throw error;
            }
            // Successful transition tick: staged events commit with source tick/scene.
            if (stagedThisTick.length > 0) {
              deliverEvents(stagedThisTick);
            }
            accumulatorMs = Math.max(0, accumulatorMs - fixedStepMs);
            catchUpSteps += 1;
            // F4: the transition consumed one fixed step; report it as such
            // and never as a zero-step callback (zero-step fires only when
            // no step ran at all).
            if (diagnostics !== undefined) {
              diagnostics.onFixedStep();
              if (catchUpSteps > 1) {
                diagnostics.onCatchUpStep();
              }
            }
            break;
          }
          const snapshotStart = diagnostics === undefined ? 0 : now();
          let rawSnapshot: unknown;
          try {
            rawSnapshot = activeScene.definition.snapshot({ state: nextState });
          } catch (error) {
            stagedThisTick = [];
            throw error;
          }
          if (diagnostics !== undefined) {
            diagnostics.onSnapshot(now() - snapshotStart);
          }
          const freezeStart = diagnostics === undefined ? 0 : now();
          let nextSnapshot: DeepReadonly<unknown>;
          try {
            nextSnapshot = deepFreeze(rawSnapshot, { scene: sceneNameForTick, tick: nextTick });
          } catch (error) {
            stagedThisTick = [];
            throw error;
          }
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
          // Successful tick: deliver staged events in tick order, then emission order.
          if (stagedThisTick.length > 0) {
            deliverEvents(stagedThisTick);
          }
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
        // A prepared external target is already authoritative even if its
        // first update fails. Publish its last successful snapshot as a cut
        // before pausing; preserve the simulation error if a listener fails.
        if (hardCutPending && !isDisposed()) {
          captureFailure(commit);
        }
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

      if (isDisposed()) {
        return;
      }
      if ((stepsRan || hardCutPending) && !publishedThisCallback) {
        // Coalesce due updates with a pending external transition. The cut
        // uses the latest target snapshot, never an earlier initial snapshot.
        commitOrPause();
      }
      if (status === 'running' && generation === activeGeneration) {
        scheduleSuccessor(activeGeneration);
      }
    });
  };

  const session: GameSession<TScenes, TInput, TEventDefs> = {
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
      if (sceneFaulted) {
        throw new GameSessionLifecycleError(
          'The active scene failed disposal and is explicitly non-resumable: ' +
            'replace it with setScene() or restartScene() before start(), or dispose the session.',
        );
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
      const pauseFailure = captureFailure(() => pauseInternal());
      // The command must complete: a pending external transition is resolved
      // at the pause boundary even when a status listener threw, so a later
      // start() can never commit a stale transition on an unexpected frame.
      const transitionFailure = captureFailure(() => {
        if (pendingTransition !== undefined) {
          const pending = pendingTransition;
          pendingTransition = undefined;
          if (commitTransition(pending, activeScene.state, undefined)) {
            commitOrPause();
          }
        }
      });
      throwFailures(pauseFailure, transitionFailure);
    },
    setScene(name: keyof TScenes) {
      assertLive();
      if (updateInProgress) {
        throw new GameSessionLifecycleError(
          'External scene transitions cannot be requested during a scene update',
        );
      }
      if (transitionInProgress) {
        throw new GameSessionLifecycleError(
          'External scene transitions cannot be requested during scene preparation or disposal',
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
      if (commitTransition({ kind: 'setScene', name: nameString }, activeScene.state, undefined)) {
        commitOrPause();
      }
    },
    restartScene() {
      assertLive();
      if (updateInProgress) {
        throw new GameSessionLifecycleError(
          'External scene transitions cannot be requested during a scene update',
        );
      }
      if (transitionInProgress) {
        throw new GameSessionLifecycleError(
          'External scene transitions cannot be requested during scene preparation or disposal',
        );
      }
      if (status === 'running') {
        requestPendingTransition({ kind: 'restart' });
        return;
      }
      if (commitTransition({ kind: 'restart' }, activeScene.state, undefined)) {
        commitOrPause();
      }
    },
    dispose() {
      if (status === 'disposed') {
        return;
      }
      generation += 1;
      const cancellationFailure = cancelPendingFrame();
      previousTimestampMs = undefined;
      accumulatorMs = 0;
      pendingTransition = undefined;
      inputBuffer.reset();
      eventListeners.clear();
      // Terminal cleanup is unconditional: `disposed` is delivered to the
      // full listener snapshot (including the re-entrant queued pass), then
      // every listener and the scene are released exactly once even when a
      // status listener throws. The release flag is set BEFORE the
      // notification so notifyStatus's finally performs the clear; for the
      // re-entrant path the clear happens after the queued pass drains.
      releaseStatusListeners = true;
      const notificationFailure = captureFailure(() => setStatus('disposed'));
      const cleanupFailure = captureFailure(() => {
        listeners = [];
        disposeSceneInstance(activeScene, activeScene.state);
      });
      throwFailures(cancellationFailure, notificationFailure, cleanupFailure);
    },
    getRenderFrame() {
      const alpha = commitFrame.hardCut
        ? 0
        : Math.max(0, Math.min(accumulatorMs / fixedStepMs, 1 - Number.EPSILON));
      return Object.freeze({ ...commitFrame, alpha }) as unknown as GameRenderFrame<TScenes>;
    },
    addCommitListener(listener) {
      assertLive();
      if (!listeners.includes(listener)) {
        listeners = [...listeners, listener];
      }
      let removed = false;
      return Object.freeze({
        remove() {
          if (removed) {
            return;
          }
          removed = true;
          listeners = listeners.filter((entry) => entry !== listener);
        },
      });
    },
    addStatusListener(listener) {
      assertLive();
      statusListeners.add(listener);
      diagnostics?.onStatusListenerCount?.(statusListeners.size);
      let removed = false;
      return Object.freeze({
        remove() {
          if (removed) {
            return;
          }
          removed = true;
          statusListeners.delete(listener);
          diagnostics?.onStatusListenerCount?.(statusListeners.size);
        },
      });
    },
    addGameEventListener: ((name: string, listener: (event: AnyGameEventEnvelope) => void | Promise<void>) => {
      assertLive();
      if (!hasEvents || !allowedEventNames.has(name)) {
        throw new GameEventError(`Event "${String(name)}" is not declared by this game`);
      }
      let set = eventListeners.get(name);
      if (set === undefined) {
        set = new Set();
        eventListeners.set(name, set);
      }
      set.add(listener as (event: AnyGameEventEnvelope) => void | Promise<void>);
      let removed = false;
      return Object.freeze({
        remove() {
          if (removed) {
            return;
          }
          removed = true;
          const existing = eventListeners.get(name);
          if (existing) {
            existing.delete(listener as (event: AnyGameEventEnvelope) => void | Promise<void>);
            if (existing.size === 0) {
              eventListeners.delete(name);
            }
          }
        },
      });
    }) as unknown as GameSession<TScenes, TInput, TEventDefs>['addGameEventListener'],
  };

  return Object.freeze(session);
}
