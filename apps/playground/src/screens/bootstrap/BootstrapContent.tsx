import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { GameSession } from 'rn-gamekit';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';

/**
 * First runtime slice content: the header and the boost control.
 *
 * Rendered inside the shell's single persistent GameView surface — this
 * content never mounts a GameView itself.
 */
export default function BootstrapContent({ game, onExit }: PlaygroundGameContentProps) {
  const session = game as GameSession;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  return (
    <View style={styles.safeArea}>
      <View
        pointerEvents="box-none"
        style={[styles.header, { paddingTop: insets.top + 44 }]}
      >
        <Pressable
          accessibilityLabel="Back to playground"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onExit}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>‹ Playground</Text>
        </Pressable>
        <Text style={styles.eyebrow}>React Native GameKit</Text>
        <Text style={styles.title}>First runtime slice</Text>
        <Text style={styles.meta}>
          {Platform.OS} · {Math.round(width)} × {Math.round(height)} pt
        </Text>
      </View>

      <View
        pointerEvents="box-none"
        style={[styles.controls, { bottom: insets.bottom + 28 }]}
      >
        <Pressable
          accessibilityHint="Makes the ball move faster while held"
          accessibilityLabel="Boost"
          accessibilityRole="button"
          onPressIn={() => session.input.press('boost')}
          onPressOut={() => session.input.release('boost')}
          style={({ pressed }) => [styles.boost, pressed && styles.boostPressed]}
        >
          <Text style={styles.boostLabel}>Hold to boost</Text>
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
    marginBottom: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  eyebrow: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 6,
  },
  meta: {
    color: '#64748b',
    fontVariant: ['tabular-nums'],
    fontSize: 13,
  },
  controls: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  boost: {
    backgroundColor: '#0ea5e9',
    borderRadius: 999,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  boostPressed: {
    backgroundColor: '#0284c7',
  },
  boostLabel: {
    color: '#082f49',
    fontSize: 15,
    fontWeight: '800',
  },
});
