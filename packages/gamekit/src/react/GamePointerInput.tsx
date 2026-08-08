import { useCallback, useContext, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, GestureStateManager, useManualGesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import type { InputMap, PointerInputAction, SceneMap } from '../definition/types';
import type { GameSession } from '../core/session/types';
import { GameViewportContext } from './GameView';
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
}

interface BindingEntry<TScenes extends SceneMap, TInput extends InputMap, TName extends string>
  extends PointerBindingEntry<TName> {
  readonly game: GameSession<TScenes, TInput>;
  readonly viewportContext: unknown;
}

/**
 * Bind one primary pointer to a declared pointer action.
 *
 * Gesture Handler is an implementation detail: the manual gesture activates
 * explicitly on touch down, forwards plain touch data to JS-thread handlers
 * via `runOnJS`, and ends explicitly when the last touch lifts. The handlers
 * convert positions through the viewport owned by `GameView` into logical
 * world coordinates; the session input buffer owns pointer ownership.
 *
 * The binding is recreated whenever the session, action, or viewport context
 * identity changes, and the previous binding is disposed.
 */
export function GamePointerInput<TScenes extends SceneMap, TInput extends InputMap>({
  game,
  action,
}: GamePointerInputProps<TScenes, TInput>) {
  const viewportContext = useContext(GameViewportContext);

  if (viewportContext === null) {
    throw new Error('GamePointerInput must be rendered inside a GameView');
  }

  const bindingRef = useRef<
    BindingEntry<TScenes, TInput, Extract<keyof TInput, string>> | null
  >(null);
  let entry = bindingRef.current;
  if (entry === null || entry.game !== game || entry.viewportContext !== viewportContext) {
    const result = createPointerBinding(
      { input: game.input, action, viewport: viewportContext },
      () => viewportContext.resolved,
      entry ?? undefined,
    );
    entry = {
      ...result.entry,
      game,
      viewportContext,
    };
    bindingRef.current = entry;
  }
  const binding = entry.binding;

  // JS-thread handlers (never captured by gesture worklets).
  const beginOnJS = useCallback(
    (pointerId: number, x: number, y: number) => {
      binding.handleTouchesDown(pointerId, x, y);
    },
    [binding],
  );
  const moveOnJS = useCallback(
    (pointerId: number, x: number, y: number) => {
      binding.handleTouchesMove(pointerId, x, y);
    },
    [binding],
  );
  const upOnJS = useCallback(
    (pointerId: number, x: number, y: number) => {
      binding.handleTouchesUp(pointerId, x, y);
    },
    [binding],
  );
  const cancelOnJS = useCallback(() => {
    binding.handleTouchesCancelled();
  }, [binding]);

  // RNGH 3 hook API: the config object is rebuilt per render (the hooks diff
  // it internally); the wrapped JS-thread callbacks keep explicit 'worklet'
  // directives because useCallback wrapping defeats auto-workletization.
  const gesture = useManualGesture({
    onTouchesDown: (event) => {
      'worklet';
      GestureStateManager.activate(event.handlerTag);
      for (const touch of event.changedTouches) {
        runOnJS(beginOnJS)(touch.id, touch.x, touch.y);
      }
    },
    onTouchesMove: (event) => {
      'worklet';
      for (const touch of event.changedTouches) {
        runOnJS(moveOnJS)(touch.id, touch.x, touch.y);
      }
    },
    onTouchesUp: (event) => {
      'worklet';
      for (const touch of event.changedTouches) {
        runOnJS(upOnJS)(touch.id, touch.x, touch.y);
      }
      if (event.numberOfTouches === 0) {
        GestureStateManager.deactivate(event.handlerTag);
      }
    },
    onTouchesCancel: () => {
      'worklet';
      runOnJS(cancelOnJS)();
    },
  });

  useEffect(() => {
    const unsubscribeLayout = viewportContext.subscribe(() => {
      // A layout revision invalidates the transform under an active gesture.
      if (game.status !== 'disposed') {
        binding.cancel();
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
