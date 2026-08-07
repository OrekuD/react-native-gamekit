import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GamePointerInput, GameView } from 'react-native-gamekit/react';
import type { PlaygroundGameScreenProps } from '../shell/PlaygroundGameScreenProps';
import {
  createBrickBreakerSession,
  type BrickBreakerSession,
} from '../games/brickBreakerGame';
import { BrickBreakerRenderer } from '../renderers/BrickBreakerRenderer';
import { hudEqual, selectHud } from './brickBreakerHud';

/**
 * Low-frequency HUD selector: React state updates only when the selected HUD
 * value changes (compared with `hudEqual`), so live gameplay positions never
 * flow through React and unchanged frames never trigger another render.
 */
function useHudValue<T>(
  session: BrickBreakerSession,
  select: (frame: Parameters<typeof selectHud>[0]) => T,
  equals: (a: T, b: T) => boolean,
): T {
  const [value, setValue] = useState<T>(() => select(session.getRenderFrame()));
  useEffect(
    () =>
      session.addRenderFrameListener((frame) => {
        setValue((previous) => {
          const next = select(frame);
          return equals(previous, next) ? previous : next;
        });
      }).remove,
    [equals, select, session],
  );
  return value;
}

/** The playground owns exactly one Brick Breaker session and disposes it here. */
export default function BrickBreakerGameScreen({ onExit }: PlaygroundGameScreenProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // The screen owns exactly one session for its whole lifetime.
  const [session] = useState<BrickBreakerSession>(() => createBrickBreakerSession());

  // Final unmount disposes the session exactly once, after all other
  // cleanups (focus, view, pointer input) have paused it.
  useEffect(
    () => () => {
      session.dispose();
    },
    [session],
  );

  const hud = useHudValue(session, selectHud, hudEqual);

  return (
    <View style={styles.safeArea}>
      <GameView game={session} renderer={BrickBreakerRenderer} style={styles.game}>
        <GamePointerInput game={session} action="primary" />
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
          <Text style={styles.title}>Brick Breaker</Text>
          <Text style={styles.meta}>
            {Platform.OS} · {Math.round(width)} × {Math.round(height)} pt · score{' '}
            {hud.score}
          </Text>
        </View>

        {hud.scene === 'play' && hud.prompt !== '' ? (
          <View pointerEvents="none" style={[styles.promptWrap, { bottom: insets.bottom + 120 }]}>
            <Text style={styles.prompt}>{hud.prompt}</Text>
          </View>
        ) : null}
        {hud.scene !== 'play' ? (
          <View pointerEvents="none" style={[styles.promptWrap, { bottom: insets.bottom + 120 }]}>
            <Text style={styles.prompt}>{hud.prompt}</Text>
          </View>
        ) : null}
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
  promptWrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  prompt: {
    color: '#cbd5e1',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
