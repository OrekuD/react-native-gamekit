/**
 * Multitouch button pad (T20).
 *
 * The React surface over the headless button-pad controller
 * (`core/input/buttonPad`): compose any number of {@link GameButton} zones
 * inside a {@link GameButtonPad}; every active pointer is mapped to the zone
 * it covers and press/release edges flow into the session's declared button
 * actions. Unlike RN `Pressable`, simultaneous fingers on different buttons
 * all register — hold left/right and jump at the same time.
 *
 * Semantics carried over from the reference implementation:
 * - Release edges ALWAYS fire on touch up/cancel, so edge-triggered actions
 *   (a jump pulse) re-arm for the next press.
 * - A finger sliding between zones reassigns: release + press.
 * - Unmount releases every held action; no input outlives the pad.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, useManualGesture, type ManualGestureConfig } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import type { StyleProp, ViewStyle } from 'react-native';

import { createButtonPadController } from '../core/input/buttonPad';
import type { InputMap } from '../definition/types';
import type { SceneMap } from '../definition/types';
import type { GameSession } from '../core/session/types';

/** Declared button action names of an input map. */
export type ButtonActionName<TInput extends InputMap> = {
  [TName in Extract<keyof TInput, string>]: TInput[TName] extends { readonly type: 'button' }
    ? TName
    : never;
}[Extract<keyof TInput, string>];

interface ButtonPadContextValue {
  /** Register/refresh a zone rect measured by a mounted GameButton. */
  readonly setZone: (action: string, x: number, y: number, width: number, height: number) => void;
  /** Remove a zone (button unmounted). */
  readonly removeZone: (action: string) => void;
}

const ButtonPadContext = createContext<ButtonPadContextValue | null>(null);

function useButtonPadContext(): ButtonPadContextValue {
  const context = useContext(ButtonPadContext);
  if (context === null) {
    throw new Error('GameButton must be rendered inside a GameButtonPad');
  }
  return context;
}

export interface GameButtonPadProps<TScenes extends SceneMap, TInput extends InputMap> {
  /** The session whose input buffer receives button presses. */
  readonly game: GameSession<TScenes, TInput>;
  /** One or more {@link GameButton} zones (any layout). */
  readonly children?: ReactNode;
  /**
   * Container style layered over the default full-surface overlay. The pad
   * never draws and never blocks touches outside mounted GameButtons.
   */
  readonly style?: StyleProp<ViewStyle>;
  /** Extra hit area around every zone, in dp. Default 0. */
  readonly hitSlop?: number;
  /** Test id for the pad container. */
  readonly testID?: string;
}

/**
 * Map simultaneous multitouch zones onto declared button actions.
 *
 * The pad is an INVISIBLE FULL-SURFACE OVERLAY: it draws nothing and its
 * empty areas let touches pass through (`pointerEvents="box-none"`), so you
 * can render whatever React children you like underneath and position each
 * {@link GameButton} anywhere on screen — flex rows, corners, one thumb-zone
 * per side — with ordinary styles. Only the measured bounds of mounted
 * {@link GameButton} components capture touches; every other point falls
 * through to the content below.
 */
export function GameButtonPad<TScenes extends SceneMap, TInput extends InputMap>({
  game,
  children,
  style,
  hitSlop = 0,
  testID,
}: GameButtonPadProps<TScenes, TInput>) {
  const input = game.input as unknown as {
    press: (action: string) => void;
    release: (action: string) => void;
  };

  // Stable across renders: RNGH 3 re-registers gesture callbacks when the
  // config identity changes (same discipline as GamePointerInput).
  const controllerRef = useRef<ReturnType<typeof createButtonPadController> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createButtonPadController({ hitSlop });
  }

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      // No held input outlives the pad.
      for (const action of controller?.releaseAll() ?? []) {
        input.release(action);
      }
    };
  }, [input]);

  const context = useMemo<ButtonPadContextValue>(
    () => ({
      setZone: (action, x, y, width, height) => {
        controllerRef.current?.setZone(action, { x, y, width, height });
      },
      removeZone: (action) => {
        const released = controllerRef.current?.removeZone(action) ?? [];
        for (const actionReleased of released) {
          input.release(actionReleased);
        }
      },
    }),
    [input],
  );

  // JS-side handlers — called from the UI worklet via scheduleOnRN
  const onDownJS = useCallback(
    (event: { allTouches: readonly { id: number; x: number; y: number }[] }) => {
      const diff = controllerRef.current?.touchesDown(event.allTouches) ?? { pressed: [], released: [] };
      for (const action of diff.released) input.release(action);
      for (const action of diff.pressed) input.press(action);
    },
    [input],
  );
  const onMoveJS = useCallback(
    (event: { allTouches: readonly { id: number; x: number; y: number }[] }) => {
      const diff = controllerRef.current?.touchesMove(event.allTouches) ?? { pressed: [], released: [] };
      for (const action of diff.released) input.release(action);
      for (const action of diff.pressed) input.press(action);
    },
    [input],
  );
  const onUpJS = useCallback(
    (event: { changedTouches: readonly { id: number; x: number; y: number }[] }) => {
      const diff = controllerRef.current?.touchesUp(event.changedTouches) ?? { pressed: [], released: [] };
      for (const action of diff.released) input.release(action);
    },
    [input],
  );
  const onCancelJS = useCallback(
    (event: { changedTouches: readonly { id: number; x: number; y: number }[] }) => {
      const diff = controllerRef.current?.touchesCancel(event.changedTouches) ?? { pressed: [], released: [] };
      for (const action of diff.released) input.release(action);
    },
    [input],
  );

  type ManualTouchHandler = NonNullable<ManualGestureConfig['onTouchesDown']>;
  const handleTouchesDown = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      scheduleOnRN(onDownJS, event as never);
    },
    [onDownJS],
  );
  const handleTouchesMove = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      scheduleOnRN(onMoveJS, event as never);
    },
    [onMoveJS],
  );
  const handleTouchesUp = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      scheduleOnRN(onUpJS, event as never);
    },
    [onUpJS],
  );
  const handleTouchesCancel = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      scheduleOnRN(onCancelJS, event as never);
    },
    [onCancelJS],
  );

  const gestureConfig = useMemo<ManualGestureConfig>(
    () => ({
      shouldCancelWhenOutside: false,
      onTouchesDown: handleTouchesDown,
      onTouchesMove: handleTouchesMove,
      onTouchesUp: handleTouchesUp,
      onTouchesCancel: handleTouchesCancel,
    }),
    [handleTouchesCancel, handleTouchesDown, handleTouchesMove, handleTouchesUp],
  );
  const gesture = useManualGesture(gestureConfig);

  // When a style is provided the caller owns the layout (e.g. an
  // absolutely-positioned bottom row). Otherwise default to a full-surface
  // invisible overlay so buttons can be placed anywhere via their own
  // styles. Using a fallback instead of [absoluteFill, style] avoids the
  // "tall pad" bug where merging top:0 from absoluteFill with a bottom-
  // anchored row stretches the container to full height and vertically
  // centers its children in the middle of the screen.
  return (
    <GestureDetector gesture={gesture}>
      <View
        pointerEvents="box-none"
        style={style ?? StyleSheet.absoluteFill}
        testID={testID}
      >
        <ButtonPadContext.Provider value={context}>{children}</ButtonPadContext.Provider>
      </View>
    </GestureDetector>
  );
}

export interface GameButtonProps {
  /** The declared button action this zone presses. */
  readonly action: string;
  /** Zone content (label, icon, art). */
  readonly children?: ReactNode;
  /** Zone layout + presentation styles. */
  readonly style?: StyleProp<ViewStyle>;
  /** Test id for end-to-end tests. */
  readonly testID?: string;
  /** Accessibility role announced to the OS. */
  readonly accessibilityRole?: 'button';
}

/**
 * One touch zone of the pad. Layout it however you like; its measured bounds
 * become the multitouch hit area for `action`.
 */
export function GameButton({ action, children, style, testID, accessibilityRole }: GameButtonProps) {
  const context = useButtonPadContext();
  return (
    <View
      style={style}
      testID={testID}
      accessibilityRole={accessibilityRole}
      onLayout={(event) => {
        const layout = event.nativeEvent.layout;
        context.setZone(action, layout.x, layout.y, layout.width, layout.height);
      }}
    >
      {children}
    </View>
  );
}
