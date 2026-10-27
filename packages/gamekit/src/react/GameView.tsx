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
import { useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { CameraCut2D } from '../camera2d';
import type { InputMap, SceneMap } from '../definition/types';
import type { AssetGroupMap, LoadedAssets } from '../assets/types';
import type { CommitFrame, GameSession } from '../core/session/types';
import type { ResolvedViewport2D } from '../viewport2d';
import { advanceAlpha } from './alphaClock';
import type { GameCamera2DDefinition } from './camera2d/defineGameCamera2D';
import { usePresentedCameraBinding } from './camera2d/usePresentedCameraBinding';
import { bindAppLifecycle } from './bindAppLifecycle';
import { bindGameSession } from './bindGameSession';
import { createCleanupList } from './cleanupList';
import { createGameLifecycleSource, GameLifecycleProvider } from './lifecycleSource';
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
  /**
   * The presented camera cut (T12.3), present only when the game opts in
   * via `camera2D`. Undefined until the first committed camera; camera
   * movement never re-renders React.
   */
  readonly camera?: SharedValue<CameraCut2D | undefined>;
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
   * Change this key to reset presentation for the same session. Session
   * replacement always remounts presentation, even when this key is reused.
   */
  readonly presentationKey?: string | number;
  /** The stable loaded asset lease; shape-only games omit it. */
  readonly assets?: LoadedAssets<TAssets>;
  /**
   * Optional static camera binding (T12.3). When absent, the exact current
   * viewport path is preserved. GameView owns the presented camera; the
   * renderer receives it as a prop and the pointer adapter discovers it
   * from the mounted surface.
   */
  readonly camera2D?: GameCamera2DDefinition<CommitFrame<TScenes>>;
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
 * Context supplying the presented camera to pointer input children.
 *
 * The shared value is owned by `GameView` (fed by the per-session
 * presentation), so renderer and pointer adapter observe the same camera
 * generation. `undefined` when the game has no camera.
 */
export interface GameCameraSurface {
  readonly presented: SharedValue<CameraCut2D | undefined> | undefined;
}

export const GameCameraContext = createContext<GameCameraSurface | null>(null);

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
  instrumentation,
  cameraDefinition,
  presentedCamera,
}: {
  readonly game: GameSession<TScenes, TInput>;
  readonly assets: LoadedAssets<TAssets> | undefined;
  readonly renderer: ComponentType<GameRendererProps<TScenes, TAssets>>;
  readonly viewportValue: SharedValue<ResolvedViewport2D | undefined>;
  readonly instrumentation: GameViewInstrumentation | undefined;
  readonly cameraDefinition: GameCamera2DDefinition<CommitFrame<TScenes>> | undefined;
  readonly presentedCamera: SharedValue<CameraCut2D | undefined>;
}) {
  const Renderer = renderer;
  const instrumentationRef = useRef(instrumentation);
  const observationGenerationRef = useRef(0);
  const frame = useSharedValue<CommitFrame<TScenes>>(() => game.getRenderFrame());
  const alpha = useSharedValue(0);
  const cameraBinding = usePresentedCameraBinding(cameraDefinition, presentedCamera);
  const presentCamera = cameraBinding.present;
  // T10.6: the presentation gate mirrors CORE status, not callback-local
  // state — a direct session.pause() freezes presentation too. Idle holds
  // until the binding starts the session.
  const running = useSharedValue(game.status === 'running');
  // Binding epoch: bumped per (re)subscription so a replacement session whose
  // revision restarts at zero is still accepted by the UI clock.
  const epoch = useSharedValue(0);
  const clockEpoch = useSharedValue(0);
  const clockRevision = useSharedValue(-1);
  // F1: last revision/observer generation seen by enabled diagnostics.
  const observedRevision = useSharedValue(-1);
  const observedGeneration = useSharedValue(-1);
  const observationGeneration = useSharedValue(0);
  // GS-REACT-01: mirror whether the UI-observation diagnostic is enabled so
  // the frame callback branches BEFORE timestamp reads and RN scheduling.
  // Updated alongside the ref (same effect), never read during render.
  const instrumentationEnabled = useSharedValue(
    instrumentation?.onUiRevisionObserved !== undefined,
  );

  // GS-REACT-01: the ref and the UI-side enabled mirror update together so
  // replacing instrumentation never restarts the session and the frame
  // callback can branch before any timestamp read or RN scheduling.
  useEffect(() => {
    instrumentationRef.current = instrumentation;
    observationGenerationRef.current += 1;
    observationGeneration.value = observationGenerationRef.current;
    instrumentationEnabled.value = instrumentation?.onUiRevisionObserved !== undefined;
    return () => {
      // Already queued UI observations belong to this observer and mount.
      // Invalidate on RN immediately, even before the UI mirror catches up.
      observationGenerationRef.current += 1;
      instrumentationEnabled.value = false;
    };
  }, [instrumentation, instrumentationEnabled, observationGeneration]);

  useEffect(() => {
    // GS-REACT-02: the mount wiring is one transaction. Every acquired
    // subscription registers its release as it completes, so a failing
    // stage unwinds everything before it; unmount releases all stages in
    // reverse order without stopping at the first failure.
    const cleanups = createCleanupList();
    cleanups.add(() => cameraBinding.dispose());
    try {
      epoch.value += 1;
      // RF6: the frame is seeded at mount from this session; the keyed remount
      // guarantees the renderer below never reads the previous session's frame.
      frame.value = game.getRenderFrame();
      // T10.6: subscribe to core status BEFORE the mount-time start, so the
      // idle -> running transition cannot be missed and every lifecycle change
      // (manual pause, app background, error path) drives the same mirror.
      running.value = game.status === 'running';
      const statusSubscription = game.addStatusListener((status) => {
        running.value = status === 'running';
      });
      cleanups.add(() => statusSubscription.remove());
      const cleanupBinding = bindGameSession(game, (nextFrame) => {
        frame.value = nextFrame;
        cameraBinding.commit(nextFrame);
        instrumentationRef.current?.onPresentCommit?.(nextFrame.revision, Date.now());
      });
      cleanups.add(cleanupBinding);
      const cleanupLifecycle = bindAppLifecycle(AppState, {
        getStatus: () => game.status,
        pause: () => {
          if (game.status !== 'disposed') {
            game.pause();
          }
        },
        resume: () => {
          if (game.status !== 'disposed') {
            game.start();
          }
        },
        addStatusListener: (listener) => game.addStatusListener(listener),
      });
      cleanups.add(cleanupLifecycle);
    } catch (error) {
      cleanups.releaseAfterFailure(error);
    }
    return () => {
      cleanups.releaseAll();
    };
  }, [cameraBinding, epoch, frame, game, running]);

  // F1: the first UI frame that sees a new commit revision is reported back
  // to the RN runtime through scheduleOnRN — never by calling the JS hook
  // directly from the UI worklet (cross-runtime calls crash the app).
  const reportUiObserved = useCallback((generation: number, revision: number, atMs: number) => {
    if (generation !== observationGenerationRef.current) {
      return;
    }
    instrumentationRef.current?.onUiRevisionObserved?.(revision, atMs);
  }, []);


  // UI-owned alpha clock: advances only while the session is running,
  // resets on every new commit, clamps at 1 and holds (no extrapolation).
  const presentFrame = useCallback((frameInfo: FrameInfo) => {
    'worklet';
    if (!running.value) {
      return;
    }
    const envelope = frame.value;
    if (instrumentationEnabled.value) {
      const generation = observationGeneration.value;
      if (observedGeneration.value !== generation || observedRevision.value !== envelope.revision) {
        observedGeneration.value = generation;
        observedRevision.value = envelope.revision;
        scheduleOnRN(reportUiObserved, generation, envelope.revision, Date.now());
      }
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
    presentCamera(alpha.value);
  }, [alpha, clockEpoch, clockRevision, epoch, frame, instrumentationEnabled, presentCamera,
    observationGeneration, observedGeneration, observedRevision, reportUiObserved, running]);
  useFrameCallback(presentFrame);

  return (
    <Renderer
      frame={frame}
      alpha={alpha}
      viewport={viewportValue}
      {...(cameraDefinition === undefined ? {} : { camera: presentedCamera })}
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
  camera2D,
}: GameViewProps<TScenes, TInput, TAssets>) {
  // T12.3: GameView owns the presented camera shared value so renderer and
  // pointer adapter observe the same generation. Camera movement writes
  // only shared values; React never re-renders for it.
  const presentedCamera = useSharedValue<CameraCut2D | undefined>(undefined);

  const bindingRef = useRef<ViewportBinding | null>(null);
  bindingRef.current = bindingForViewport(game.viewport, bindingRef.current);
  const binding = bindingRef.current;
  const viewportValue = useSharedValue<ResolvedViewport2D | undefined>(undefined);
  const viewportContext = useMemo<GameViewport>(
    () => ({ binding, viewport: viewportValue }),
    [binding, viewportValue],
  );
  const cameraContext = useMemo<GameCameraSurface>(
    () => ({ presented: camera2D === undefined ? undefined : presentedCamera }),
    [camera2D, presentedCamera],
  );
  // T20.3: one lifecycle source per session — replacement sessions replace
  // the source, so consumers bound to the old generation never observe the
  // new one (the presentation subtree is remounted per session, RF6).
  const lifecycle = useMemo(() => createGameLifecycleSource(game), [game]);

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
      <GameCameraContext.Provider value={cameraContext}>
        <GameLifecycleProvider value={lifecycle}>
          <View
            style={[styles.surface, style]}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              const previousRevision = binding.revision;
              binding.setSurfaceSize({ width, height });
              // Check RN-owned revision state: even an unchanged SharedValue
              // assignment schedules UI work, and reading it here can block RN.
              if (binding.revision !== previousRevision) {
                viewportValue.value = binding.resolved;
              }
            }}
          >
          <Canvas style={StyleSheet.absoluteFill}>
            {/* RF6/T8.6: both session identity and the optional reset key
                determine the presentation lifetime, so the
                frame/alpha/epoch initialize before the renderer can run. */}
            <GamePresentation
              key={`${sessionPresentationId(game)}:${typeof presentationKey}:${String(presentationKey)}`}
              game={game}
              assets={assets}
              renderer={Renderer}
              viewportValue={viewportValue}
              instrumentation={instrumentation}
              cameraDefinition={camera2D}
              presentedCamera={presentedCamera}
            />
          </Canvas>
          {children === undefined ? null : (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {children}
            </View>
          )}
        </View>
        </GameLifecycleProvider>
      </GameCameraContext.Provider>
    </GameViewportContext.Provider>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
  },
});
