import { Canvas } from '@shopify/react-native-skia';
import {
  createContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  AppState,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { InputMap, SceneMap } from '../definition/types';
import type { CommitFrame, GameSession } from '../core/session/types';
import type { ResolvedViewport2D } from '../viewport2d';
import { advanceAlpha } from './alphaClock';
import { bindAppLifecycle } from './bindAppLifecycle';
import { bindGameSession } from './bindGameSession';
import type { GameViewInstrumentation } from './instrumentation';
import { ViewportBinding } from './viewportBinding';

/** Stable imperative values supplied to a Skia renderer component. */
export interface GameRendererProps<TScenes extends SceneMap> {
  /** Latest simulation commit, updated at commit frequency only. */
  readonly frame: SharedValue<CommitFrame<TScenes>>;
  /**
   * UI-owned presentation fraction: advances on the UI runtime and resets
   * to zero on every new commit. Never extrapolates past 1.
   */
  readonly alpha: SharedValue<number>;
  /** Latest resolved viewport shared with the input adapter. */
  readonly viewport: SharedValue<ResolvedViewport2D | undefined>;
}

/** Props for the Skia-backed GameKit view. */
export interface GameViewProps<TScenes extends SceneMap, TInput extends InputMap> {
  /** Externally owned headless game session. */
  readonly game: GameSession<TScenes, TInput>;
  /** Stable Skia renderer component for the session's scene snapshots. */
  readonly renderer: ComponentType<GameRendererProps<TScenes>>;
  /** Optional measurement callbacks for the Performance Lab (F1). */
  readonly instrumentation?: GameViewInstrumentation;
  /** Static React HUD and controls mounted above the canvas. */
  readonly children?: ReactNode;
  /** Optional style for the mounted surface. */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Context supplying the resolved viewport to pointer input children.
 *
 * `GamePointerInput` consumes the binding for JS-side conversion and the
 * shared value for the UI-side containment mirror, so drawing and hit
 * testing always use the same resolved viewport instance for a layout
 * revision.
 */
export interface GameViewport {
  readonly binding: ViewportBinding;
  /** Resolved viewport shared value (layout-only updates). */
  readonly viewport: SharedValue<ResolvedViewport2D | undefined>;
}

export const GameViewportContext = createContext<GameViewport | null>(null);

/**
 * Mount a headless GameSession into a Skia canvas.
 *
 * Simulation commits update the frame shared value at commit frequency (one
 * per fixed step, never per display frame); the presentation fraction lives
 * on the UI runtime and is advanced by a frame callback that resets on every
 * new commit, clamps at 1, and never extrapolates. The clock is gated by a
 * `running` shared value so pause, background, unmount, and dispose hold the
 * presentation. React owns the surface and static overlay tree; it is never
 * the frame store. The session is started while mounted, paused on cleanup
 * and app backgrounding, and is never disposed by this component — the
 * creator owns disposal.
 */
export function GameView<TScenes extends SceneMap, TInput extends InputMap>({
  game,
  renderer: Renderer,
  children,
  style,
  instrumentation,
}: GameViewProps<TScenes, TInput>) {
  const instrumentationRef = useRef(instrumentation);
  const frame = useSharedValue<CommitFrame<TScenes>>(() => game.getRenderFrame());
  const alpha = useSharedValue(0);
  const running = useSharedValue(true);
  // Binding epoch: bumped per (re)subscription so a replacement session whose
  // revision restarts at zero is still accepted by the UI clock.
  const epoch = useSharedValue(0);
  const clockEpoch = useSharedValue(0);
  const clockRevision = useSharedValue(-1);
  const viewportValue = useSharedValue<ResolvedViewport2D | undefined>(undefined);

  const bindingRef = useRef<ViewportBinding | null>(null);
  if (bindingRef.current === null || bindingRef.current.config !== game.viewport) {
    bindingRef.current = new ViewportBinding(game.viewport);
  }
  const binding = bindingRef.current;
  const viewportContext = useMemo<GameViewport>(
    () => ({ binding, viewport: viewportValue }),
    [binding, viewportValue],
  );

  useEffect(() => {
    instrumentationRef.current = instrumentation;
  }, [instrumentation]);

  useEffect(() => {
    epoch.value += 1;
    const cleanupBinding = bindGameSession(game, (nextFrame) => {
      frame.value = nextFrame;
      instrumentationRef.current?.onPresentCommit?.(nextFrame.revision, Date.now());
    });
    const cleanupLifecycle = bindAppLifecycle(AppState, {
      getStatus: () => game.status,
      pause: () => {
        running.value = false;
        if (game.status !== 'disposed') {
          game.pause();
        }
      },
      resume: () => {
        if (game.status !== 'disposed') {
          game.start();
          running.value = true;
        }
      },
    });
    return () => {
      cleanupLifecycle();
      cleanupBinding();
    };
  }, [epoch, frame, game, running]);

  useEffect(
    () => () => {
      binding.dispose();
    },
    [binding],
  );

  // UI-owned alpha clock: advances only while the session is running,
  // resets on every new commit, clamps at 1 and holds (no extrapolation).
  useFrameCallback((frameInfo) => {
    'worklet';
    if (!running.value) {
      return;
    }
    const envelope = frame.value;
    const previousState = {
      epoch: clockEpoch.value,
      revision: clockRevision.value,
      alpha: alpha.value,
    };
    const nextState = advanceAlpha(
      previousState,
      {
        epoch: epoch.value,
        revision: envelope.revision,
        stepMs: envelope.stepMs,
      },
      frameInfo.timeSincePreviousFrame ?? 1000 / 60,
    );
    clockEpoch.value = nextState.epoch;
    clockRevision.value = nextState.revision;
    alpha.value = nextState.alpha;
  });

  return (
    <GameViewportContext.Provider value={viewportContext}>
      <View
        style={[styles.surface, style]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          binding.setSurfaceSize({ width, height });
          viewportValue.value = binding.resolved;
        }}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <Renderer frame={frame} alpha={alpha} viewport={viewportValue} />
        </Canvas>
        {children === undefined ? null : (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {children}
          </View>
        )}
      </View>
    </GameViewportContext.Provider>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
  },
});
