import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BrickBreakerSession } from '../games/brickBreakerGame';
import type { PlaygroundGameContentProps } from '../shell/PlaygroundGameContentProps';
import { BRICK_BREAKER_LAYOUT } from './brickBreakerLayout';
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
 * Brick Breaker content (T8.1): two sibling interaction regions.
 *
 * The safe-area top bar (back control + centered title) and the gameplay
 * stage are separate layout regions; the full-stage start/restart surface is
 * absolutely filled INSIDE the stage only, so the header is structurally
 * outside the gameplay hit surface and the back control can never be
 * intercepted by the start overlay.
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
    <SafeAreaView pointerEvents="box-none"
      edges={['top', 'right', 'bottom', 'left']}
      style={styles.screen}
    >
      <View style={styles.topBar} testID={BRICK_BREAKER_LAYOUT.topBar.testID}>
        <Pressable
          accessibilityLabel="Back to playground"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onExit}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          testID={BRICK_BREAKER_LAYOUT.topBar.back.testID}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {BRICK_BREAKER_LAYOUT.topBar.title}
        </Text>
        <View aria-hidden style={styles.topBarSide} />
      </View>

      <View style={styles.stage} testID={BRICK_BREAKER_LAYOUT.stage.testID}>
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
            testID={BRICK_BREAKER_LAYOUT.stage.startSurface.testID}
          />
        ) : null}
      </View>
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
  stage: {
    flex: 1,
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
    top: 360,
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
