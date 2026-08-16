import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  GamePointerInput,
  GameView,
  type GameAssetsState,
  type GameCamera2DDefinition,
  type GameRendererProps,
} from 'rn-gamekit/react';
import type {
  GameSession,
  PointerInputAction,
  SceneDefinitionMarker,
} from 'rn-gamekit';
import { useGameAssets } from 'rn-gamekit/react';

import { createBrickBreakerSession } from '../screens/brick-breaker/brickBreakerGame';
import { createGameSession } from 'rn-gamekit';
import { paddleGame } from '../docs-examples/paddle-tutorial/game';
import { PaddleRenderer } from '../docs-examples/paddle-tutorial/Renderer';
import { collisionLabDefinition } from '../screens/collision-lab/collisionLabGame';
import { spriteFieldCamera } from '../screens/sprite-field/spriteFieldCamera';
import { cameraLabCamera } from '../screens/camera-lab/cameraLabCamera';
import CameraLabContent from '../screens/camera-lab/CameraLabContent';
import { CameraLabRenderer } from '../screens/camera-lab/CameraLabRenderer';
import { createCameraLabSession } from '../screens/camera-lab/cameraLabGame';
import { CollisionLabRenderer } from '../screens/collision-lab/CollisionLabRenderer';
import { createBootstrapGameSession } from '../screens/bootstrap/bootstrapGame';
import { createLabSession } from '../screens/lab/labSession';
import { createSpriteFieldSession, spriteFieldAssets } from '../screens/sprite-field/spriteFieldGame';
import { createIdleSession } from './idleSession';
import { isPlaygroundGameId, type PlaygroundGameId } from '../catalog/games';
import { usePlaygroundStore } from '../state/playgroundStore';
import type { PlaygroundGameContentProps } from './PlaygroundGameContentProps';
import {
  SurfaceController,
  type SurfaceGameEntry,
} from './surfaceController';
import {
  effectiveBinding,
  neutralSlot,
  type RunSurfaceEvent,
  type SlotAssets,
  type SurfaceSlot,
} from './surfaceSlot';
import HomeScreen from '../screens/home/HomeScreen';
import BrickBreakerContent from '../screens/brick-breaker/BrickBreakerContent';
import PaddleContent from '../screens/paddle/PaddleContent';
import CollisionLabContent from '../screens/collision-lab/CollisionLabContent';
import BootstrapContent from '../screens/bootstrap/BootstrapContent';
import LabContent from '../screens/lab/LabContent';
import SpriteFieldContent from '../screens/sprite-field/SpriteFieldContent';
import { BrickBreakerRenderer } from '../screens/brick-breaker/BrickBreakerRenderer';
import { BootstrapRenderer } from '../screens/bootstrap/BootstrapRenderer';
import { NeutralRenderer } from '../renderers/NeutralRenderer';
import { SpriteFieldRenderer } from '../screens/sprite-field/SpriteFieldRenderer';

/** The GameView's scene-map parameter when the surface treats games opaquely. */
type SceneDefinitionMarkerMap = Record<string, SceneDefinitionMarker>;

const FADE_DURATION_MS = 180;

/**
 * Stack-free playground shell with one long-lived game surface (T8).
 *
 * Navigation creates a unique request; the `SurfaceController` is the single
 * owner of the active/neutral slot, the pending asset request, the
 * Performance Lab attachment, retirement, and final disposal. GameView,
 * content, and pointer input all bind from the one published slot — they
 * borrow sessions and never dispose them.
 */
export function PlaygroundShell() {
  const currentGameId = usePlaygroundStore((state) => state.currentGameId);
  const openGame = usePlaygroundStore((state) => state.openGame);
  const closeGame = usePlaygroundStore((state) => state.closeGame);

  // The stable Home binding session: created once, owned by the controller,
  // disposed on final unmount. It is never retired by navigation.
  const [neutralSession] = useState(() => createIdleSession() as unknown as GameSession);
  const [slot, setSlot] = useState<SurfaceSlot>(() =>
    neutralSlot(
      INITIAL_GENERATION,
      neutralSession,
      NeutralRenderer as unknown as ComponentType<GameRendererProps<never>>,
    ),
  );
  const controllerRef = useRef<SurfaceController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new SurfaceController({
      games: GAME_CONTENTS,
      neutral: {
        session: neutralSession,
        renderer: NeutralRenderer as unknown as ComponentType<GameRendererProps<never>>,
      },
      createPlaceholder: () => createIdleSession() as unknown as GameSession,
      disposeSession,
      onSlot: (next) => setSlot(next),
      initialGeneration: INITIAL_GENERATION,
    });
  }
  const controller = controllerRef.current;

  // Asset display state (loading/error/ready) for the active Sprite Field
  // request; the slot itself only transitions on readiness.
  const [assetState, setAssetState] = useState<
    | { readonly requestId: number; readonly state: GameAssetsState<import('rn-gamekit').AssetGroupMap> }
    | undefined
  >(undefined);
  const handleAssetReady = useCallback(
    (requestId: number, assets: SlotAssets) => {
      controller.assetReady(requestId, assets);
    },
    [controller],
  );
  const handleAssetState = useCallback(
    (requestId: number, state: unknown) => {
      setAssetState({ requestId, state: state as GameAssetsState<import('rn-gamekit').AssetGroupMap> });
    },
    [],
  );
  const handleRunSurfaceEvent = useCallback(
    (event: RunSurfaceEvent) => {
      controller.runEvent(event);
    },
    [controller],
  );
  const handleBindingCommitted = useCallback(
    (generation: number) => {
      controller.bindingCommitted(generation);
    },
    [controller],
  );

  const handleOpenGame = useCallback(
    (gameId: PlaygroundGameId) => {
      // One explicit open event: a unique request, a fresh session, and a
      // new published binding — even when the catalog id is the same as the
      // previously opened game.
      controller.open(gameId);
      openGame(gameId);
    },
    [controller, openGame],
  );

  const handleCloseGame = useCallback(() => {
    controller.close();
    closeGame();
  }, [controller, closeGame]);

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

  // Final shell unmount: the controller disposes the active, pending,
  // retiring, and neutral-owned sessions exactly once.
  useEffect(
    () => () => {
      controllerRef.current?.dispose();
    },
    [],
  );

  const gameVisible = currentGameId !== null;
  const spriteFieldActive = slot.gameId === 'sprite-field' && slot.status !== 'neutral';
  const contentAssetState =
    slot.gameId === 'sprite-field' && assetState?.requestId === slot.requestId
      ? assetState.state
      : undefined;

  return (
    <View style={styles.shell}>
      {!gameVisible ? <HomeScreen onOpenGame={handleOpenGame} /> : null}
      {spriteFieldActive ? (
        <SpriteFieldAssetController
          key={slot.requestId}
          requestId={slot.requestId}
          onReady={handleAssetReady}
          onStateChange={handleAssetState}
        />
      ) : null}
      <GameSurface
        slot={slot}
        hidden={!gameVisible}
        onBindingCommitted={handleBindingCommitted}
        onExit={handleCloseGame}
        onOpenGame={handleOpenGame}
        onRunSurfaceEvent={handleRunSurfaceEvent}
        assetState={contentAssetState}
      />
    </View>
  );
}

const INITIAL_GENERATION = 1;

/**
 * The Sprite Field asset controller: mounts for the whole Sprite Field
 * request lifetime (loading AND ready) and unmounts only when the slot
 * leaves the game — so the lease the renderer borrows stays alive until the
 * replacement binding commits (T8.5). It is keyed by the request id: every
 * request owns a fresh acquisition, and a superseded request's lease is
 * released exactly once by unmount. The readiness callback carries the
 * request id; the controller ignores it when the request is no longer
 * current and never creates a gameplay session for a stale request.
 */
function SpriteFieldAssetController({
  requestId,
  onReady,
  onStateChange,
}: {
  readonly requestId: number;
  readonly onReady: (requestId: number, assets: SlotAssets) => void;
  readonly onStateChange: (requestId: number, state: unknown) => void;
}) {
  const state = useGameAssets(spriteFieldAssets, { groups: ['boot', 'gameplay'] });
  useEffect(() => {
    onStateChange(requestId, state);
    if (state.status === 'ready') {
      // The exact lease object passes through the slot unchanged: the
      // renderer calls `assets.get(...)` on it, so it must never be wrapped.
      onReady(requestId, state.assets as unknown as SlotAssets);
    }
  }, [onReady, onStateChange, requestId, state]);
  return null;
}

/**
 * The shell's long-lived surface. GameView remains mounted while its slot
 * changes; the per-binding presentation and pointer layers are keyed by the
 * slot generation and reset for every new session (T8.6). The rendered
 * generation is acknowledged after React commits it, which is what makes
 * retired sessions disposable.
 */
function GameSurface({
  slot,
  hidden,
  onBindingCommitted,
  onExit,
  onOpenGame,
  onRunSurfaceEvent,
  assetState,
}: {
  readonly slot: SurfaceSlot;
  readonly hidden: boolean;
  readonly onBindingCommitted: (generation: number) => void;
  readonly onExit: () => void;
  readonly onOpenGame: (gameId: PlaygroundGameId) => void;
  readonly onRunSurfaceEvent?: (event: RunSurfaceEvent) => void;
  readonly assetState?: GameAssetsState<import('rn-gamekit').AssetGroupMap>;
}) {
  const reduceMotion = useReducedMotion();
  // Explicit two-state visibility: opening fades to 1; closing fades to 0
  // (or snaps when reduced motion is enabled). The surface never stays at 1
  // just because the component itself did not remount (R1).
  const opacity = useSharedValue(0);
  // One derivation for every consumer: GameView, pointer, and instrumentation
  // bind the same session; the dev invariant fails close to the binding site
  // if a ready slot would publish a disposed session.
  const bound = effectiveBinding(slot);

  // T8.4: acknowledge the generation this render committed. Repeated
  // acknowledgment is idempotent, so a stale effect firing late is safe.
  useEffect(() => {
    onBindingCommitted(slot.generation);
  }, [onBindingCommitted, slot.generation]);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = hidden ? 0 : 1;
      return;
    }
    opacity.value = withTiming(hidden ? 0 : 1, { duration: FADE_DURATION_MS });
  }, [opacity, reduceMotion, hidden]);

  useEffect(() => {
    const game = bound.game;
    if (hidden) {
      if (game.status === 'running') {
        game.pause();
      }
      return;
    }
    if (game.status !== 'disposed') {
      game.start();
    }
  }, [hidden, bound.game]);

  const Renderer = slot.renderer;
  const Content = slot.content as ComponentType<PlaygroundGameContentProps> | undefined;

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
        game={bound.game}
        presentationKey={slot.generation}
        assets={bound.assets as never}
        renderer={Renderer as unknown as ComponentType<GameRendererProps<SceneDefinitionMarkerMap>>}
        camera2D={bound.camera2D as never}
        instrumentation={bound.instrumentation?.view ?? slot.run?.view}
        style={StyleSheet.absoluteFill}
      >
        {bound.pointerEnabled ? (
          <GamePointerInput
            // T8.6: the pointer rebinds with the same generation as the
            // presentation — a fresh RNGH detector per binding, never
            // object stringification.
            key={slot.generation}
            game={bound.pointerGame as GameSession<SceneDefinitionMarkerMap, Record<string, PointerInputAction>>}
            action={
              slot.gameId !== null && isPlaygroundGameId(slot.gameId)
                ? (GAME_CONTENTS[slot.gameId]?.pointerAction ?? 'primary')
                : 'primary'
            }
            instrumentation={bound.instrumentation?.pointer ?? slot.run?.pointer}
          />
        ) : null}
        {Content !== undefined ? (
          <Content
            game={slot.session}
            onExit={onExit}
            onOpenGame={onOpenGame}
            onRunSurfaceEvent={onRunSurfaceEvent}
            assetState={assetState}
          />
        ) : null}
      </GameView>
    </Animated.View>
  );
}

/** Content registry: the catalog id maps to content, renderer, session
 * factory, pointer capability, and asset backing. */
const GAME_CONTENTS: Record<PlaygroundGameId, SurfaceGameEntry> = {
  'brick-breaker': {
    renderer: BrickBreakerRenderer as unknown as ComponentType<GameRendererProps<never>>,
    content: BrickBreakerContent,
    createSession: () => createBrickBreakerSession() as unknown as GameSession,
    pointer: true,
  },
  'bootstrap': {
    renderer: BootstrapRenderer as unknown as ComponentType<GameRendererProps<never>>,
    content: BootstrapContent,
    createSession: () => createBootstrapGameSession() as unknown as GameSession,
    pointer: false,
  },
  'perf-lab': {
    renderer: BrickBreakerRenderer as unknown as ComponentType<GameRendererProps<never>>,
    content: LabContent,
    createSession: () => createLabSession() as unknown as GameSession,
    pointer: true,
  },
  'sprite-field': {
    renderer: SpriteFieldRenderer as unknown as ComponentType<GameRendererProps<never>>,
    content: SpriteFieldContent,
    createSession: () => createSpriteFieldSession() as unknown as GameSession,
    pointer: true,
    assetBacked: true,
    camera2D: spriteFieldCamera as unknown as GameCamera2DDefinition<never>,
  },
  'paddle': {
    renderer: PaddleRenderer as unknown as ComponentType<GameRendererProps<never>>,
    content: PaddleContent,
    createSession: () => createGameSession(paddleGame) as unknown as GameSession,
    pointer: true,
    pointerAction: 'steer',
  },
  'collision-lab': {
    renderer: CollisionLabRenderer as unknown as ComponentType<GameRendererProps<never>>,
    content: CollisionLabContent,
    createSession: () => createGameSession(collisionLabDefinition) as unknown as GameSession,
    pointer: true,
    assetBacked: true,
  },
  'camera-lab': {
    renderer: CameraLabRenderer as unknown as ComponentType<GameRendererProps<never>>,
    content: CameraLabContent,
    createSession: () => createCameraLabSession() as unknown as GameSession,
    pointer: true,
    camera2D: cameraLabCamera as unknown as GameCamera2DDefinition<never>,
    instrumented: true,
  },
};

function disposeSession(session: GameSession): void {
  if (session.status !== 'disposed') {
    session.dispose();
  }
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
