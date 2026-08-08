import { Circle } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameView, type GameRendererProps } from 'react-native-gamekit/react';
import { bootstrapDefinition, createBootstrapGameSession } from '../games/bootstrapGame';
import type { PlaygroundGameScreenProps } from '../shell/PlaygroundGameScreenProps';

/**
 * Renderer authoring only logical coordinates; the shared viewport supplies
 * the scale and letterbox offset so drawing and hit testing agree.
 */
function BootstrapRenderer({ frame, alpha, viewport }: GameRendererProps<typeof bootstrapDefinition['scenes']>) {
  const x = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    const worldX =
      value.previous.ball.x +
      (value.current.ball.x - value.previous.ball.x) * alpha.value;
    return worldX * surface.scale + surface.offsetX;
  });
  const y = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    if (surface === undefined || value.scene !== 'play') {
      return 0;
    }
    return value.current.ball.y * surface.scale + surface.offsetY;
  });
  const radius = useDerivedValue(() => {
    const surface = viewport.value;
    const value = frame.value;
    return surface === undefined || value.scene !== 'play'
      ? 0
      : value.current.ball.radius * surface.scale;
  });
  const color = useDerivedValue(() => {
    const value = frame.value;
    return value.scene === 'play' ? value.current.ball.color : '#000000';
  });

  return <Circle cx={x} cy={y} r={radius} color={color} />;
}

/**
 * First end-to-end GameKit runtime and Skia playground.
 *
 * The screen owns one session for its lifetime: created on mount and disposed
 * exactly once on unmount.
 */
export default function BootstrapGameScreen({ onExit }: PlaygroundGameScreenProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [session] = useState(() => createBootstrapGameSession());
  useEffect(
    () => () => {
      session.dispose();
    },
    [session],
  );

  return (
    <View style={styles.safeArea}>
      <GameView game={session} renderer={BootstrapRenderer} style={styles.game}>
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
      </GameView>
    </View>
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
