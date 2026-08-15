import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameSessionStatus } from 'rn-gamekit';

/**
 * Docs example pause UI: an accessible pause button outside the gameplay
 * hit surface and an overlay that keeps the last committed game frame
 * visible below it.
 *
 * The overlay is ordinary React UI: it issues lifecycle commands
 * (`session.pause()` / `session.start()`) and never owns the session. Its
 * visibility derives from the session status, so there is no second
 * isPaused state that can drift.
 */
export function PauseOverlay({
  status,
  onPause,
  onResume,
}: {
  readonly status: GameSessionStatus;
  readonly onPause: () => void;
  readonly onResume: () => void;
}) {
  return (
    <>
      {status === 'running' ? (
        <Pressable
          accessibilityLabel="Pause the game"
          accessibilityRole="button"
          onPress={onPause}
          style={styles.pauseButton}
          hitSlop={12}
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
            onPress={onResume}
            style={styles.resumeButton}
          >
            <Text style={styles.resumeLabel}>Resume</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pauseButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    position: 'absolute',
    right: 16,
    top: 16,
  },
  pauseLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
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
  overlayTitle: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 24,
  },
  resumeButton: {
    backgroundColor: '#0ea5e9',
    borderRadius: 999,
    paddingHorizontal: 36,
    paddingVertical: 14,
  },
  resumeLabel: {
    color: '#082f49',
    fontSize: 16,
    fontWeight: '800',
  },
});
