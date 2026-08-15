import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGameSessionStatus } from 'rn-gamekit/react';
import type { GameSession } from 'rn-gamekit';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import { PauseOverlay } from '../../docs-examples/paddle-tutorial/PauseOverlay';

/** Named header measurements: the overlay starts below this region. */
const HEADER_PADDING_TOP = 44;
const BACK_BUTTON_HEIGHT = 36;

/**
 * Paddle: the getting-started tutorial game as a catalog entry.
 *
 * The shell owns the session (created from the tutorial's `paddleGame`
 * definition) and mounts the pointer surface; this content renders the
 * safe-area header and the reference pause overlay, which derives entirely
 * from `useGameSessionStatus` and issues lifecycle commands directly.
 */
export default function PaddleContent({ game, onExit }: PlaygroundGameContentProps) {
  const session = game as GameSession;
  const status = useGameSessionStatus(session);
  const insets = useSafeAreaInsets();

  const contentTopInset = insets.top + HEADER_PADDING_TOP + BACK_BUTTON_HEIGHT;

  return (
    <View pointerEvents="box-none" style={styles.safeArea}>
      {/* The header renders as a sibling ABOVE the stage layer: its only
          interactive child (Back) stays reachable while the pause overlay
          blocks the gameplay stage below it. */}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {status === undefined ? null : (
          <PauseOverlay
            status={status}
            onPause={() => session.pause()}
            onResume={() => session.start()}
            topInset={insets.top}
            contentTopInset={contentTopInset}
          />
        )}
      </View>
      <View
        pointerEvents="box-none"
        style={[styles.header, { paddingTop: insets.top + HEADER_PADDING_TOP }]}
      >
        <Pressable
          accessibilityLabel="Back to playground"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onExit}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    left: 20,
    position: 'absolute',
    right: 20,
    top: 0,
  },
  backButton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
});
