import { useEffect, type ComponentType } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  GamePointerInput,
  GameView,
  type GameAssetsState,
  type GameRendererProps,
} from 'rn-gamekit/react';
import type { GameSession, PointerInputAction, SceneDefinitionMarker } from 'rn-gamekit';

import { AssetGateOverlay } from './AssetGateOverlay';
import { type PlaygroundGameId } from '../catalog/games';
import type { PlaygroundGameContentProps } from './PlaygroundGameContentProps';
import { effectiveBinding, type RunSurfaceEvent, type SurfaceSlot } from './surfaceSlot';

type SceneDefinitionMarkerMap = Record<string, SceneDefinitionMarker>;

const FADE_DURATION_MS = 180;

/**
 * The shell's long-lived surface. GameView remains mounted while its slot
 * changes; the per-binding presentation and pointer layers are keyed by the
 * slot generation and reset for every new session (T8.6). The rendered
 * generation is acknowledged after React commits it, which is what makes
 * retired sessions disposable.
 */
export function GameSurface({
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
  const opacity = useSharedValue(0);
  const bound = effectiveBinding(slot);

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
  const showAssetGate = slot.status === 'loading';

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
            key={slot.generation}
            game={bound.pointerGame as GameSession<SceneDefinitionMarkerMap, Record<string, PointerInputAction>>}
            // The declared action travels with the open-ready event
            // (SurfaceGameEntry.pointerAction); reference games default to
            // `primary`.
            action={slot.pointerAction ?? 'primary'}
            instrumentation={bound.instrumentation?.pointer ?? slot.run?.pointer}
          />
        ) : null}
        {showAssetGate ? (
          <AssetGateOverlay gameId={slot.gameId} assetState={assetState} onExit={onExit} />
        ) : Content !== undefined ? (
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

const styles = StyleSheet.create({
  gameSurface: {
    backgroundColor: '#080b12',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
