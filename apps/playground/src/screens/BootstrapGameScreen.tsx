import { Circle } from '@shopify/react-native-skia';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameView, type GameRendererProps } from 'react-native-gamekit/react';
import type { PlaygroundStackParamList } from '../navigation/types';
import {
  bootstrapDefinition,
  bootstrapGame,
  type BootstrapSnapshot,
} from '../games/bootstrapGame';

function BootstrapRenderer({
  frame,
  surfaceSize,
}: GameRendererProps<BootstrapSnapshot>) {
  const scale = useDerivedValue(() => {
    const logical = bootstrapDefinition.viewport.logicalSize;
    return Math.min(
      surfaceSize.value.width / logical.width,
      surfaceSize.value.height / logical.height,
    );
  });
  const x = useDerivedValue(() => {
    const logical = bootstrapDefinition.viewport.logicalSize;
    const value = frame.value;
    const worldX =
      value.previous.ball.x +
      (value.current.ball.x - value.previous.ball.x) * value.alpha;
    return (surfaceSize.value.width - logical.width * scale.value) / 2 + worldX * scale.value;
  });
  const y = useDerivedValue(() => {
    const logical = bootstrapDefinition.viewport.logicalSize;
    return (
      (surfaceSize.value.height - logical.height * scale.value) / 2 +
      frame.value.current.ball.y * scale.value
    );
  });
  const radius = useDerivedValue(
    () => frame.value.current.ball.radius * scale.value,
  );
  const color = useDerivedValue(() => frame.value.current.ball.color);

  return <Circle cx={x} cy={y} r={radius} color={color} />;
}

type BootstrapGameScreenProps = NativeStackScreenProps<
  PlaygroundStackParamList,
  'BootstrapGame'
>;

/** First end-to-end GameKit runtime and Skia playground. */
export default function BootstrapGameScreen({ navigation }: BootstrapGameScreenProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <GameView game={bootstrapGame} renderer={BootstrapRenderer} style={styles.game}>
        <View
          pointerEvents="box-none"
          style={[styles.header, { paddingTop: insets.top + 44 }]}
        >
          <Pressable
            accessibilityLabel="Back to playground"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => navigation.goBack()}
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

        <View pointerEvents="box-none" style={styles.controls}>
          <Pressable
            accessibilityHint="Makes the ball move faster while held"
            accessibilityLabel="Boost"
            accessibilityRole="button"
            onPressIn={() => bootstrapGame.input.press('boost')}
            onPressOut={() => bootstrapGame.input.release('boost')}
            style={({ pressed }) => [styles.boost, pressed && styles.boostPressed]}
          >
            <Text style={styles.boostLabel}>Hold to boost</Text>
          </Pressable>
        </View>
      </GameView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#080b12',
  },
  game: {
    flex: 1,
    backgroundColor: '#0f1420',
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  backLabel: {
    color: '#a78bfa',
    fontSize: 15,
    fontWeight: '600',
  },
  eyebrow: {
    color: '#8b5cf6',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f4f4f5',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginTop: 6,
  },
  meta: {
    color: '#71717a',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginTop: 7,
  },
  controls: {
    alignItems: 'center',
    bottom: 28,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  boost: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 52,
    minWidth: 168,
    paddingHorizontal: 24,
  },
  boostPressed: {
    backgroundColor: '#6d28d9',
    transform: [{ scale: 0.98 }],
  },
  boostLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
