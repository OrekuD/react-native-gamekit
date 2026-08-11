import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  samplerMirrorFromBatch,
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
  bindingEpoch,
}: {
  readonly coalescerState: SharedValue<PointerCoalescerState>;
  readonly forwardEventOnJS: (packet: PointerPacket) => void;
  readonly instrumentation: GamePointerInstrumentation | undefined;
  readonly bindingEpoch: SharedValue<number>;
}) {
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
      scheduleOnRN(forwardEventOnJS, { ...forwarded, epoch: bindingEpoch.value });
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
  const viewportBinding = viewportContext.binding;
  // F6: the binding identity includes the declared action, the session input
  // controller, and the viewport owner; changing any of them recreates it.
  const binding = useMemo(
    () => new PointerBinding(action, game.input, () => viewportBinding.resolved),
    [action, game, viewportBinding],
  );
  // F6: UI-runtime mirror of the binding epoch. Every scheduled packet is
  // stamped with the epoch it was scheduled under; packets that were already
  // in flight when the epoch advanced are rejected on the RN runtime.
  const bindingEpoch = useSharedValue(binding.epoch);
  const bumpEpoch = useCallback(() => {
    binding.invalidate();
    bindingEpoch.value = binding.epoch;
  }, [binding, bindingEpoch]);

  // The mirror of the coalescer's ownership, set from the worklets on
  // touch boundaries through the samplerMirrorFromBatch helper.
  const reportPointerActive = useCallback((active: boolean) => {
    setPointerActive(active);
  }, []);

  // F2 review: `autostart` is only consulted at creation (changing it later
  // re-registers but never activates) and `setActive` from an effect proved
  // unreliable in this stack, so the sampler is a conditionally mounted
  // component (see TrailingFlushSampler): it mounts with autostart active
  // exactly while this mirror is true and unmounts when the pointer exits.
  const [pointerActive, setPointerActive] = useState(false);

  // JS-thread handler (never captured by gesture worklets): the binding
  // rejects packets stamped with a stale epoch (layout revision, binding
  // replacement, unmount) and re-validates the viewport before forwarding
  // into the session input buffer.
  const forwardEventOnJS = useCallback(
    (packet: PointerPacket) => {
      binding.dispatch(packet);
    },
    [binding],
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
        scheduleOnRN(forwardEventOnJS, { ...forwarded, epoch: bindingEpoch.value });
      }
      const nextActive = samplerMirrorFromBatch(batch);
      if (nextActive !== undefined) {
        scheduleOnRN(reportPointerActive, nextActive);
      }
      GestureStateManager.activate(event.handlerTag);
    },
    [bindingEpoch, coalescerState, forwardEventOnJS, instrumentation, reportPointerActive, viewportShared],
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
          scheduleOnRN(forwardEventOnJS, { ...forwarded, epoch: bindingEpoch.value });
        }
      }
    },
    [bindingEpoch, coalescerState, forwardEventOnJS, instrumentation],
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
          scheduleOnRN(forwardEventOnJS, { ...forwarded, epoch: bindingEpoch.value });
        }
        const mirror = samplerMirrorFromBatch(batch);
        if (mirror !== undefined) {
          nextActive = mirror;
        }
      }
      if (nextActive !== undefined) {
        scheduleOnRN(reportPointerActive, nextActive);
      }
      if (deactivateAfterUp(event.numberOfTouches)) {
        GestureStateManager.deactivate(event.handlerTag);
      }
    },
    [bindingEpoch, coalescerState, forwardEventOnJS, instrumentation, reportPointerActive],
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
        scheduleOnRN(forwardEventOnJS, { ...forwarded, epoch: bindingEpoch.value });
      }
      const nextActive = samplerMirrorFromBatch(batch);
      if (nextActive !== undefined) {
        scheduleOnRN(reportPointerActive, nextActive);
      }
    },
    [bindingEpoch, coalescerState, forwardEventOnJS, instrumentation, reportPointerActive],
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
        scheduleOnRN(forwardEventOnJS, { ...forwarded, epoch: bindingEpoch.value });
      }
      const nextActive = samplerMirrorFromBatch(batch);
      if (nextActive !== undefined) {
        scheduleOnRN(reportPointerActive, nextActive);
      }
    },
    [bindingEpoch, coalescerState, forwardEventOnJS, instrumentation, reportPointerActive],
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
    // F6: a layout revision advances the epoch so queued packets from the
    // old layout die on arrival, while the active gesture keeps flowing
    // (the binding reads the viewport lazily and the coalescer state is
    // preserved) — rotation and split-view resizing keep working mid-drag.
    const unsubscribeLayout = viewportBinding.subscribe(() => {
      bumpEpoch();
    });
    return () => {
      unsubscribeLayout();
      // Unmount: bump the epoch BEFORE cancellation so packets already in
      // flight become harmless no-ops, then release the recognizer state.
      bumpEpoch();
      if (game.status !== 'disposed') {
        binding.cancel();
      }
      coalescerState.value = createPointerCoalescerState(maxMoveIntervalMs);
      binding.dispose();
    };
  }, [binding, bindingEpoch, bumpEpoch, coalescerState, game, maxMoveIntervalMs, viewportBinding]);

  // F6 review: when the binding is replaced (session, action, or viewport
  // owner changed), the replacement starts at epoch 0 while this cleanup's
  // bump left the shared mirror at 1. Re-sync the mirror to the replacement
  // binding — declared after the lifecycle effect so it runs after the
  // previous binding's cleanup — otherwise every new packet is stamped 1
  // and rejected, killing pointer input until the next layout revision.
  useEffect(() => {
    bindingEpoch.value = binding.epoch;
  }, [binding, bindingEpoch]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} />
      {pointerActive ? (
        <TrailingFlushSampler
          coalescerState={coalescerState}
          forwardEventOnJS={forwardEventOnJS}
          instrumentation={instrumentation}
          bindingEpoch={bindingEpoch}
        />
      ) : null}
    </GestureDetector>
  );
}
