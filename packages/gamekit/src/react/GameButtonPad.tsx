/** Multitouch button zones owned by one mounted pad and one live session. */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { findNodeHandle, StyleSheet, View } from 'react-native';
import { GestureDetector, useManualGesture, type ManualGestureConfig } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { StyleProp, ViewStyle } from 'react-native';

import { createButtonPadController, type ButtonPadRect, type ButtonPadTouch } from '../core/input/buttonPad';
import type { InputMap, SceneMap } from '../definition/types';
import type { GameSession } from '../core/session/types';
import { createCleanupList } from './cleanupList';

/** Declared button action names of an input map. */
export type ButtonActionName<TInput extends InputMap> = {
  [TName in Extract<keyof TInput, string>]: TInput[TName] extends { readonly type: 'button' }
    ? TName
    : never;
}[Extract<keyof TInput, string>];

interface ButtonPadContextValue {
  readonly registerZone: (action: string, owner: object, node: unknown) => void;
  readonly measureZone: (action: string, owner: object, node: unknown, invalidate?: boolean) => void;
  readonly removeZone: (action: string, owner: object) => void;
}
const ButtonPadContext = createContext<ButtonPadContextValue | null>(null);
let nextPadBindingId = 1;

interface MeasurableNode {
  measureLayout(
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail: () => void,
  ): void;
}
interface Zone {
  readonly owner: object;
  node: unknown;
  measurement: number;
  rect: ButtonPadRect | null;
}

export interface GameButtonPadProps<TScenes extends SceneMap, TInput extends InputMap> {
  readonly game: GameSession<TScenes, TInput>;
  /** One or more GameButton zones in ordinary React Native layouts. */
  readonly children?: ReactNode;
  /** Container style; defaults to an invisible full-surface overlay. */
  readonly style?: StyleProp<ViewStyle>;
  /** Finite, nonnegative extra hit area around every measured zone, in dp. */
  readonly hitSlop?: number;
  readonly testID?: string;
}

/** Copy only coordinates needed by the controller, never the native event. */
function compactTouches(touches: readonly ButtonPadTouch[]): ButtonPadTouch[] {
  'worklet';
  return touches.map(({ id, x, y }) => ({ id, x, y }));
}

/**
 * Map simultaneous touches to declared button actions. Native measurement
 * supplies pad-space hit areas; a zone stays inactive until it is measured.
 * Layout/configuration changes release ownership and require a fresh down.
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
    getResetRevision: (action: string) => number;
  };
  const padRef = useRef<View | null>(null);
  const sessionRef = useRef({ game, input });
  const controllerRef = useRef<ReturnType<typeof createButtonPadController> | null>(null);
  if (controllerRef.current === null) controllerRef.current = createButtonPadController({ hitSlop });
  const zonesRef = useRef(new Map<string, Zone>());
  const resetRevisionsRef = useRef(new Map<string, number>());
  const generationRef = useRef(1);
  const generationSV = useSharedValue(1);
  const runningSV = useSharedValue(false);
  const bindingId = useMemo(() => nextPadBindingId++, [game, input]);
  const liveBindingSV = useSharedValue(0);
  const mountedRef = useRef(false);

  const invalidateOwnership = useCallback((release: boolean) => {
    generationRef.current += 1;
    generationSV.value = generationRef.current;
    const released = controllerRef.current!.releaseAll();
    const live = sessionRef.current;
    if (release && live.game.status !== 'disposed') {
      for (const action of released) live.input.release(action);
    }
  }, [generationSV]);

  const clearZone = useCallback((action: string, zone: Zone) => {
    if (zone.rect === null) return;
    invalidateOwnership(true);
    controllerRef.current!.removeZone(action);
    zone.rect = null;
  }, [invalidateOwnership]);

  const measureZone = useCallback((action: string, owner: object, node: unknown, invalidate = false) => {
    const zone = zonesRef.current.get(action);
    if (zone?.owner !== owner) return;
    zone.node = node;
    const measurement = ++zone.measurement;
    if (invalidate) clearZone(action, zone);
    const measurable = node as MeasurableNode | null;
    const padNode = padRef.current === null ? null : findNodeHandle(padRef.current);
    if (measurable === null || typeof measurable.measureLayout !== 'function' || padNode === null) {
      clearZone(action, zone);
      return;
    }
    const current = () => zonesRef.current.get(action) === zone && zone.measurement === measurement;
    measurable.measureLayout(padNode, (x, y, width, height) => {
      if (!current()) return;
      if (![x, y, width, height, x + width, y + height].every(Number.isFinite) || width <= 0 || height <= 0) {
        clearZone(action, zone);
        return;
      }
      const old = zone.rect;
      if (old?.x === x && old.y === y && old.width === width && old.height === height) return;
      invalidateOwnership(true);
      const rect = { x, y, width, height };
      controllerRef.current!.setZone(action, rect);
      zone.rect = rect;
    }, () => { if (current()) clearZone(action, zone); });
  }, [clearZone, invalidateOwnership]);

  const context = useMemo<ButtonPadContextValue>(() => ({
    registerZone: (action, owner, node) => {
      const existing = zonesRef.current.get(action);
      if (existing && existing.owner !== owner) {
        throw new Error(`GameButton action "${action}" is already registered by another mounted button. Use one button per action.`);
      }
      if (!existing) zonesRef.current.set(action, { owner, node, measurement: 0, rect: null });
    },
    measureZone,
    removeZone: (action, owner) => {
      const zone = zonesRef.current.get(action);
      if (zone?.owner !== owner) return;
      clearZone(action, zone);
      zonesRef.current.delete(action);
      resetRevisionsRef.current.delete(action);
    },
  }), [clearZone, measureZone]);

  const refreshZones = useCallback((invalidate: boolean) => {
    for (const [action, zone] of zonesRef.current) measureZone(action, zone.owner, zone.node, invalidate);
  }, [measureZone]);

  // Restart and scene transitions can reset input while status stays running.
  // Observe each action rather than guessing from scene names or hard cuts.
  const observeResetRevisions = useCallback(() => {
    const live = sessionRef.current;
    let changed = false;
    for (const action of zonesRef.current.keys()) {
      const revision = live.input.getResetRevision(action);
      const previous = resetRevisionsRef.current.get(action);
      if (previous !== undefined && previous !== revision) changed = true;
      resetRevisionsRef.current.set(action, revision);
    }
    if (changed) invalidateOwnership(false);
  }, [invalidateOwnership]);

  useLayoutEffect(() => {
    sessionRef.current = { game, input };
    const releases = createCleanupList();
    let live = true;
    releases.add(() => invalidateOwnership(true));
    const release = () => {
      if (!live) return;
      live = false;
      mountedRef.current = false;
      liveBindingSV.value = 0;
      runningSV.value = false;
      releases.releaseAll();
    };
    try {
      mountedRef.current = true;
      liveBindingSV.value = bindingId;
      runningSV.value = game.status === 'running';
      resetRevisionsRef.current.clear();
      observeResetRevisions();
      invalidateOwnership(false);
      refreshZones(false);
      if (game.status !== 'disposed') {
        const statusSubscription = game.addStatusListener((status) => {
          if (!live) return;
          runningSV.value = status === 'running';
          observeResetRevisions();
          invalidateOwnership(false);
        });
        releases.add(() => statusSubscription.remove());
        const commitSubscription = game.addCommitListener(() => {
          if (live) observeResetRevisions();
        });
        releases.add(() => commitSubscription.remove());
      }
    } catch (error) {
      try {
        release();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Button pad setup and cleanup failed');
      }
      throw error;
    }
    return release;
  }, [game, input, bindingId, liveBindingSV, runningSV, invalidateOwnership, observeResetRevisions, refreshZones]);

  // Newly committed buttons need a baseline before their first input packet.
  useLayoutEffect(observeResetRevisions);

  const previousHitSlop = useRef(hitSlop);
  useLayoutEffect(() => {
    if (previousHitSlop.current === hitSlop) return;
    controllerRef.current!.setHitSlop(hitSlop);
    previousHitSlop.current = hitSlop;
    invalidateOwnership(true);
  }, [hitSlop, invalidateOwnership]);

  // Queued packets are accepted only by their mounted, running generation.
  const applyTouches = useCallback((generation: number, kind: 'down' | 'move' | 'up' | 'cancel', touches: readonly ButtonPadTouch[]) => {
    if (!mountedRef.current || sessionRef.current.game !== game || game.status !== 'running') return;
    observeResetRevisions();
    if (generation !== generationRef.current) return;
    const controller = controllerRef.current!;
    if (kind === 'cancel') {
      for (const action of controller.releaseAll()) input.release(action);
      return;
    }
    const diff = kind === 'down' ? controller.touchesDown(touches)
      : kind === 'move' ? controller.touchesMove(touches) : controller.touchesUp(touches);
    for (const action of diff.released) input.release(action);
    for (const action of diff.pressed) input.press(action);
  }, [game, input, observeResetRevisions]);
  const onDownJS = useCallback((generation: number, touches: readonly ButtonPadTouch[]) => applyTouches(generation, 'down', touches), [applyTouches]);
  const onMoveJS = useCallback((generation: number, touches: readonly ButtonPadTouch[]) => applyTouches(generation, 'move', touches), [applyTouches]);
  const onUpJS = useCallback((generation: number, touches: readonly ButtonPadTouch[]) => applyTouches(generation, 'up', touches), [applyTouches]);
  const onCancelJS = useCallback((generation: number) => applyTouches(generation, 'cancel', []), [applyTouches]);

  type TouchHandler = NonNullable<ManualGestureConfig['onTouchesDown']>;
  const onTouchesDown = useCallback<TouchHandler>((event) => {
    'worklet';
    if (!runningSV.value || liveBindingSV.value !== bindingId) return;
    scheduleOnRN(onDownJS, generationSV.value, compactTouches(event.changedTouches));
  }, [onDownJS, generationSV, runningSV, liveBindingSV, bindingId]);
  const onTouchesMove = useCallback<TouchHandler>((event) => {
    'worklet';
    if (!runningSV.value || liveBindingSV.value !== bindingId) return;
    scheduleOnRN(onMoveJS, generationSV.value, compactTouches(event.changedTouches));
  }, [onMoveJS, generationSV, runningSV, liveBindingSV, bindingId]);
  const onTouchesUp = useCallback<TouchHandler>((event) => {
    'worklet';
    if (!runningSV.value || liveBindingSV.value !== bindingId) return;
    scheduleOnRN(onUpJS, generationSV.value, compactTouches(event.changedTouches));
  }, [onUpJS, generationSV, runningSV, liveBindingSV, bindingId]);
  const onCancel = useCallback(() => {
    'worklet';
    if (!runningSV.value || liveBindingSV.value !== bindingId) return;
    scheduleOnRN(onCancelJS, generationSV.value);
  }, [onCancelJS, generationSV, runningSV, liveBindingSV, bindingId]);
  const gestureConfig = useMemo<ManualGestureConfig>(() => ({
    shouldCancelWhenOutside: false,
    onTouchesDown,
    onTouchesMove,
    onTouchesUp,
    onTouchesCancel: onCancel,
    onFinalize: onCancel,
  }), [onTouchesDown, onTouchesMove, onTouchesUp, onCancel]);
  const gesture = useManualGesture(gestureConfig);

  return (
    <GestureDetector gesture={gesture}>
      <View ref={padRef as never} collapsable={false} pointerEvents="box-none"
        style={style ?? StyleSheet.absoluteFill} testID={testID} onLayout={() => refreshZones(true)}>
        <ButtonPadContext.Provider value={context}>{children}</ButtonPadContext.Provider>
      </View>
    </GestureDetector>
  );
}

export interface GameButtonProps {
  /** The declared button action this zone presses. */
  readonly action: string;
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly accessibilityRole?: 'button';
}

/** A measured touch zone. Use one mounted button per action within a pad. */
export function GameButton({ action, children, style, testID, accessibilityRole }: GameButtonProps) {
  const context = useContext(ButtonPadContext);
  if (context === null) throw new Error('GameButton must be rendered inside a GameButtonPad');
  const owner = useRef({}).current;
  const nodeRef = useRef<View | null>(null);
  useLayoutEffect(() => {
    context.registerZone(action, owner, nodeRef.current);
    return () => context.removeZone(action, owner);
  }, [context, action, owner]);
  // A committed configuration render can move an ancestor without changing
  // the button's parent-relative layout. Refresh native pad-space bounds.
  useLayoutEffect(() => { context.measureZone(action, owner, nodeRef.current); });
  return (
    <View ref={nodeRef as never} collapsable={false} style={style} testID={testID}
      accessibilityRole={accessibilityRole}
      onLayout={() => context.measureZone(action, owner, nodeRef.current, true)}>
      {children}
    </View>
  );
}
