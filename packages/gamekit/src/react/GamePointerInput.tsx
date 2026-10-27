import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  GestureStateManager,
  useManualGesture,
  type ManualGestureConfig,
} from 'react-native-gesture-handler';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { CameraCut2D } from '../camera2d';
import type { InputMap, PointerInputAction, SceneMap } from '../definition/types';
import type { GameSession } from '../core/session/types';
import { GameCameraContext, GameViewportContext } from './GameView';
import {
  canBeginPrimaryPointer,
  cancelOnActiveFinalize,
  deactivateAfterUp,
  type SamplerMirrorState,
} from './gestureLifecycle';
import type { GamePointerInstrumentation } from './instrumentation';
import { isBeginAllowed } from './pointerContainment';
import {
  createPointerCoalescerState,
  reducePointerCoalescer,
  type CoalescedPointerEvent,
  type PointerCoalescerInput,
  type PointerCoalescerState,
} from './pointerCoalescer';
import { packetCameraFor, type PointerCameraCapture2D } from './pointerCamera';
import { PointerBinding, type PointerPacket } from './pointerBinding';
import { createCleanupList } from './cleanupList';

/** Declared pointer action names of an input map. */
type PointerActionName<TInput extends InputMap> = {
  [TName in Extract<keyof TInput, string>]: TInput[TName] extends PointerInputAction ? TName : never;
}[Extract<keyof TInput, string>];

/** Monotonic adapter-owned binding generation; never resets to zero (F3). */
let nextBindingGeneration = 1;

type ManualTouchHandler = NonNullable<ManualGestureConfig['onTouchesDown']>;
type ManualFinalizeHandler = NonNullable<ManualGestureConfig['onFinalize']>;
type PointerUiOwner = { readonly generation: number; readonly enabled: boolean };

/** Props for the pointer input adapter that covers the game surface. */
export interface GamePointerInputProps<TScenes extends SceneMap, TInput extends InputMap> {
  /** The session whose input buffer receives pointer events. */
  readonly game: GameSession<TScenes, TInput>;
  /** A declared pointer action on the game. */
  readonly action: PointerActionName<TInput>;
  /** Optional measurement callbacks for the Performance Lab (F1). */
  readonly instrumentation?: GamePointerInstrumentation;
}

function advanceSharedCoalescer(
  sharedState: SharedValue<PointerCoalescerState>,
  input: PointerCoalescerInput,
): readonly CoalescedPointerEvent[] {
  'worklet';
  const transition = reducePointerCoalescer(sharedState.value, input);
  sharedState.value = transition.state;
  return transition.events;
}

/**
 * F2 trailing-flush sampler (review fix).
 *
 * Mounted only while the coalescer owns a pointer: the frame callback starts
 * active at creation (autostart), forwards a deferred trailing move whenever
 * the flush interval elapses, and the component unmounts — unregistering the
 * callback — when the final pointer exits. No permanent frame callback and
 * no runtime activation calls.
 */
function TrailingFlushSampler({
  coalescerState,
  forwardEventOnJS,
  instrumentation,
  layoutEpoch,
  forwardSeq,
  generation,
  camera,
  uiOwner,
}: {
  readonly coalescerState: SharedValue<PointerCoalescerState>;
  readonly forwardEventOnJS: (packet: PointerPacket) => void;
  readonly instrumentation: GamePointerInstrumentation | undefined;
  readonly layoutEpoch: SharedValue<number>;
  readonly forwardSeq: SharedValue<number>;
  readonly generation: number;
  readonly uiOwner: SharedValue<PointerUiOwner>;
  /** The presented camera shared value, sampled at flush time (T12-F4). */
  readonly camera: SharedValue<CameraCut2D | undefined> | undefined;
}) {
  // F2 acceptance: report the sampler's mounted lifecycle so the lab can
  // prove no idle frame callback survives pointer exit, replacement, or
  // screen close/reopen.
  const instrumentationRef = useRef(instrumentation);
  useEffect(() => {
    instrumentationRef.current?.onSamplerChanged?.(true);
    return () => {
      instrumentationRef.current?.onSamplerChanged?.(false);
    };
  }, []);

  const onForwarded = instrumentation?.onForwarded;
  const flush = useCallback(() => {
    'worklet';
    if (uiOwner.value.generation !== generation || !uiOwner.value.enabled) {
      return;
    }
    const nowMs = Date.now();
    const batch = advanceSharedCoalescer(coalescerState, {
      kind: 'flush',
      nowMs,
    });
    for (const forwarded of batch) {
      onForwarded?.(
        forwarded.kind,
        'pointerId' in forwarded ? forwarded.pointerId : -1,
        nowMs,
      );
      forwardSeq.value += 1;
      scheduleOnRN(forwardEventOnJS, {
        ...forwarded,
        generation,
        layoutEpoch: layoutEpoch.value,
        seq: forwardSeq.value,
        atMs: nowMs,
        // The deferred move carries the stamp captured at ITS native
        // sample (T12-RF3, T12-SF1) — never the flush-time camera, and a
        // captured undefined stays undefined.
        camera: packetCameraFor(forwarded, camera?.value),
      });
    }
  }, [camera, coalescerState, forwardEventOnJS, forwardSeq, generation, layoutEpoch, onForwarded, uiOwner]);
  useFrameCallback(flush);
  return null;
}

/**
 * Bind one primary pointer to a declared pointer action.
 *
 * Gesture Handler is an implementation detail: the manual gesture activates
 * explicitly on touch down, mirrors the letterbox containment check on the UI
 * runtime (failing the gesture before activation), forwards plain touch data
 * through a coalescer that crosses runtimes at most once per fixed step
 * (latest dirty position only; edges never throttled or dropped), and ends
 * explicitly when the last touch lifts. Ownership and edge sampling stay
 * authoritative in the session input buffer, which re-validates every
 * forwarded event on the JS side.
 *
 * All separately registered touch-handler worklets share one explicit
 * coalescer SharedValue; closure-local mutation is not used because each
 * handler can receive its own serialized closure copy. The binding is stable
 * across ordinary React renders and is recreated only when its semantic
 * session, action, or viewport owner changes.
 */
export function GamePointerInput<TScenes extends SceneMap, TInput extends InputMap>({
  game,
  action,
  instrumentation,
}: GamePointerInputProps<TScenes, TInput>) {
  const viewportContext = useContext(GameViewportContext);

  if (viewportContext === null) {
    throw new Error('GamePointerInput must be rendered inside a GameView');
  }
  // T12.4: the adapter discovers the presented camera from the mounted
  // surface (never a repeated prop), so renderer and input share the same
  // generation. Games without a camera get the exact current viewport path.
  const cameraContext = useContext(GameCameraContext);
  const presentedCamera = cameraContext?.presented;
  const viewportShared = viewportContext.viewport;
  const maxMoveIntervalMs = game.getRenderFrame().stepMs;
  const coalescerState = useSharedValue<PointerCoalescerState>(() =>
    createPointerCoalescerState(maxMoveIntervalMs),
  );
  const viewportBinding = viewportContext.binding;
  const cameraShared = presentedCamera;
  // A render-stable generation scopes UI callbacks. The binding itself is
  // created by the committed effect, so StrictMode can release and reacquire
  // it without reusing an already disposed object.
  const generation = useMemo(
    () => nextBindingGeneration++,
    [action, game, viewportBinding, cameraShared],
  );
  const bindingRef = useRef<{
    readonly binding: PointerBinding<Extract<keyof TInput, string>>;
    readonly synchronizeReset: () => void;
  } | undefined>(undefined);
  const uiOwner = useSharedValue<PointerUiOwner>({ generation: -1, enabled: false });
  // F6/F3: the layout epoch is adapter-owned (ref + UI mirror), bumped only
  // on layout revisions and unmount; it never resets, so replacement cannot
  // desynchronize it. The RN-side dispatch check rejects old-layout packets.
  const layoutEpochRef = useRef(0);
  const layoutEpoch = useSharedValue(0);
  const bumpLayoutEpoch = useCallback(() => {
    layoutEpochRef.current += 1;
    layoutEpoch.value = layoutEpochRef.current;
  }, [layoutEpoch]);
  // F1: monotonic forward sequence carried with every packet so the RN side
  // can attribute latency causally (never by reading a separate "latest").
  const forwardSeq = useSharedValue(0);
  // Keep RN-only instrumentation out of serialized worklet closures. The
  // committed ref also lets instrumentation change without retiring a drag.
  const onRawTouch = instrumentation?.onRawTouch;
  const onForwarded = instrumentation?.onForwarded;
  const instrumentationRef = useRef(instrumentation);
  useEffect(() => {
    instrumentationRef.current = instrumentation;
    bindingRef.current?.binding.setSampleListener(instrumentation?.onPointerSample);
  }, [instrumentation]);

  // F2 follow-up: the sampler mirror is keyed by binding generation, so a
  // replacement binding is inactive by construction and a stale terminal
  // edge from an older generation can never alter the current generation's
  // sampler state.
  const [samplerState, setSamplerState] = useState<SamplerMirrorState>({
    generation: -1,
    active: false,
  });
  // Sampler ownership travels with accepted begin/terminal packets. There is
  // no second queued callback that could revive a retired stream.

  // JS-thread handler (never captured by gesture worklets): the binding
  // rejects packets stamped with a stale epoch (layout revision, binding
  // replacement, unmount) and re-validates the viewport before forwarding
  // into the session input buffer.
  const forwardEventOnJS = useCallback(
    (packet: PointerPacket) => {
      const current = bindingRef.current;
      current?.synchronizeReset();
      const instrumentation = instrumentationRef.current;
      // Layout, pause, reset, and effect retirement all invalidate queued work.
      if (packet.layoutEpoch !== layoutEpochRef.current) {
        instrumentation?.onDispatchResult?.(packet.seq, packet.atMs, false);
        instrumentation?.onDispatchRejected?.('layout-epoch', packet.seq, packet.atMs);
        return;
      }
      const accepted =
        current !== undefined &&
        current.binding.generation === generation &&
        game.status !== 'paused' && game.status !== 'disposed' &&
        current.binding.dispatch(packet);
      if (accepted && packet.kind !== 'move') {
        const active = packet.kind === 'begin';
        setSamplerState((previous) =>
          previous.generation === generation && previous.active === active
            ? previous
            : { generation, active },
        );
      }
      instrumentation?.onDispatchResult?.(packet.seq, packet.atMs, accepted);
      if (!accepted) {
        instrumentation?.onDispatchRejected?.('binding', packet.seq, packet.atMs);
      }
    },
    [game, generation],
  );

  const handleTouchesDown = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      if (uiOwner.value.generation !== generation || !uiOwner.value.enabled) {
        return;
      }
      const touch = event.changedTouches[0];
      if (touch === undefined) {
        return;
      }
      const nowMs = Date.now();
      onRawTouch?.('down', touch.id, nowMs);
      // This adapter owns one primary pointer for the whole native gesture.
      // If another touch is already present, it cannot replace a pointer that
      // ended earlier while the manual recognizer is still active.
      if (!canBeginPrimaryPointer(event.numberOfTouches)) {
        return;
      }
      // UI-side containment mirror: an invalid layout or `fit` letterbox
      // begin fails the gesture before it activates. JS re-validates.
      if (!isBeginAllowed(viewportShared.value, touch.x, touch.y)) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      const batch = advanceSharedCoalescer(coalescerState, {
        kind: 'down',
        pointerId: touch.id,
        x: touch.x,
        y: touch.y,
        nowMs,
      });
      for (const forwarded of batch) {
        onForwarded?.(
          forwarded.kind,
          'pointerId' in forwarded ? forwarded.pointerId : -1,
          nowMs,
        );
        forwardSeq.value += 1;
        scheduleOnRN(forwardEventOnJS, {
          ...forwarded,
          generation,
          layoutEpoch: layoutEpoch.value,
          seq: forwardSeq.value,
          atMs: nowMs,
          camera: cameraShared?.value,
        });
      }
      GestureStateManager.activate(event.handlerTag);
    },
    [cameraShared, coalescerState, forwardEventOnJS, generation, onForwarded, onRawTouch, layoutEpoch, forwardSeq, uiOwner, viewportShared],
  );

  const handleTouchesMove = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      if (uiOwner.value.generation !== generation || !uiOwner.value.enabled) {
        return;
      }
      const nowMs = Date.now();
      for (const touch of event.changedTouches) {
        onRawTouch?.('move', touch.id, nowMs);
        const batch = advanceSharedCoalescer(coalescerState, {
          kind: 'move',
          pointerId: touch.id,
          x: touch.x,
          y: touch.y,
          nowMs,
          stamp: { captured: true, value: cameraShared?.value } satisfies PointerCameraCapture2D,
        });
        for (const forwarded of batch) {
          onForwarded?.(
            forwarded.kind,
            'pointerId' in forwarded ? forwarded.pointerId : -1,
            nowMs,
          );
          forwardSeq.value += 1;
          scheduleOnRN(forwardEventOnJS, {
            ...forwarded,
            generation,
            layoutEpoch: layoutEpoch.value,
            seq: forwardSeq.value,
            atMs: nowMs,
            camera: packetCameraFor(forwarded, cameraShared?.value),
          });
        }
      }
    },
    [cameraShared, coalescerState, forwardEventOnJS, generation, onForwarded, onRawTouch, layoutEpoch, forwardSeq, uiOwner],
  );

  const handleTouchesUp = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      if (uiOwner.value.generation !== generation || !uiOwner.value.enabled) {
        return;
      }
      const nowMs = Date.now();
      for (const touch of event.changedTouches) {
        onRawTouch?.('up', touch.id, nowMs);
        const batch = advanceSharedCoalescer(coalescerState, {
          kind: 'up',
          pointerId: touch.id,
          x: touch.x,
          y: touch.y,
          nowMs,
        });
        for (const forwarded of batch) {
          onForwarded?.(
            forwarded.kind,
            'pointerId' in forwarded ? forwarded.pointerId : -1,
            nowMs,
          );
          forwardSeq.value += 1;
          scheduleOnRN(forwardEventOnJS, {
            ...forwarded,
            generation,
            layoutEpoch: layoutEpoch.value,
            seq: forwardSeq.value,
            atMs: nowMs,
            camera: packetCameraFor(forwarded, cameraShared?.value),
          });
        }
      }
      if (deactivateAfterUp(event.numberOfTouches)) {
        GestureStateManager.deactivate(event.handlerTag);
      }
    },
    [cameraShared, coalescerState, forwardEventOnJS, generation, onForwarded, onRawTouch, layoutEpoch, forwardSeq, uiOwner],
  );

  const handleTouchesCancel = useCallback<ManualTouchHandler>(
    () => {
      'worklet';
      if (uiOwner.value.generation !== generation || !uiOwner.value.enabled) {
        return;
      }
      const nowMs = Date.now();
      onRawTouch?.('cancel', -1, nowMs);
      const batch = advanceSharedCoalescer(coalescerState, {
        kind: 'cancel',
        nowMs,
      });
      for (const forwarded of batch) {
        onForwarded?.(forwarded.kind, -1, nowMs);
        forwardSeq.value += 1;
        scheduleOnRN(forwardEventOnJS, {
          ...forwarded,
          generation,
          layoutEpoch: layoutEpoch.value,
          seq: forwardSeq.value,
          atMs: nowMs,
          camera: cameraShared?.value,
        });
      }
    },
    [cameraShared, coalescerState, forwardEventOnJS, generation, onForwarded, onRawTouch, layoutEpoch, forwardSeq, uiOwner],
  );

  const handleFinalize = useCallback<ManualFinalizeHandler>(
    () => {
      'worklet';
      if (uiOwner.value.generation !== generation || !uiOwner.value.enabled) {
        return;
      }
      if (!cancelOnActiveFinalize(coalescerState.value.active?.pointerId)) {
        return;
      }
      const nowMs = Date.now();
      onRawTouch?.('cancel', -1, nowMs);
      const batch = advanceSharedCoalescer(coalescerState, {
        kind: 'cancel',
        nowMs,
      });
      for (const forwarded of batch) {
        onForwarded?.(forwarded.kind, -1, nowMs);
        forwardSeq.value += 1;
        scheduleOnRN(forwardEventOnJS, {
          ...forwarded,
          generation,
          layoutEpoch: layoutEpoch.value,
          seq: forwardSeq.value,
          atMs: nowMs,
          camera: cameraShared?.value,
        });
      }
    },
    [cameraShared, coalescerState, forwardEventOnJS, generation, onForwarded, onRawTouch, layoutEpoch, forwardSeq, uiOwner],
  );

  // RNGH 3 re-registers its gesture callbacks whenever this config identity
  // changes. Keep both the config and its worklets stable across unrelated
  // React renders (for example, a score HUD update during a live drag).
  const gestureConfig = useMemo<ManualGestureConfig>(
    () => ({
      shouldCancelWhenOutside: false,
      onTouchesDown: handleTouchesDown,
      onTouchesMove: handleTouchesMove,
      onTouchesUp: handleTouchesUp,
      onTouchesCancel: handleTouchesCancel,
      onFinalize: handleFinalize,
    }),
    [
      handleFinalize,
      handleTouchesCancel,
      handleTouchesDown,
      handleTouchesMove,
      handleTouchesUp,
    ],
  );
  const gesture = useManualGesture(gestureConfig);

  useEffect(() => {
    let live = true;
    const binding = new PointerBinding(
      action, game.input, () => viewportBinding.resolved, generation,
      instrumentationRef.current?.onPointerSample,
    );
    let resetRevision = game.input.getResetRevision(action);
    const clearStream = () => {
      bumpLayoutEpoch();
      coalescerState.value = createPointerCoalescerState(maxMoveIntervalMs);
      setSamplerState((previous) =>
        previous.active ? { generation, active: false } : previous,
      );
    };
    const invalidate = () => {
      clearStream();
      if (game.status !== 'disposed') binding.cancel();
    };
    const synchronizeReset = () => {
      if (!live || game.status === 'disposed') return;
      const next = game.input.getResetRevision(action);
      if (next !== resetRevision) {
        resetRevision = next;
        invalidate();
      }
    };
    bindingRef.current = { binding, synchronizeReset };
    uiOwner.value = {
      generation,
      enabled: game.status !== 'paused' && game.status !== 'disposed',
    };

    const releases = createCleanupList();
    releases.add(() => {
      try {
        if (game.status !== 'disposed') binding.cancel();
      } finally {
        binding.dispose();
      }
    });
    const release = () => {
      if (!live) return;
      live = false;
      bindingRef.current = undefined;
      uiOwner.value = { generation: -1, enabled: false };
      clearStream();
      releases.releaseAll();
    };
    try {
      releases.add(viewportBinding.subscribe(() => {
        if (live) invalidate();
      }));
      if (game.status !== 'disposed') {
        const statusSubscription = game.addStatusListener((status) => {
          if (!live) return;
          const enabled = status !== 'paused' && status !== 'disposed';
          resetRevision = game.input.getResetRevision(action);
          uiOwner.value = { generation, enabled };
          if (!enabled) invalidate();
        });
        releases.add(() => { statusSubscription.remove(); });
        const commitSubscription = game.addCommitListener(synchronizeReset);
        releases.add(() => { commitSubscription.remove(); });
      }
    } catch (error) {
      try {
        release();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Pointer input setup and cleanup failed');
      }
      throw error;
    }
    return release;
  }, [action, bumpLayoutEpoch, coalescerState, game, generation, maxMoveIntervalMs, uiOwner, viewportBinding]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill}>
        {samplerState.active && samplerState.generation === generation ? (
          <TrailingFlushSampler
            coalescerState={coalescerState}
            forwardEventOnJS={forwardEventOnJS}
            instrumentation={instrumentation}
            layoutEpoch={layoutEpoch}
            forwardSeq={forwardSeq}
            generation={generation}
            camera={cameraShared}
            uiOwner={uiOwner}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}
