import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface LabHeaderProps {
  readonly title: string;
  readonly onExit?: () => void;
  readonly testID?: string;
}

/**
 * Shared lab header — same design across every playground lab.
 * Used by Particle, Audio, Storage, Platformer, etc. to ensure
 * consistent safe-area handling and back-button placement.
 */
export function LabHeader({ title, onExit, testID }: LabHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel="Back to playground"
        onPress={onExit}
        style={styles.backButton}
      >
        <Text style={styles.backText}>{'\u2715'}</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backButton: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    minWidth: 36,
    alignItems: 'center',
  },
  backText: { color: 'white', fontSize: 14, fontWeight: '700' },
  title: { color: 'white', fontSize: 18, fontWeight: '700' },
  headerSpacer: { flex: 1 },
});
