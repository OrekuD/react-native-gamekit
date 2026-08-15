import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GamePointerInput, GameView, useGameSession, useGameSessionStatus } from 'rn-gamekit/react';
import { paddleGame } from './game';
import { PaddleRenderer } from './Renderer';

/**
 * The pause-and-resume guide's copyable screen, kept in-tree so the guide's
 * snippet is compile-checked against the real API. It is a parallel
 * implementation of the tested `PauseOverlay` composition (deliberately
 * self-contained so it can be pasted into the tutorial project); the
 * playground's Paddle game uses the shared `PauseOverlay` component instead.
 */
export function PauseGameScreen() {
  const session = useGameSession(paddleGame);
  const status = useGameSessionStatus(session);

  if (session === undefined || status === undefined) {
    return null;
  }

  return (
    <View style={styles.root}>
      <GameView game={session} renderer={PaddleRenderer}>
        <GamePointerInput game={session} action="steer" />
      </GameView>

      {status === 'running' ? (
        <Pressable
          accessibilityLabel="Pause the game"
          accessibilityRole="button"
          onPress={() => session.pause()}
          hitSlop={12}
          style={styles.pauseButton}
        >
          <Text style={styles.pauseLabel}>Pause</Text>
        </Pressable>
      ) : null}

      {status === 'paused' ? (
        <View style={styles.overlay} pointerEvents="auto">
          <Text style={styles.overlayTitle}>Paused</Text>
          <Pressable
            accessibilityLabel="Resume the game"
            accessibilityRole="button"
            onPress={() => session.start()}
            style={styles.resumeButton}
          >
            <Text style={styles.resumeLabel}>Resume</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pauseButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
    position: 'absolute',
    right: 16,
    top: 16,
  },
  pauseLabel: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  overlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
  },
  overlayTitle: { color: '#f8fafc', fontSize: 28, fontWeight: '800', marginBottom: 24 },
  resumeButton: {
    backgroundColor: '#0ea5e9',
    borderRadius: 999,
    paddingHorizontal: 36,
    paddingVertical: 16,
  },
  resumeLabel: { color: '#082f49', fontSize: 16, fontWeight: '800' },
});
