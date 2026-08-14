import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { GamePointerInput, GameView, useGameSession } from 'rn-gamekit/react';
import { paddleGame } from './game';
import { PaddleRenderer } from './Renderer';

/**
 * Docs example screen: the canonical React Native Gamekit mount.
 *
 * `useGameSession` owns creation and terminal disposal; `GameView` borrows
 * the session, starts it while mounted, and pauses it on unmount and app
 * backgrounding. The hook returns `undefined` only until a session is
 * committed for the definition, so the deliberate fallback renders nothing
 * for that single frame.
 */
export function PaddleScreen() {
  const session = useGameSession(paddleGame);

  if (session === undefined) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <GameView game={session} renderer={PaddleRenderer} style={StyleSheet.absoluteFill}>
        <GamePointerInput game={session} action="steer" />
      </GameView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

