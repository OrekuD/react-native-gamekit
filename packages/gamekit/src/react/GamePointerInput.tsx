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

import type { InputMap, PointerInputAction, SceneMap } from '../definition/types';
import type { GameSession } from '../core/session/types';
import { GameViewportContext } from './GameView';
import {
  canBeginPrimaryPointer,
  cancelOnActiveFinalize,
  deactivateAfterUp,
  reduceSamplerMirrorState,
  samplerMirrorFromBatch,
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
import { PointerBinding, type PointerPacket } from './pointerBinding';

/** Declared pointer action names of an input map. */
type PointerActionName<TInput extends InputMap> = {
  [TName in Extract<keyof TInput, string>]: TInput[TName] extends PointerInputAction ? TName : never;
}[Extract<keyof TInput, string>];

/** Monotonic adapter-owned binding generation; never resets to zero (F3). */
let nextBindingGeneration = 1;

type ManualTouchHandler = NonNullable<ManualGestureConfig['onTouchesDown']>;
type ManualFinalizeHandler = NonNullable<ManualGestureConfig['onFinalize']>;

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
}: {
  readonly coalescerState: SharedValue<PointerCoalescerState>;
  readonly forwardEventOnJS: (packet: PointerPacket) => void;
  readonly instrumentation: GamePointerInstrumentation | undefined;
  readonly layoutEpoch: SharedValue<number>;
  readonly forwardSeq: SharedValue<number>;
  readonly generation: number;
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

  useFrameCallback(() => {
    'worklet';
    const batch = advanceSharedCoalescer(coalescerState, {
      kind: 'flush',
      nowMs: Date.now(),
    });
    for (const forwarded of batch) {
      instrumentation?.onForwarded?.(
        forwarded.kind,
        'pointerId' in forwarded ? forwarded.pointerId : -1,
        Date.now(),
      );
      forwardSeq.value += 1;
      scheduleOnRN(forwardEventOnJS, {
        ...forwarded,
        generation,
        layoutEpoch: layoutEpoch.value,
        seq: forwardSeq.value,
        atMs: Date.now(),
      });
    }
  });
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
  const viewportShared = viewportContext.viewport;
  const maxMoveIntervalMs = game.getRenderFrame().stepMs;
  const coalescerState = useSharedValue<PointerCoalescerState>(() =>
    createPointerCoalescerState(maxMoveIntervalMs),
  );
  // T10.4: the pause transition clears the UI-side coalescer queue for the
  // active stream (the core input buffer already cancelled ownership), so a
  // pre-pause pointer can never flush stale moves after resume. The gesture
  // itself is not remounted and its key does not change.
  useEffect(() => {
    if (game.status === 'disposed') {
      return;
    }
    const subscription = game.addStatusListener((status) => {
      if (status === 'paused') {
        coalescerState.value = createPointerCoalescerState(maxMoveIntervalMs);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [coalescerState, game, maxMoveIntervalMs]);
  const viewportBinding = viewportContext.binding;
  // F3 follow-up: the binding identity includes the declared action, the
  // session input controller, and the viewport owner; changing any of them
  // creates a fresh binding stamped with a NEW monotonic generation that
  // never resets to zero. The worklet closures created in the same render
  // stamp packets with that same generation, so the packet producer and
  // consumer agree by construction — no post-commit synchronization.
  const binding = useMemo(
    () => new PointerBinding(action, game.input, () => viewportBinding.resolved, nextBindingGeneration++),
    [action, game, viewportBinding],
  );
  const generation = binding.generation;
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

  // F2 follow-up: the sampler mirror is keyed by binding generation, so a
  // replacement binding is inactive by construction and a stale terminal
  // edge from an older generation can never alter the current generation's
  // sampler state.
  const [samplerState, setSamplerState] = useState<SamplerMirrorState>({
    generation: -1,
    active: false,
  });
  const reportSamplerState = useCallback(
    (next: SamplerMirrorState) => {
      setSamplerState((previous) =>
        reduceSamplerMirrorState(generation, previous, next),
      );
    },
    [generation],
  );

  // F2 review: `autostart` is only consulted at creation (changing it later
  // re-registers but never activates) and `setActive` from an effect proved
  // unreliable in this stack, so the sampler is a conditionally mounted
  // component (see TrailingFlushSampler): it mounts with autostart active
  // exactly while this mirror is true and unmounts when the pointer exits.

  // JS-thread handler (never captured by gesture worklets): the binding
  // rejects packets stamped with a stale epoch (layout revision, binding
  // replacement, unmount) and re-validates the viewport before forwarding
  // into the session input buffer.
  const forwardEventOnJS = useCallback(
    (packet: PointerPacket) => {
      // F6/F3: adapter-owned layout epoch — packets scheduled under an older
      // layout die here, before the binding sees them.
      if (packet.layoutEpoch !== layoutEpochRef.current) {
        instrumentation?.onDispatchResult?.(packet.seq, packet.atMs, false);
        return;
      }
      const accepted = binding.dispatch(packet);
      instrumentation?.onDispatchResult?.(packet.seq, packet.atMs, accepted);
    },
    [binding, instrumentation],
  );

  const handleTouchesDown = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      const touch = event.changedTouches[0];
      if (touch === undefined) {
        return;
      }
      instrumentation?.onRawTouch?.('down', touch.id, Date.now());
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
        nowMs: Date.now(),
      });
      for (const forwarded of batch) {
        instrumentation?.onForwarded?.(
          forwarded.kind,
          'pointerId' in forwarded ? forwarded.pointerId : -1,
          Date.now(),
        );
        forwardSeq.value += 1;
        scheduleOnRN(forwardEventOnJS, {
          ...forwarded,
          generation,
          layoutEpoch: layoutEpoch.value,
          seq: forwardSeq.value,
          atMs: Date.now(),
        });
      }
      const nextActive = samplerMirrorFromBatch(batch);
      if (nextActive !== undefined) {
        scheduleOnRN(reportSamplerState, { generation, active: nextActive });
      }
      GestureStateManager.activate(event.handlerTag);
    },
    [coalescerState, forwardEventOnJS, generation, instrumentation, layoutEpoch, reportSamplerState, viewportShared],
  );

  const handleTouchesMove = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      for (const touch of event.changedTouches) {
        instrumentation?.onRawTouch?.('move', touch.id, Date.now());
        const batch = advanceSharedCoalescer(coalescerState, {
          kind: 'move',
          pointerId: touch.id,
          x: touch.x,
          y: touch.y,
          nowMs: Date.now(),
        });
        for (const forwarded of batch) {
          instrumentation?.onForwarded?.(
            forwarded.kind,
            'pointerId' in forwarded ? forwarded.pointerId : -1,
            Date.now(),
          );
          forwardSeq.value += 1;
        scheduleOnRN(forwardEventOnJS, {
          ...forwarded,
          generation,
          layoutEpoch: layoutEpoch.value,
          seq: forwardSeq.value,
          atMs: Date.now(),
        });
        }
      }
    },
    [coalescerState, forwardEventOnJS, generation, instrumentation, layoutEpoch],
  );

  const handleTouchesUp = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      let nextActive: boolean | undefined;
      for (const touch of event.changedTouches) {
        instrumentation?.onRawTouch?.('up', touch.id, Date.now());
        const batch = advanceSharedCoalescer(coalescerState, {
          kind: 'up',
          pointerId: touch.id,
          x: touch.x,
          y: touch.y,
          nowMs: Date.now(),
        });
        for (const forwarded of batch) {
          instrumentation?.onForwarded?.(
            forwarded.kind,
            'pointerId' in forwarded ? forwarded.pointerId : -1,
            Date.now(),
          );
          forwardSeq.value += 1;
        scheduleOnRN(forwardEventOnJS, {
          ...forwarded,
          generation,
          layoutEpoch: layoutEpoch.value,
          seq: forwardSeq.value,
          atMs: Date.now(),
        });
        }
        const mirror = samplerMirrorFromBatch(batch);
        if (mirror !== undefined) {
          nextActive = mirror;
        }
      }
      if (nextActive !== undefined) {
        scheduleOnRN(reportSamplerState, { generation, active: nextActive });
      }
      if (deactivateAfterUp(event.numberOfTouches)) {
        GestureStateManager.deactivate(event.handlerTag);
      }
    },
    [coalescerState, forwardEventOnJS, generation, instrumentation, layoutEpoch, reportSamplerState],
  );

  const handleTouchesCancel = useCallback<ManualTouchHandler>(
    () => {
      'worklet';
      instrumentation?.onRawTouch?.('cancel', -1, Date.now());
      const batch = advanceSharedCoalescer(coalescerState, {
        kind: 'cancel',
        nowMs: Date.now(),
      });
      for (const forwarded of batch) {
        instrumentation?.onForwarded?.(forwarded.kind, -1, Date.now());
        forwardSeq.value += 1;
        scheduleOnRN(forwardEventOnJS, {
          ...forwarded,
          generation,
          layoutEpoch: layoutEpoch.value,
          seq: forwardSeq.value,
          atMs: Date.now(),
        });
      }
      const nextActive = samplerMirrorFromBatch(batch);
      if (nextActive !== undefined) {
        scheduleOnRN(reportSamplerState, { generation, active: nextActive });
      }
    },
    [coalescerState, forwardEventOnJS, generation, instrumentation, layoutEpoch, reportSamplerState],
  );

  const handleFinalize = useCallback<ManualFinalizeHandler>(
    () => {
      'worklet';
      if (!cancelOnActiveFinalize(coalescerState.value.active?.pointerId)) {
        return;
      }
      instrumentation?.onRawTouch?.('cancel', -1, Date.now());
      const batch = advanceSharedCoalescer(coalescerState, {
        kind: 'cancel',
        nowMs: Date.now(),
      });
      for (const forwarded of batch) {
        instrumentation?.onForwarded?.(forwarded.kind, -1, Date.now());
        forwardSeq.value += 1;
        scheduleOnRN(forwardEventOnJS, {
          ...forwarded,
          generation,
          layoutEpoch: layoutEpoch.value,
          seq: forwardSeq.value,
          atMs: Date.now(),
        });
      }
      const nextActive = samplerMirrorFromBatch(batch);
      if (nextActive !== undefined) {
        scheduleOnRN(reportSamplerState, { generation, active: nextActive });
      }
    },
    [coalescerState, forwardEventOnJS, generation, instrumentation, layoutEpoch, reportSamplerState],
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
    // F6/F3: a layout revision advances the adapter-owned layout epoch so
    // queued old-layout packets die on arrival, while the active gesture
    // keeps flowing (the binding reads the viewport lazily and the
    // coalescer state is preserved). Binding replacement needs no epoch
    // synchronization: the generation agreement is by construction.
    const unsubscribeLayout = viewportBinding.subscribe(() => {
      bumpLayoutEpoch();
    });
    return () => {
      unsubscribeLayout();
      // Unmount or replacement: bump the layout epoch so packets already in
      // flight become harmless no-ops, neutralize old input ownership exactly
      // once, reset the coalescer, remove the old sampler (generation
      // mismatch makes it inactive by construction), and dispose the binding.
      bumpLayoutEpoch();
      setSamplerState({ generation: -1, active: false });
      if (game.status !== 'disposed') {
        binding.cancel();
      }
      coalescerState.value = createPointerCoalescerState(maxMoveIntervalMs);
      binding.dispose();
    };
  }, [
    binding,
    bumpLayoutEpoch,
    coalescerState,
    game,
    layoutEpoch,
    maxMoveIntervalMs,
    viewportBinding,
  ]);

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
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}
