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
 *
 * GS-INPUT-03: zones measure into pad coordinates (never parent-relative),
 * every mounted zone has an owner identity with idempotent cleanup, and
 * terminal cleanup never touches a disposed session.
 * GS-INPUT-04: one invalidation policy — pause, session replacement, and
 * unmount bump an ownership generation stamped onto every scheduled RN
 * callback; stale callbacks die at ingress, pad ownership clears, and a
 * fresh down is required before moves can acquire again.
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
import { findNodeHandle, StyleSheet, View } from 'react-native';
import { GestureDetector, useManualGesture, type ManualGestureConfig } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
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
  /**
   * Register/refresh a zone rect with its owner node. Provisional rects
   * come from layout events; pad-space measurement overwrites them.
   */
  readonly setZone: (
    action: string,
    x: number,
    y: number,
    width: number,
    height: number,
    node: unknown,
  ) => void;
  /**
   * Authoritatively measure a zone into pad coordinates. No-op when native
   * nodes are unavailable (the provisional layout registration stands).
   */
  readonly measureZone: (action: string, node: unknown) => void;
  /** Remove a zone (button unmounted or action replaced). */
  readonly removeZone: (action: string, node: unknown) => void;
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

/** A host node measurable against the pad container. */
interface MeasurableNode {
  measureLayout(
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail: () => void,
  ): void;
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
  const padRef = useRef<View | null>(null);
  // The zone context must stay identical across session replacements:
  // zones belong to mounted buttons, not to sessions, so a game change
  // must never tear down and re-register them (no layout event would
  // restore them). Session/input reads below always use the live values.
  const sessionRef = useRef({ game, input });
  sessionRef.current = { game, input };

  // Stable across renders: RNGH 3 re-registers gesture callbacks when the
  // config identity changes (same discipline as GamePointerInput).
  const controllerRef = useRef<ReturnType<typeof createButtonPadController> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createButtonPadController({ hitSlop });
  }
  // GS-INPUT-03: owner identity per mounted zone. A second mounted button
  // claiming the same action is a contract violation; re-registration by
  // the owning node (re-layout, re-measure) is idempotent.
  const ownersRef = useRef(new Map<string, unknown>());
  // GS-INPUT-04: ownership generation — bumped on pause, session
  // replacement, and unmount; stamped onto every scheduled RN callback and
  // checked at ingress so stale callbacks die instead of pressing a dead
  // session or a replaced binding.
  const generationRef = useRef(1);
  const generationSV = useSharedValue(1);

  const liveInput = useCallback((): {
    press: (action: string) => void;
    release: (action: string) => void;
  } | null => {
    // GS-INPUT-03: terminal cleanup never touches a disposed session.
    if (game.status === 'disposed') {
      return null;
    }
    return input;
  }, [game, input]);

  const registerZone = useCallback(
    (action: string, rect: { x: number; y: number; width: number; height: number }, node: unknown) => {
      const owners = ownersRef.current;
      const owner = owners.get(action);
      if (owner !== undefined && owner !== node) {
        throw new Error(
          `GameButton action "${action}" is already registered by another mounted button. Use one button per action.`,
        );
      }
      owners.set(action, node);
      controllerRef.current?.setZone(action, rect);
    },
    [],
  );

  const context = useMemo<ButtonPadContextValue>(
    () => ({
      setZone: (action, x, y, width, height, node) => {
        registerZone(action, { x, y, width, height }, node);
      },
      measureZone: (action, node) => {
        const owners = ownersRef.current;
        if (owners.has(action) && owners.get(action) !== node) {
          throw new Error(
            `GameButton action "${action}" is already registered by another mounted button. Use one button per action.`,
          );
        }
        const measurable = node as MeasurableNode | null;
        const padNode = padRef.current === null ? null : findNodeHandle(padRef.current);
        if (measurable === null || typeof measurable.measureLayout !== 'function' || padNode === null) {
          return;
        }
        measurable.measureLayout(
          padNode,
          (x, y, width, height) => {
            // The button may have unmounted or been replaced while the
            // native measurement was in flight: never resurrect a zone.
            if (ownersRef.current.get(action) !== node) {
              return;
            }
            registerZone(action, { x, y, width, height }, node);
          },
          () => {},
        );
      },
      removeZone: (action, node) => {
        if (ownersRef.current.get(action) !== node) {
          return;
        }
        ownersRef.current.delete(action);
        const released = controllerRef.current?.removeZone(action) ?? [];
        const live = sessionRef.current;
        if (live.game.status === 'disposed') {
          return;
        }
        for (const actionReleased of released) {
          live.input.release(actionReleased);
        }
      },
    }),
    [registerZone],
  );

  // GS-INPUT-04: one invalidation policy — pause, session replacement, and
  // unmount bump the generation and clear pad ownership, so stale scheduled
  // callbacks die at ingress and a fresh down is required after resume.
  const invalidateOwnership = useCallback(() => {
    generationRef.current += 1;
    generationSV.value = generationRef.current;
    controllerRef.current?.invalidateOwnership();
  }, [generationSV]);

  useEffect(() => {
    invalidateOwnership();
    if (game.status === 'disposed') {
      return;
    }
    const subscription = game.addStatusListener((status) => {
      if (status === 'paused') {
        invalidateOwnership();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [game, invalidateOwnership]);

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      // Release held actions on the owning session first (unless it is
      // already disposed), then invalidate so late callbacks die.
      if (game.status !== 'disposed') {
        for (const action of controller?.releaseAll() ?? []) {
          input.release(action);
        }
      }
      invalidateOwnership();
    };
  }, [game, input, invalidateOwnership]);

  // JS-side handlers — called from the UI worklet via scheduleOnRN with the
  // scheduling generation first. Stale generations die here, before the
  // controller sees them.
  const onDownJS = useCallback(
    (generation: number, event: { allTouches: readonly { id: number; x: number; y: number }[] }) => {
      if (generation !== generationRef.current) {
        return;
      }
      const live = liveInput();
      if (live === null) {
        return;
      }
      const diff = controllerRef.current?.touchesDown(event.allTouches) ?? { pressed: [], released: [] };
      for (const action of diff.released) live.release(action);
      for (const action of diff.pressed) live.press(action);
    },
    [liveInput],
  );
  const onMoveJS = useCallback(
    (generation: number, event: { allTouches: readonly { id: number; x: number; y: number }[] }) => {
      if (generation !== generationRef.current) {
        return;
      }
      const live = liveInput();
      if (live === null) {
        return;
      }
      const diff = controllerRef.current?.touchesMove(event.allTouches) ?? { pressed: [], released: [] };
      for (const action of diff.released) live.release(action);
      for (const action of diff.pressed) live.press(action);
    },
    [liveInput],
  );
  const onUpJS = useCallback(
    (generation: number, event: { changedTouches: readonly { id: number; x: number; y: number }[] }) => {
      if (generation !== generationRef.current) {
        return;
      }
      const live = liveInput();
      if (live === null) {
        return;
      }
      const diff = controllerRef.current?.touchesUp(event.changedTouches) ?? { pressed: [], released: [] };
      for (const action of diff.released) live.release(action);
    },
    [liveInput],
  );
  const onCancelJS = useCallback(
    (generation: number, event: { changedTouches: readonly { id: number; x: number; y: number }[] }) => {
      if (generation !== generationRef.current) {
        return;
      }
      const live = liveInput();
      if (live === null) {
        return;
      }
      const diff = controllerRef.current?.touchesCancel(event.changedTouches) ?? { pressed: [], released: [] };
      for (const action of diff.released) live.release(action);
    },
    [liveInput],
  );

  type ManualTouchHandler = NonNullable<ManualGestureConfig['onTouchesDown']>;
  const handleTouchesDown = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      scheduleOnRN(onDownJS, generationSV.value, event as never);
    },
    [onDownJS, generationSV],
  );
  const handleTouchesMove = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      scheduleOnRN(onMoveJS, generationSV.value, event as never);
    },
    [onMoveJS, generationSV],
  );
  const handleTouchesUp = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      scheduleOnRN(onUpJS, generationSV.value, event as never);
    },
    [onUpJS, generationSV],
  );
  const handleTouchesCancel = useCallback<ManualTouchHandler>(
    (event) => {
      'worklet';
      scheduleOnRN(onCancelJS, generationSV.value, event as never);
    },
    [onCancelJS, generationSV],
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
        ref={padRef as never}
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
 * One touch zone of the pad. Layout it however you like; its measured
 * bounds become the multitouch hit area for `action`, in pad coordinates.
 *
 * GS-INPUT-03: the zone registers on layout (provisional, parent-relative)
 * and re-resolves into pad space through native measurement whenever
 * available; unmount and action replacement release the zone exactly once.
 */
export function GameButton({ action, children, style, testID, accessibilityRole }: GameButtonProps) {
  const context = useButtonPadContext();
  const nodeRef = useRef<View | null>(null);
  useEffect(() => {
    context.measureZone(action, nodeRef.current);
    return () => context.removeZone(action, nodeRef.current);
  }, [context, action]);
  return (
    <View
      ref={nodeRef as never}
      style={style}
      testID={testID}
      accessibilityRole={accessibilityRole}
      onLayout={(event) => {
        const layout = event.nativeEvent.layout;
        context.setZone(action, layout.x, layout.y, layout.width, layout.height, nodeRef.current);
        context.measureZone(action, nodeRef.current);
      }}
    >
      {children}
    </View>
  );
}
