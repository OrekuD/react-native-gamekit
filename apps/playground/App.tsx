import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { defineGame } from 'react-native-gamekit';
import { bootstrapGame } from './src/games/bootstrapGame';

/**
 * Bootstrap status screen.
 *
 * Shows the app identity, current platform, the live window size (updates on
 * rotation, resize, and iPad split view), and whether the local GameKit
 * package import resolved. No game rendering yet.
 */
export default function App() {
  const { width, height } = useWindowDimensions();
  const gameKitLoaded = typeof defineGame === 'function';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>React Native GameKit</Text>
          <Text style={styles.subtitle}>Playground</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Platform</Text>
            <Text style={styles.rowValue}>{Platform.OS}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Window size</Text>
            <Text style={styles.rowValue}>
              {Math.round(width)} × {Math.round(height)} pt
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>GameKit import</Text>
            <Text style={[styles.rowValue, gameKitLoaded ? styles.ok : styles.missing]}>
              {gameKitLoaded ? 'loaded' : 'missing'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Initial scene</Text>
            <Text style={styles.rowValue}>{bootstrapGame.initialScene}</Text>
          </View>
        </View>

        <Text style={styles.hint}>
          Resize, rotate, or split the window — the size above updates live.
        </Text>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b0f14',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 28,
  },
  header: {
    alignItems: 'center',
    gap: 4,
  },
  title: {
    color: '#e8edf4',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#5f6b7a',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: '#121820',
    borderColor: '#1f2833',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  rowLabel: {
    color: '#5f6b7a',
    fontSize: 13,
    fontWeight: '500',
  },
  rowValue: {
    color: '#e8edf4',
    fontVariant: ['tabular-nums'],
    fontSize: 15,
    fontWeight: '600',
  },
  ok: {
    color: '#4ade80',
  },
  missing: {
    color: '#f87171',
  },
  hint: {
    color: '#5f6b7a',
    fontSize: 12,
    textAlign: 'center',
  },
});
