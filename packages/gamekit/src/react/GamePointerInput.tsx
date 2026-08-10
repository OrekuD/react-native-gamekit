import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, GestureStateManager, useManualGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import type { InputMap, PointerInputAction, SceneMap } from '../definition/types';
import type { GameSession } from '../core/session/types';
import { GameViewportContext } from './GameView';
import type { GamePointerInstrumentation } from './instrumentation';
import { isBeginAllowed } from './pointerContainment';
import { createPointerCoalescer, type CoalescedPointerEvent, type PointerCoalescer } from './pointerCoalescer';
import { createPointerBinding, type PointerBindingEntry } from './pointerBinding';

/** Declared pointer action names of an input map. */
type PointerActionName<TInput extends InputMap> = {
  [TName in Extract<keyof TInput, string>]: TInput[TName] extends PointerInputAction ? TName : never;
}[Extract<keyof TInput, string>];

/** Props for the pointer input adapter that covers the game surface. */
export interface GamePointerInputProps<TScenes extends SceneMap, TInput extends InputMap> {
  /** The session whose input buffer receives pointer events. */
  readonly game: GameSession<TScenes, TInput>;
  /** A declared pointer action on the game. */
  readonly action: PointerActionName<TInput>;
  /** Optional measurement callbacks for the Performance Lab (F1). */
  readonly instrumentation?: GamePointerInstrumentation;
}

interface BindingEntry<TScenes extends SceneMap, TInput extends InputMap, TName extends string>
  extends PointerBindingEntry<TName> {
  readonly game: GameSession<TScenes, TInput>;
  readonly viewportContext: unknown;
  readonly coalescer: PointerCoalescer;
  /** Bumped on layout revisions: the coalescer is recreated with fresh state. */
  readonly layoutRevision: number;
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
 * The binding and coalescer are recreated whenever the session, action, or
 * viewport context identity changes, and the previous binding is disposed.
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
  // A layout revision invalidates the transform under an active gesture. The
  // UI-side coalescer state cannot be reset from JS (the worklet holds its
  // own snapshot), so the revision bumps this value and the coalescer is
  // recreated with fresh state; the rebuilt gesture worklets capture it.
  const [layoutRevision, setLayoutRevision] = useState(0);

  const bindingRef = useRef<
    BindingEntry<TScenes, TInput, Extract<keyof TInput, string>> | null
  >(null);
  let entry = bindingRef.current;
  if (
    entry === null ||
    entry.game !== game ||
    entry.viewportContext !== viewportContext ||
    entry.layoutRevision !== layoutRevision
  ) {
    const result = createPointerBinding(
      { input: game.input, action, viewport: viewportContext },
      () => viewportContext.binding.resolved,
      entry ?? undefined,
    );
    entry = {
      ...result.entry,
      game,
      viewportContext,
      // One fixed step: the default maximum coalescing delay (T7).
      coalescer: createPointerCoalescer(game.getRenderFrame().stepMs),
      layoutRevision,
    };
    bindingRef.current = entry;
  }
  const binding = entry.binding;
  const coalescer = entry.coalescer;

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

  // RNGH 3 hook API: the config object is rebuilt per render (the hooks diff
  // it internally); the wrapped JS-thread handlers keep explicit 'worklet'
  // directives because useCallback wrapping defeats auto-workletization.
  const gesture = useManualGesture({
    onTouchesDown: (event) => {
      'worklet';
      const touch = event.changedTouches[0];
      if (touch === undefined) {
        return;
      }
      instrumentation?.onRawTouch?.('down', touch.id, Date.now());
      // UI-side containment mirror: an invalid layout or `fit` letterbox
      // begin fails the gesture before it activates. JS re-validates.
      if (!isBeginAllowed(viewportShared.value, touch.x, touch.y)) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      const batch = coalescer.down(touch.id, touch.x, touch.y, Date.now());
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
    onTouchesMove: (event) => {
      'worklet';
      for (const touch of event.changedTouches) {
        instrumentation?.onRawTouch?.('move', touch.id, Date.now());
        const batch = coalescer.move(touch.id, touch.x, touch.y, Date.now());
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
    onTouchesUp: (event) => {
      'worklet';
      for (const touch of event.changedTouches) {
        instrumentation?.onRawTouch?.('up', touch.id, Date.now());
        const batch = coalescer.up(touch.id, touch.x, touch.y, Date.now());
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
    onTouchesCancel: () => {
      'worklet';
      instrumentation?.onRawTouch?.('cancel', -1, Date.now());
      const batch = coalescer.cancel(Date.now());
      for (const forwarded of batch) {
        instrumentation?.onForwarded?.(forwarded.kind, -1, Date.now());
        scheduleOnRN(forwardEventOnJS, forwarded);
      }
    },
  });

  useEffect(() => {
    const unsubscribeLayout = viewportContext.binding.subscribe(() => {
      // A layout revision invalidates the transform under an active gesture:
      // cancel ownership here and recreate the coalescer (fresh UI state) —
      // stale queued movement dies with the old worklet closures.
      if (game.status !== 'disposed') {
        binding.cancel();
        setLayoutRevision((revision) => revision + 1);
      }
    });
    return () => {
      unsubscribeLayout();
      if (game.status !== 'disposed') {
        binding.cancel();
      }
      binding.dispose();
    };
  }, [binding, game, viewportContext]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} />
    </GestureDetector>
  );
}
