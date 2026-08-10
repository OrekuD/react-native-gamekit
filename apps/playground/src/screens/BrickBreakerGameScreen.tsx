import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GamePointerInput, GameView } from 'react-native-gamekit/react';
import {
  BRICK_BREAKER_CONFIG,
  createBrickBreakerSession,
  type BrickBreakerSession,
} from '../games/brickBreakerGame';
import { BrickBreakerRenderer } from '../renderers/BrickBreakerRenderer';
import type { PlaygroundGameScreenProps } from '../shell/PlaygroundGameScreenProps';
import { hudEqual, selectHud, type HudState } from './brickBreakerHud';
import { fitGameStage, type StageSize } from './fitGameStage';
import { createHudObserver } from './hudObserver';

const STAGE_HORIZONTAL_INSET = 12;
const STAGE_TOP_GAP = 10;
const STAGE_BOTTOM_INSET = 12;
const EMPTY_STAGE = Object.freeze({ width: 0, height: 0 });

/**
 * Commit-frequency HUD hook. Live gameplay positions never enter React state;
 * only visible score/scene/prompt changes request a screen render.
 */
function useHudValue<T>(
  session: BrickBreakerSession,
  select: (frame: Parameters<typeof selectHud>[0]) => T,
  equals: (a: T, b: T) => boolean,
): T {
  const [value, setValue] = useState<T>(() => select(session.getRenderFrame()));
  useEffect(() => {
    const observer = createHudObserver(select, equals, select(session.getRenderFrame()));
    return session.addCommitListener((frame) => {
      if (observer.observe(frame)) {
        setValue(observer.value);
      }
    }).remove;
  }, [equals, select, session]);
  return value;
}

/** The playground owns exactly one Brick Breaker session and disposes it here. */
export default function BrickBreakerGameScreen({ onExit }: PlaygroundGameScreenProps) {
  const [session] = useState<BrickBreakerSession>(() => createBrickBreakerSession());
  const [stageSize, setStageSize] = useState<StageSize>(EMPTY_STAGE);

  useEffect(
    () => () => {
      session.dispose();
    },
    [session],
  );

  const hud = useHudValue(session, selectHud, hudEqual);

  const handleStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const nextSize = fitGameStage(
      {
        width: Math.max(0, width - STAGE_HORIZONTAL_INSET * 2),
        height: Math.max(0, height - STAGE_TOP_GAP - STAGE_BOTTOM_INSET),
      },
      {
        width: BRICK_BREAKER_CONFIG.logicalWidth,
        height: BRICK_BREAKER_CONFIG.logicalHeight,
      },
    );
    setStageSize((current) =>
      current.width === nextSize.width && current.height === nextSize.height
        ? current
        : nextSize,
    );
  }, []);

  const startOrRestart = useCallback(() => {
    if (session.status === 'disposed') {
      return;
    }
    // A complete semantic button pulse means the entire body can start the
    // game without inventing a paddle coordinate or leaving ownership held.
    session.input.press('start');
    session.input.release('start');
  }, [session]);

  const hasStage = stageSize.width > 0 && stageSize.height > 0;

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.screen}>
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

      <View onLayout={handleStageLayout} style={styles.stageSlot} testID="brick-breaker-body">
        {hasStage ? (
          <View style={[styles.stageFrame, stageSize]}>
            <GameView game={session} renderer={BrickBreakerRenderer} style={styles.game}>
              <GamePointerInput game={session} action="primary" />
              <GameHud hud={hud} />
            </GameView>
          </View>
        ) : null}

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
          <Text style={styles.promptHint}>Tap anywhere</Text>
        </View>
      ) : (
        <View style={styles.playHintWrap}>
          <Text style={styles.playHint}>{hud.prompt}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#080b12',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 52,
    paddingHorizontal: 8,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#171b27',
    borderRadius: 15,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  backButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  backIcon: {
    color: '#c4b5fd',
    fontSize: 34,
    fontWeight: '400',
    lineHeight: 36,
    marginTop: -2,
  },
  title: {
    color: '#f8fafc',
    flex: 1,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.35,
    textAlign: 'center',
  },
  topBarSide: {
    height: 44,
    width: 44,
  },
  stageSlot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-start',
    paddingBottom: STAGE_BOTTOM_INSET,
    paddingHorizontal: STAGE_HORIZONTAL_INSET,
    paddingTop: STAGE_TOP_GAP,
    position: 'relative',
  },
  stageFrame: {
    backgroundColor: '#0f1420',
    borderRadius: 26,
    elevation: 8,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  game: {
    flex: 1,
    backgroundColor: '#0f1420',
  },
  score: {
    left: 18,
    position: 'absolute',
    top: 15,
  },
  scoreLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  scoreValue: {
    color: '#f8fafc',
    fontSize: 24,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 1,
  },
  promptWrap: {
    alignItems: 'center',
    left: 24,
    position: 'absolute',
    right: 24,
    top: '44%',
  },
  prompt: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.25,
    textAlign: 'center',
  },
  promptHint: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 7,
    textAlign: 'center',
  },
  playHintWrap: {
    alignItems: 'center',
    bottom: '12%',
    left: 20,
    position: 'absolute',
    right: 20,
  },
  playHint: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  startSurfacePressed: {
    backgroundColor: 'rgba(167, 139, 250, 0.05)',
  },
});
