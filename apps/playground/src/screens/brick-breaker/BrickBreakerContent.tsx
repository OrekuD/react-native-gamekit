import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createGameAudio } from 'rn-gamekit/audio';
import { createGameHaptics } from 'rn-gamekit/haptics';

import type { BrickBreakerSession } from './brickBreakerGame';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
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
 * Transient brick-hit count consumed outside simulation (T13.4).
 *
 * The count is a pure effect of committed events — it never feeds back
 * into score, collision, or scene-transition authority. Rerenders,
 * interpolation frames, pause/resume, and catch-up ticks do not duplicate
 * the count because events are published once per successful tick.
 */
function useBrickHitCount(session: BrickBreakerSession): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // Reset on session change (surface controller swaps).
    // eslint-disable-next-line -- reset is intentional for session swap
    setCount(0);
    const sub = session.addGameEventListener('brick-hit', () => {
      setCount((prev) => prev + 1);
    });
    return sub.remove;
  }, [session]);
  return count;
}

const BRICK_SFX = require('../../../assets/audio/sfx.wav') as number;
const BRICK_MUSIC = require('../../../assets/audio/music.wav') as number;

function useBrickBreakerFeedback(session: BrickBreakerSession) {
  const audioRef = useRef<Awaited<ReturnType<typeof createGameAudio>> | null>(null);
  const hapticsRef = useRef<ReturnType<typeof createGameHaptics> | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let audio: Awaited<ReturnType<typeof createGameAudio>> | null = null;
    let haptics: ReturnType<typeof createGameHaptics> | null = null;
    let subs: { remove: () => void }[] = [];

    (async () => {
      try {
        audio = await createGameAudio({ sounds: { brickHit: BRICK_SFX, lifeLost: BRICK_SFX, gameOver: BRICK_MUSIC } });
        if (cancelled) { audio.dispose(); return; }
        haptics = createGameHaptics();
        audioRef.current = audio;
        hapticsRef.current = haptics;
        setAudioReady(true);
        // Bind session pause to audio (lifecycle T14.4)
        const statusSub = session.addStatusListener((status) => {
          if (status === 'paused') {
            audio?.pause();
            (haptics as unknown as { _setPaused?: (p:boolean)=>void })?._setPaused?.(true);
          } else if (status === 'running') {
            audio?.resume();
            (haptics as unknown as { _setPaused?: (p:boolean)=>void })?._setPaused?.(false);
          }
        });
        subs.push(statusSub);
        // Event-driven feedback (T14.6) — never feeds back into simulation
        subs.push(session.addGameEventListener('brick-hit', () => {
          audioRef.current?.play('brickHit', { category: 'sfx', concurrency: { key: 'brickHit', limit: 4, overflow: 'drop-new' } });
          hapticsRef.current?.play('impact');
        }));
        subs.push(session.addGameEventListener('life-lost', () => {
          audioRef.current?.play('lifeLost', { category: 'sfx' });
          hapticsRef.current?.play('heavy');
        }));
        subs.push(session.addGameEventListener('game-over', () => {
          void audioRef.current?.playMusic('gameOver');
          const r = hapticsRef.current?.play('success');
          void r;
        }));
        // Initial music: one looping track, replace on game-over
        void audio.playMusic('gameOver');
      } catch (e) {
        console.warn('[BrickBreakerFeedback] init failed', e);
      }
    })();
    return () => {
      cancelled = true;
      subs.forEach((s) => { try { s.remove(); } catch {} });
      audioRef.current?.dispose();
      hapticsRef.current?.dispose();
      audioRef.current = null;
      hapticsRef.current = null;
    };
  }, [session]);

  return { audioRef, hapticsRef, audioReady } as const;
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
  const hitCount = useBrickHitCount(session);
  const { audioRef, hapticsRef, audioReady } = useBrickBreakerFeedback(session);
  const [sfxVolume, setSfxVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);

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

      <View
        pointerEvents={BRICK_BREAKER_LAYOUT.stage.pointerEvents}
        style={styles.stage}
        testID={BRICK_BREAKER_LAYOUT.stage.testID}
      >
        <GameHud hud={hud} hitCount={hitCount} />
        <View pointerEvents="box-none" style={styles.feedbackBar}>
          <Text style={styles.feedbackText}>Audio {audioReady ? 'ready' : 'loading'}</Text>
          <Pressable
            onPress={() => {
              const next = !isMuted;
              setIsMuted(next);
              audioRef.current?.setMuted(next);
              hapticsRef.current?.setMuted(next);
            }}
            style={styles.miniButton}
          >
            <Text style={styles.miniButtonText}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const next = sfxVolume >= 0.8 ? 0.4 : 0.8;
              setSfxVolume(next);
              audioRef.current?.setVolume('sfx', next);
            }}
            style={styles.miniButton}
          >
            <Text style={styles.miniButtonText}>SFX {Math.round(sfxVolume * 100)}%</Text>
          </Pressable>
        </View>

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

function GameHud({ hud, hitCount }: { readonly hud: HudState; readonly hitCount: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.score}>
        <Text style={styles.scoreLabel}>Score</Text>
        <Text style={styles.scoreValue}>{String(hud.score).padStart(2, '0')}</Text>
        <Text style={styles.hitCount} testID="brick-hit-count">
          Hits {String(hitCount).padStart(2, '0')}
        </Text>
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
  hitCount: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 2,
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
  feedbackBar: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    padding: 8,
    borderRadius: 8,
  },
  feedbackText: {
    color: '#e2e8f0',
    fontSize: 11,
    flex: 1,
  },
  miniButton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  miniButtonText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  startSurfacePressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});
