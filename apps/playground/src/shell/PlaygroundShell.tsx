import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  GamePointerInput,
  GameView,
  type GameRendererProps,
} from 'react-native-gamekit/react';
import type {
  GameSession,
  PointerInputAction,
  SceneDefinitionMarker,
} from 'react-native-gamekit';

import { createBrickBreakerSession } from '../games/brickBreakerGame';
import { createBootstrapGameSession } from '../games/bootstrapGame';
import { createLabSession } from '../perf/labSession';
import { createSpriteFieldSession, spriteFieldAssets } from '../games/spriteFieldGame';
import { createIdleSession } from '../games/idleSession';
import { useGameAssets } from 'react-native-gamekit/react';
import type { GameAssetsState } from 'react-native-gamekit/react';
import type { PlaygroundGameId } from '../catalog/games';
import { usePlaygroundStore } from '../state/playgroundStore';
import type { PlaygroundGameContentProps } from './PlaygroundGameContentProps';
import {
  EMPTY_RUN_SURFACE_STATE,
  reduceRunSurfaceState,
  settleRunSurfaceState,
  type RunSurfaceEvent,
} from './runSurfaceState';
import HomeScreen from '../screens/HomeScreen';
import BrickBreakerContent from '../screens/BrickBreakerContent';
import BootstrapContent from '../screens/BootstrapContent';
import LabContent from '../perf/LabContent';
import SpriteFieldContent from '../screens/SpriteFieldContent';
import { BrickBreakerRenderer } from '../renderers/BrickBreakerRenderer';
import { BootstrapRenderer } from '../renderers/BootstrapRenderer';
import { SpriteFieldRenderer } from '../renderers/SpriteFieldRenderer';

/** The GameView's scene-map parameter when the surface treats games opaquely. */
type SceneDefinitionMarkerMap = Record<string, SceneDefinitionMarker>;

/**
 * One immutable surface slot (RF2/RF3): the single binding unit for the
 * renderer, content, pointer, and frame. A slot is either a loading slot
 * (neutral canvas session, no assets, pointer disabled) or a complete ready
 * slot (real session + the exact loaded lease). Ready assets are never
 * paired with the neutral session, and the generation is allocated when the
 * slot is constructed — never through a follow-up effect.
 */
interface SurfaceSlot {
  readonly generation: number;
  readonly gameId: PlaygroundGameId;
  readonly status: 'loading' | 'ready';
  /** Neutral canvas session while loading; the real gameplay session when ready. */
  readonly session: GameSession;
  readonly renderer: ComponentType<GameRendererProps<never>>;
  readonly content: ComponentType<PlaygroundGameContentProps>;
  /** Present exactly when ready (the exact lease the renderer borrows). */
  readonly assets?: import('react-native-gamekit').LoadedAssets<never>;
  /** Pointer active only when the real session is published. */
  readonly pointer: boolean;
  /** Sessions retired by this slot's construction, disposed after commit. */
  readonly retiring: readonly GameSession[];
}



const FADE_DURATION_MS = 180;

/**
 * Stack-free playground shell with one long-lived game surface.
 *
 * The shell keeps the mounted GameView/Skia canvas alive while a game is
 * hidden and when another game replaces it. Sessions are created only from
 * explicit navigation events and are retired after React has committed the
 * replacement binding. Game content supplies HUD and controls without owning
 * or disposing the native surface.
 */
/**
 * RF2: the asset controller mounts only while a Sprite Field request is
 * active. It owns the asset acquisition, publishes the readiness lease, and
 * reports its status to the shell; other games never mount it and therefore
 * never acquire the manifest.
 */
function SpriteFieldAssetController({
  onReady,
  onStateChange,
}: {
  readonly onReady: (assets: never) => void;
  readonly onStateChange: (state: unknown) => void;
}) {
  const state = useGameAssets(spriteFieldAssets, { groups: ['boot', 'gameplay'] });
  useEffect(() => {
    console.log('[rf-controller] state', state.status, state.status === 'loading' ? state.progress : '');
    onStateChange(state);
    if (state.status === 'ready') {
      onReady(state.assets as never);
    }
  }, [onReady, onStateChange, state]);
  return null;
}

/** A fresh loading slot: neutral canvas session, pointer disabled. */
function makeLoadingSlot(
  gameId: PlaygroundGameId,
  session: GameSession,
  retiring: readonly GameSession[] = [],
): SurfaceSlot {
  const entry = GAME_CONTENTS[gameId];
  return {
    generation: 0,
    gameId,
    status: 'loading',
    session,
    renderer: entry.renderer,
    content: entry.component,
    // RF2: only the Sprite Field's loading slot disables the pointer (its
    // neutral session declares no input actions); every other game keeps its
    // pointer active from the first render.
    pointer: hasPointerAction(gameId) && gameId !== 'sprite-field',
    retiring,
  };
}

export function PlaygroundShell() {
  const currentGameId = usePlaygroundStore((state) => state.currentGameId);
  const openGame = usePlaygroundStore((state) => state.openGame);
  const closeGame = usePlaygroundStore((state) => state.closeGame);

  const [sessionBundle, setSessionBundle] = useState<{
    gameId: PlaygroundGameId | null;
    session: GameSession | undefined;
  }>({ gameId: null, session: undefined });
  const sessionBundleRef = useRef(sessionBundle);
  const retiringBaseSessionsRef = useRef<readonly GameSession[]>([]);

  // Create sessions only at the explicit navigation event boundary. Never
  // create or dispose native/runtime resources during React render.
  const handleOpenGame = useCallback(
    (gameId: PlaygroundGameId) => {
      const previous = sessionBundleRef.current.session;
      const next = { gameId, session: createSessionFor(gameId) };
      if (previous !== undefined && previous.status !== 'disposed') {
        if (previous.status === 'running') {
          previous.pause();
        }
        retiringBaseSessionsRef.current = appendUniqueSession(
          retiringBaseSessionsRef.current,
          previous,
        );
      }
      sessionBundleRef.current = next;
      setSessionBundle(next);
      openGame(gameId);
    },
    [openGame],
  );

  const handleCloseGame = useCallback(() => {
    const current = sessionBundleRef.current.session;
    if (current !== undefined && current.status === 'running') {
      current.pause();
    }
    closeGame();
  }, [closeGame]);

  // The new GameView/pointer binding has committed before this timer retires
  // the previous base session. Rapid replacements cancel and combine safely.
  useEffect(() => {
    if (retiringBaseSessionsRef.current.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      const retiring = retiringBaseSessionsRef.current;
      retiringBaseSessionsRef.current = [];
      for (const retired of retiring) {
        disposeSession(retired);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [sessionBundle]);

  useEffect(
    () => () => {
      const current = sessionBundleRef.current.session;
      if (current !== undefined) {
        disposeSession(current);
      }
      for (const retired of retiringBaseSessionsRef.current) {
        disposeSession(retired);
      }
      retiringBaseSessionsRef.current = [];
    },
    [],
  );

  const session = sessionBundle.session;
  const activeGameId = sessionBundle.gameId;

  // Android hardware back closes the active game; on the home screen the OS
  // retains its normal exit behavior.
  useEffect(() => {
    if (currentGameId === null) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCloseGame();
      return true;
    });
    return () => subscription.remove();
  }, [currentGameId, handleCloseGame]);

  const gameVisible = currentGameId !== null && currentGameId === activeGameId;
  const pointerGame = session !== undefined && hasPointerAction(activeGameId);

  return (
    <View style={styles.shell}>
      {!gameVisible ? <HomeScreen onOpenGame={handleOpenGame} /> : null}
      {session !== undefined && activeGameId !== null ? (
        <GameSurface
          gameId={activeGameId}
          game={session}
          onExit={handleCloseGame}
          onOpenGame={handleOpenGame}
          hidden={!gameVisible}
          showPointer={pointerGame}
        />
      ) : null}
    </View>
  );
}

/**
 * The shell's long-lived surface. GameView remains mounted while its session,
 * renderer, content, and pointer binding change. F3 generations make pointer
 * replacement safe without disposing the old session during render.
 */
function GameSurface({
  gameId,
  game,
  onExit,
  onOpenGame,
  hidden,
  showPointer,
}: {
  readonly gameId: PlaygroundGameId;
  readonly game: GameSession;
  readonly onExit: () => void;
  readonly onOpenGame: (gameId: PlaygroundGameId) => void;
  readonly hidden: boolean;
  readonly showPointer: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // Explicit two-state visibility: opening fades to 1; closing fades to 0
  // (or snaps when reduced motion is enabled). The surface never stays at 1
  // just because the component itself did not remount (R1).
  const opacity = useSharedValue(0);
  // The lab transfers run sessions to the shell. A detached/replaced session
  // remains alive until the render without it commits, then this owner
  // disposes it. Child cleanup never disposes a still-bound surface.
  // RF3: one immutable surface slot; the session/lease/generation are
  // published together on readiness and retired only after the committed
  // render no longer references them. Game switches adjust the slot during
  // render (the sanctioned pattern) and carry the retired session in the
  // slot itself — no refs, no passive-effect correctness barrier.
  const [slot, setSlot] = useState<SurfaceSlot>(() => makeLoadingSlot(gameId, game));
  if (gameId !== slot.gameId) {
    setSlot(makeLoadingSlot(gameId, game, [slot.session, ...slot.retiring]));
  }

  useEffect(() => {
    for (const retired of slot.retiring) {
      disposeSession(retired);
    }
  }, [slot]);

  const publishReady = useCallback((assets: never) => {
    setSlot((previous) => {
      const session = createSpriteFieldSession() as unknown as GameSession;
      return {
        generation: previous.generation + 1,
        gameId: previous.gameId,
        status: 'ready',
        session,
        renderer: previous.renderer,
        content: previous.content,
        assets,
        pointer: true,
        retiring: [previous.session, ...previous.retiring],
      };
    });
  }, []);

  const [assetState, setAssetState] = useState<
    | { readonly status: 'loading'; readonly progress: number; readonly retry: () => void; readonly requestKey: string }
    | { readonly status: 'error'; readonly error: import('react-native-gamekit').GameAssetError; readonly retry: () => void; readonly requestKey: string }
    | { readonly status: 'ready'; readonly assets: import('react-native-gamekit').LoadedAssets<import('react-native-gamekit').AssetGroupMap>; readonly requestKey: string }
    | undefined
  >(undefined);
  const handleAssetState = useCallback((state: unknown) => {
    setAssetState(state as never);
  }, []);
  const [runSurface, setRunSurface] = useState(EMPTY_RUN_SURFACE_STATE);
  const ownedRunSessionsRef = useRef<readonly GameSession[]>([]);

  const handleRunSurfaceEvent = useCallback((event: RunSurfaceEvent) => {
    if (event.kind === 'attach' && !ownedRunSessionsRef.current.includes(event.attachment.session)) {
      ownedRunSessionsRef.current = [...ownedRunSessionsRef.current, event.attachment.session];
    }
    setRunSurface((previous) => reduceRunSurfaceState(previous, event));
  }, []);

  useEffect(() => {
    const settled = settleRunSurfaceState(runSurface);
    if (settled.disposable.length === 0) {
      return;
    }
    // Run after this committed passive-effect turn. If a newer event lands
    // first, cleanup cancels this timer and the next effect retires the
    // combined set instead of disposing from a stale render.
    const timer = setTimeout(() => {
      for (const retired of settled.disposable) {
        disposeSession(retired);
      }
      ownedRunSessionsRef.current = ownedRunSessionsRef.current.filter(
        (candidate) => !settled.disposable.includes(candidate),
      );
      setRunSurface((latest) => ({
        current: latest.current,
        retiring: latest.retiring.filter(
          (candidate) => !settled.disposable.includes(candidate),
        ),
      }));
    }, 0);
    return () => clearTimeout(timer);
  }, [runSurface]);

  useEffect(
    () => () => {
      for (const owned of ownedRunSessionsRef.current) {
        disposeSession(owned);
      }
      ownedRunSessionsRef.current = [];
    },
    [],
  );

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = hidden ? 0 : 1;
      return;
    }
    opacity.value = withTiming(hidden ? 0 : 1, { duration: FADE_DURATION_MS });
  }, [opacity, reduceMotion, hidden]);

  const assetBacked = gameId === 'sprite-field';
  const activeRunSurface = gameId === 'perf-lab' ? runSurface.current : undefined;
  const Renderer = slot.renderer;
  const Content = slot.content;
  const renderedGame = activeRunSurface?.session ?? slot.session;

  useEffect(() => {
    if (hidden) {
      if (renderedGame.status === 'running') {
        renderedGame.pause();
      }
      return;
    }
    if (renderedGame.status !== 'disposed') {
      renderedGame.start();
    }
  }, [hidden, renderedGame]);

  return (
    <Animated.View
      accessibilityElementsHidden={hidden}
      accessibilityViewIsModal={!hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      onAccessibilityEscape={onExit}
      pointerEvents={hidden ? 'none' : 'auto'}
      style={[styles.gameSurface, { opacity }]}
    >
      <GameView
        game={renderedGame}
        presentationKey={slot.generation}
        assets={slot.assets as never}
        renderer={Renderer as unknown as ComponentType<GameRendererProps<SceneDefinitionMarkerMap>>}
        instrumentation={activeRunSurface?.view}
        style={StyleSheet.absoluteFill}
      >
        {slot.pointer ? (
          <GamePointerInput
            // RF2/RF6: the pointer mounts only when the ready slot published
            // the real session — never against the neutral canvas session —
            // and each binding generation gets a fresh RNGH detector keyed by
            // the slot generation (never object stringification).
            key={slot.generation}
            game={renderedGame as GameSession<SceneDefinitionMarkerMap, Record<string, PointerInputAction>>}
            action="primary"
            instrumentation={activeRunSurface?.pointer}
          />
        ) : null}
        <Content
          game={slot.session}
          onExit={onExit}
          onOpenGame={onOpenGame}
          onRunSurfaceEvent={handleRunSurfaceEvent}
          assetState={assetBacked ? assetState : undefined}
          assetController={
            assetBacked ? (
              <SpriteFieldAssetController
                onReady={publishReady}
                onStateChange={handleAssetState}
              />
            ) : null
          }
        />
      </GameView>
    </Animated.View>
  );
}

interface GameContentEntry {
  readonly component: ComponentType<PlaygroundGameContentProps>;
  // `never` scene map: the surface hands the renderer its game's real frames
  // at runtime; the type only needs to accept any concrete renderer.
  readonly renderer: ComponentType<GameRendererProps<never>>;
}

/** Content registry: the catalog id maps to the content + its renderer. */
const GAME_CONTENTS: Record<PlaygroundGameId, GameContentEntry> = {
  'bootstrap': {
    component: BootstrapContent,
    renderer: BootstrapRenderer as unknown as ComponentType<GameRendererProps<never>>,
  },
  'brick-breaker': {
    component: BrickBreakerContent,
    renderer: BrickBreakerRenderer as unknown as ComponentType<GameRendererProps<never>>,
  },
  'perf-lab': {
    component: LabContent,
    renderer: BrickBreakerRenderer as unknown as ComponentType<GameRendererProps<never>>,
  },
  'sprite-field': {
    component: SpriteFieldContent,
    renderer: SpriteFieldRenderer as unknown as ComponentType<GameRendererProps<never>>,
  },
};

function createSessionFor(gameId: PlaygroundGameId): GameSession {
  // The shell's surface treats sessions opaquely; the concrete session
  // types differ only in their generic parameters, so the cast is contained
  // here. Content components receive the session and cast to their known
  // concrete type at their own boundary.
  if (gameId === 'brick-breaker') {
    return createBrickBreakerSession() as unknown as GameSession;
  }
  if (gameId === 'perf-lab') {
    return createLabSession() as unknown as GameSession;
  }
  if (gameId === 'sprite-field') {
    // R2: navigation to the asset-backed game creates a load request, not a
    // running session. The gameplay session is created only on readiness.
    return createIdleSession() as unknown as GameSession;
  }
  return createBootstrapGameSession() as unknown as GameSession;
}

function hasPointerAction(gameId: PlaygroundGameId | null): boolean {
  return gameId === 'brick-breaker' || gameId === 'perf-lab' || gameId === 'sprite-field';
}

function disposeSession(session: GameSession): void {
  if (session.status !== 'disposed') {
    session.dispose();
  }
}

function appendUniqueSession(
  sessions: readonly GameSession[],
  session: GameSession,
): readonly GameSession[] {
  return sessions.includes(session) ? sessions : [...sessions, session];
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#080b12',
  },
  gameSurface: {
    backgroundColor: '#080b12',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
