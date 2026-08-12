import { Canvas } from '@shopify/react-native-skia';
import {
  createContext,
  useCallback,
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
import { scheduleOnRN } from 'react-native-worklets';

import type { InputMap, SceneMap } from '../definition/types';
import type { AssetGroupMap, LoadedAssets } from '../assets/types';
import type { CommitFrame, GameSession } from '../core/session/types';
import type { ResolvedViewport2D } from '../viewport2d';
import { advanceAlpha } from './alphaClock';
import { bindAppLifecycle } from './bindAppLifecycle';
import { bindGameSession } from './bindGameSession';
import type { GameViewInstrumentation } from './instrumentation';
import { bindingForViewport, type ViewportBinding } from './viewportBinding';

/** Stable imperative values supplied to a Skia renderer component. */
export interface GameRendererProps<
  TScenes extends SceneMap,
  TAssets extends AssetGroupMap = AssetGroupMap,
> {
  /** Latest simulation commit, updated at commit frequency only. */
  readonly frame: SharedValue<CommitFrame<TScenes>>;
  /**
   * UI-owned presentation fraction: advances on the UI runtime and resets
   * to zero on every new commit. Never extrapolates past 1.
   */
  readonly alpha: SharedValue<number>;
  /** Latest resolved viewport shared with the input adapter. */
  readonly viewport: SharedValue<ResolvedViewport2D | undefined>;
  /** The stable loaded asset lease (T7.5); shape-only renderers omit it. */
  readonly assets?: LoadedAssets<TAssets>;
}

/** Props for the Skia-backed GameKit view. */
export interface GameViewProps<
  TScenes extends SceneMap,
  TInput extends InputMap,
  TAssets extends AssetGroupMap = AssetGroupMap,
> {
  /** Externally owned headless game session. */
  readonly game: GameSession<TScenes, TInput>;
  /**
   * Explicit presentation key (RF6): remounts the per-session presentation
   * when the session changes. The fallback is a stable per-session identity
   * allocated from a WeakMap (T8.6) — never object stringification, which
   * maps every session to the same value.
   */
  readonly presentationKey?: string | number;
  /** The stable loaded asset lease; shape-only games omit it. */
  readonly assets?: LoadedAssets<TAssets>;
  /** Stable Skia renderer component for the session's scene snapshots. */
  readonly renderer: ComponentType<GameRendererProps<TScenes, TAssets>>;
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
/**
 * Per-session presentation binding (RF6).
 *
 * Keyed by the session so the frame, alpha, epoch, and clock initialize from
 * the new session BEFORE its renderer can execute — a replacement renderer
 * never observes the previous session's frame, even when both scenes are
 * named the same.
 */
function GamePresentation<
  TScenes extends SceneMap,
  TInput extends InputMap,
  TAssets extends AssetGroupMap,
>({
  game,
  assets,
  renderer,
  viewportValue,
  instrumentationRef,
}: {
  readonly game: GameSession<TScenes, TInput>;
  readonly assets: LoadedAssets<TAssets> | undefined;
  readonly renderer: ComponentType<GameRendererProps<TScenes, TAssets>>;
  readonly viewportValue: SharedValue<ResolvedViewport2D | undefined>;
  readonly instrumentationRef: { readonly current: GameViewInstrumentation | undefined };
}) {
  const Renderer = renderer;
  const frame = useSharedValue<CommitFrame<TScenes>>(() => game.getRenderFrame());
  const alpha = useSharedValue(0);
  const running = useSharedValue(true);
  // Binding epoch: bumped per (re)subscription so a replacement session whose
  // revision restarts at zero is still accepted by the UI clock.
  const epoch = useSharedValue(0);
  const clockEpoch = useSharedValue(0);
  const clockRevision = useSharedValue(-1);
  // F1: last revision/epoch the UI clock observed, so the instrumentation can
  // report the FIRST UI frame that saw a new commit.
  const observedRevision = useSharedValue(-1);
  const observedEpoch = useSharedValue(-1);

  useEffect(() => {
    epoch.value += 1;
    // RF6: the frame is seeded at mount from this session; the keyed remount
    // guarantees the renderer below never reads the previous session's frame.
    frame.value = game.getRenderFrame();
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

  // F1: the first UI frame that sees a new commit revision is reported back
  // to the RN runtime through scheduleOnRN — never by calling the JS hook
  // directly from the UI worklet (cross-runtime calls crash the app).
  const reportUiObserved = useCallback((revision: number, atMs: number) => {
    instrumentationRef.current?.onUiRevisionObserved?.(revision, atMs);
  }, []);


  // UI-owned alpha clock: advances only while the session is running,
  // resets on every new commit, clamps at 1 and holds (no extrapolation).
  useFrameCallback((frameInfo) => {
    'worklet';
    if (!running.value) {
      return;
    }
    const envelope = frame.value;
    if (observedEpoch.value !== epoch.value || observedRevision.value !== envelope.revision) {
      observedEpoch.value = epoch.value;
      observedRevision.value = envelope.revision;
      scheduleOnRN(reportUiObserved, envelope.revision, Date.now());
    }
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
    <Renderer
      frame={frame}
      alpha={alpha}
      viewport={viewportValue}
      {...(assets === undefined ? {} : { assets })}
    />
  );
}

// Stable per-session fallback identity (T8.6): one incrementing id per
// session object for the life of the module. A replaced session is a new
// object and therefore a new id; the same session keeps its id across
// renders so the presentation never remounts spuriously.
const sessionPresentationIds = new WeakMap<object, number>();
let nextSessionPresentationId = 1;
function sessionPresentationId(game: object): number {
  let id = sessionPresentationIds.get(game);
  if (id === undefined) {
    id = nextSessionPresentationId;
    nextSessionPresentationId += 1;
    sessionPresentationIds.set(game, id);
  }
  return id;
}

export function GameView<
  TScenes extends SceneMap,
  TInput extends InputMap,
  TAssets extends AssetGroupMap = AssetGroupMap,
>({
  game,
  presentationKey,
  assets,
  renderer: Renderer,
  children,
  style,
  instrumentation,
}: GameViewProps<TScenes, TInput, TAssets>) {
  const instrumentationRef = useRef(instrumentation);

  const bindingRef = useRef<ViewportBinding | null>(null);
  bindingRef.current = bindingForViewport(game.viewport, bindingRef.current);
  const binding = bindingRef.current;
  const viewportValue = useSharedValue<ResolvedViewport2D | undefined>(undefined);
  const viewportContext = useMemo<GameViewport>(
    () => ({ binding, viewport: viewportValue }),
    [binding, viewportValue],
  );

  useEffect(() => {
    instrumentationRef.current = instrumentation;
  }, [instrumentation]);

  useEffect(() => {
    viewportValue.value = binding.resolved;
  }, [binding, viewportValue]);

  useEffect(
    () => () => {
      binding.dispose();
    },
    [binding],
  );

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
          {/* RF6/T8.6: the per-session presentation is keyed by an explicit
              presentation key when provided, otherwise by a stable
              per-session identity — never object stringification — so the
              frame/alpha/epoch initialize before the renderer can run. */}
          <GamePresentation
            key={presentationKey ?? sessionPresentationId(game)}
            game={game}
            assets={assets}
            renderer={Renderer}
            viewportValue={viewportValue}
            instrumentationRef={instrumentationRef}
          />
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
