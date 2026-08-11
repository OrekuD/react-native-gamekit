import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BrickBreakerSession } from '../games/brickBreakerGame';
import type { PlaygroundGameContentProps } from '../shell/PlaygroundGameContentProps';
import { hudEqual, selectHud, type HudState } from './brickBreakerHud';
import { createHudObserver } from './hudObserver';

/**
 * Commit-frequency HUD hook. Live gameplay positions never enter React state;
 * only visible score/scene/prompt changes request a screen render.
 */
function useHudValue(
  session: BrickBreakerSession,
): HudState {
  const [value, setValue] = useState<HudState>(() => selectHud(session.getRenderFrame()));
  useEffect(() => {
    const observer = createHudObserver(selectHud, hudEqual, selectHud(session.getRenderFrame()));
    return session.addCommitListener((frame) => {
      if (observer.observe(frame)) {
        setValue(observer.value);
      }
    }).remove;
  }, [session]);
  return value;
}

/**
 * Brick Breaker content: the HUD, the back bar, and the start surface.
 *
 * Rendered inside the shell's single persistent GameView surface — this
 * content never mounts a GameView or pointer surface itself.
 */
export default function BrickBreakerContent({ game, onExit }: PlaygroundGameContentProps) {
  const session = game as BrickBreakerSession;
  const hud = useHudValue(session);

  const startOrRestart = useCallback(() => {
    if (session.status === 'disposed') {
      return;
    }
    // A complete semantic button pulse means the entire body can start the
    // game without inventing a paddle coordinate or leaving ownership held.
    session.input.press('start');
    session.input.release('start');
  }, [session]);

  return (
    <SafeAreaView
      edges={['top', 'right', 'bottom', 'left']}
      pointerEvents="box-none"
      style={styles.screen}
    >
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Back to playground"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onExit}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          Brick Breaker
        </Text>
        <View aria-hidden style={styles.topBarSide} />
      </View>

      <GameHud hud={hud} />

      {hud.awaitingStart ? (
        <Pressable
          accessibilityHint="Starts or restarts Brick Breaker"
          accessibilityLabel={hud.prompt}
          accessibilityRole="button"
          onPress={startOrRestart}
          style={({ pressed }) => [
            StyleSheet.absoluteFill,
            pressed && styles.startSurfacePressed,
          ]}
          testID="brick-breaker-start-surface"
        />
      ) : null}
    </SafeAreaView>
  );
}

function GameHud({ hud }: { readonly hud: HudState }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.score}>
        <Text style={styles.scoreLabel}>Score</Text>
        <Text style={styles.scoreValue}>{String(hud.score).padStart(2, '0')}</Text>
      </View>

      {hud.awaitingStart ? (
        <View style={styles.promptWrap}>
          <Text style={styles.prompt}>{hud.prompt}</Text>
        </View>
      ) : null}

      {hud.prompt === 'Game over — tap to play again' ? (
        <View style={styles.promptWrap}>
          <Text style={styles.prompt}>{hud.prompt}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  backButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  backIcon: {
    color: '#e2e8f0',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  topBarSide: {
    height: 44,
    width: 44,
  },
  score: {
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 12,
  },
  scoreLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
  },
  scoreValue: {
    color: '#f8fafc',
    fontVariant: ['tabular-nums'],
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  promptWrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 400,
  },
  prompt: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowRadius: 8,
  },
  startSurfacePressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});
