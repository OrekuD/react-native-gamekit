import { useEffect, type ComponentType } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import type { PlaygroundGameId } from '../catalog/games';
import { usePlaygroundStore } from '../state/playgroundStore';
import HomeScreen from '../screens/HomeScreen';
import BootstrapGameScreen from '../screens/BootstrapGameScreen';
import BrickBreakerGameScreen from '../screens/BrickBreakerGameScreen';
import type { PlaygroundGameScreenProps } from './PlaygroundGameScreenProps';

/** Duration of the opacity-only game fade, in milliseconds. */
const FADE_DURATION_MS = 180;

/**
 * Exhaustive screen registry: adding a catalog id without a corresponding game
 * screen fails typecheck.
 */
const GAME_SCREENS: Record<PlaygroundGameId, ComponentType<PlaygroundGameScreenProps>> = {
  'brick-breaker': BrickBreakerGameScreen,
  bootstrap: BootstrapGameScreen,
};

/**
 * Stack-free playground shell.
 *
 * It reads exactly one low-frequency value from the Zustand store
 * (`currentGameId`) and conditionally mounts the home catalog or a single game
 * screen behind an opaque background. There is no navigation stack, so no
 * native back gesture exists for gameplay swipes to trigger.
 */
export function PlaygroundShell() {
  const currentGameId = usePlaygroundStore((state) => state.currentGameId);
  const closeGame = usePlaygroundStore((state) => state.closeGame);

  // Android hardware back closes the active game; on the home screen the OS
  // retains its normal exit behavior.
  useEffect(() => {
    if (currentGameId === null) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeGame();
      return true;
    });
    return () => subscription.remove();
  }, [closeGame, currentGameId]);

  return (
    <View style={styles.shell}>
      {currentGameId === null ? (
        <HomeScreen />
      ) : (
        <GameFade key={currentGameId} gameId={currentGameId} onExit={closeGame} />
      )}
    </View>
  );
}

/**
 * Fade a newly selected game in on the UI thread.
 *
 * The opacity runs through a Reanimated shared value, never React state. When
 * the system prefers reduced motion the screen appears immediately without an
 * artificial delay. The `key` remounts the surface when the selection changes,
 * giving the new game screen a fresh session.
 */
function GameFade({
  gameId,
  onExit,
}: {
  readonly gameId: PlaygroundGameId;
  readonly onExit: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withTiming(1, { duration: FADE_DURATION_MS });
  }, [opacity, reduceMotion]);

  const Screen = GAME_SCREENS[gameId];

  return (
    <Animated.View
      accessibilityViewIsModal
      onAccessibilityEscape={onExit}
      style={[styles.gameSurface, { opacity }]}
    >
      <Screen onExit={onExit} />
    </Animated.View>
  );
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
