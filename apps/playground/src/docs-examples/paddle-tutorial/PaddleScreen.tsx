import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { GamePointerInput, GameView, useGameSession, useGameSessionStatus } from 'rn-gamekit/react';
import { paddleGame } from './game';
import { PauseOverlay } from './PauseOverlay';
import { PaddleRenderer } from './Renderer';

/**
 * Docs example screen: the canonical React Native Gamekit mount with a
 * pause overlay.
 *
 * `useGameSession` owns creation and terminal disposal; `GameView` borrows
 * the session, starts it while mounted, and pauses it on unmount and app
 * backgrounding. The pause overlay derives entirely from
 * `useGameSessionStatus`, issues lifecycle commands directly, and never
 * owns or disposes the session.
 */
export function PaddleScreen() {
  const session = useGameSession(paddleGame);
  const status = useGameSessionStatus(session);

  if (session === undefined || status === undefined) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.root}>
        <GameView game={session} renderer={PaddleRenderer} style={StyleSheet.absoluteFill}>
          <GamePointerInput game={session} action="steer" />
        </GameView>
        <PauseOverlay
          status={status}
          onPause={() => session.pause()}
          onResume={() => session.start()}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
