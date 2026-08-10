import { useCallback, useContext, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  GestureStateManager,
  useManualGesture,
  type ManualGestureConfig,
} from 'react-native-gesture-handler';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { InputMap, PointerInputAction, SceneMap } from '../definition/types';
import type { GameSession } from '../core/session/types';
import { GameViewportContext } from './GameView';
import {
  canBeginPrimaryPointer,
  cancelOnActiveFinalize,
  deactivateAfterUp,
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
import { PointerBinding } from './pointerBinding';

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
  const binding = useMemo(
    () => new PointerBinding(action, game.input, () => viewportBinding.resolved),
    [action, game, viewportBinding],
  );

  // JS-thread handler (never captured by gesture worklets): dispatch one
  // coalesced event into the binding, which re-validates against the viewport
  // and forwards into the session input buffer.
  const forwardEventOnJS = useCallback(
    (event: CoalescedPointerEvent) => {
      if (event.kind === 'begin') {
        binding.handleTouchesDown(event.pointerId, event.x, event.y);
      } else if (event.kind === 'move') {
        binding.handleTouchesMove(event.pointerId, event.x, event.y);
      } else if (event.kind === 'end') {
        binding.handleTouchesUp(event.pointerId, event.x, event.y);
      } else {
        binding.handleTouchesCancelled();
      }
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
        scheduleOnRN(forwardEventOnJS, forwarded);
      }
      GestureStateManager.activate(event.handlerTag);
    },
    [coalescerState, forwardEventOnJS, instrumentation, viewportShared],
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
          scheduleOnRN(forwardEventOnJS, forwarded);
        }
      }
    },
    [coalescerState, forwardEventOnJS, instrumentation],
  );

  const handleTouchesUp = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
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
          scheduleOnRN(forwardEventOnJS, forwarded);
        }
      }
      if (deactivateAfterUp(event.numberOfTouches)) {
        GestureStateManager.deactivate(event.handlerTag);
      }
    },
    [coalescerState, forwardEventOnJS, instrumentation],
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
        scheduleOnRN(forwardEventOnJS, forwarded);
      }
    },
    [coalescerState, forwardEventOnJS, instrumentation],
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
        scheduleOnRN(forwardEventOnJS, forwarded);
      }
    },
    [coalescerState, forwardEventOnJS, instrumentation],
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
    // PointerBinding reads the latest viewport lazily, so a layout revision
    // should not cancel an in-flight drag. Cleanup still cancels on unmount.
    return () => {
      if (game.status !== 'disposed') {
        binding.cancel();
      }
      coalescerState.value = createPointerCoalescerState(maxMoveIntervalMs);
      binding.dispose();
    };
  }, [binding, coalescerState, game, maxMoveIntervalMs]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} />
    </GestureDetector>
  );
}
