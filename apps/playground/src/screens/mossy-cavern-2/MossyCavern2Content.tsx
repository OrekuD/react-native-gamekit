/**
 * Static HUD, touch controls, and native effects for Mossy Cavern 2.
 *
 * The game session remains the only per-tick store. React updates here only
 * on coarse commits, user settings, asynchronous device capability setup,
 * and committed gameplay events.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createGameAudio } from 'rn-gamekit/audio';
import { createGameHaptics } from 'rn-gamekit/haptics';
import { GameButton, GameButtonPad } from 'rn-gamekit/react';
import { createGameSaveStore, createGameStorageAdapter } from 'rn-gamekit/storage';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import {
  MOSSY_CAVERN_2_AUDIO_SOURCES,
  MOSSY_CAVERN_2_PROMPTS,
  type MossyCavern2Session,
  type MossyCavern2Snapshot,
} from './mossyCavern2Game.ts';
import {
  DEFAULT_MOSSY_CAVERN_2_PROFILE,
  mossyCavern2ProfileSchema,
  readStartupMossyCavern2Profile,
  type MossyCavern2Profile,
} from './mossyCavern2Save.ts';

type AudioHandle = Awaited<ReturnType<typeof createGameAudio>>;
type HapticsHandle = ReturnType<typeof createGameHaptics>;

interface HudState {
  readonly relicCount: number;
  readonly checkpointIndex: number;
  readonly status: MossyCavern2Snapshot['status'];
}

function readSnapshot(session: MossyCavern2Session): MossyCavern2Snapshot {
  return session.getRenderFrame().current;
}

function readHud(session: MossyCavern2Session): HudState {
  const snapshot = readSnapshot(session);
  return {
    relicCount: snapshot.relicCount,
    checkpointIndex: snapshot.checkpointIndex,
    status: snapshot.status,
  };
}

function sameHud(first: HudState, second: HudState): boolean {
  return (
    first.relicCount === second.relicCount &&
    first.checkpointIndex === second.checkpointIndex &&
    first.status === second.status
  );
}

function formatTime(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export default function MossyCavern2Content({ game, onExit, startupSave }: PlaygroundGameContentProps) {
  const session = game as MossyCavern2Session;
  const insets = useSafeAreaInsets();
  // T20G-R2: the hydrated projection is the durable baseline. It initializes
  // the profile state and ref SYNCHRONOUSLY — before any event listener can
  // persist — so an early gameplay save derives from the hydrated record and
  // never clobbers stored best times, mute settings, or counters with
  // default-derived data.
  const startupProfile = readStartupMossyCavern2Profile(startupSave);
  const [hud, setHud] = useState<HudState>(() => readHud(session));
  const hudRef = useRef(hud);
  const [profile, setProfile] = useState<MossyCavern2Profile>(
    startupProfile ?? DEFAULT_MOSSY_CAVERN_2_PROFILE,
  );
  const profileRef = useRef(profile);
  const [paused, setPaused] = useState(session.status === 'paused');
  const [notice, setNotice] = useState('Find the three dew relics and awaken the root shrine.');
  const [saveState, setSaveState] = useState('Journal ready');
  const audioRef = useRef<AudioHandle | null>(null);
  const hapticsRef = useRef<HapticsHandle | null>(null);
  const saveStoreRef = useRef<ReturnType<typeof createGameSaveStore<MossyCavern2Profile>> | null>(null);
  const mountedRef = useRef(true);
  const profileChangedBeforeLoadRef = useRef(false);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    },
    [],
  );

  const persistProfile = useCallback((next: MossyCavern2Profile): void => {
    profileChangedBeforeLoadRef.current = true;
    profileRef.current = next;
    setProfile(next);
    const store = saveStoreRef.current;
    if (store === null) return;
    void store.save('profile', next).then(
      () => {
        if (mountedRef.current) setSaveState('Journal saved');
      },
      () => {
        if (mountedRef.current) setSaveState('Journal unavailable on this build');
      },
    );
  }, []);

  // Coarse UI observer: React receives only values that visibly changed,
  // never the session's per-frame state.
  useEffect(() => {
    const subscription = session.addCommitListener(() => {
      const next = readHud(session);
      if (!sameHud(hudRef.current, next)) {
        hudRef.current = next;
        setHud(next);
      }
    });
    return () => subscription.remove();
  }, [session]);

  useEffect(() => {
    const subscription = session.addStatusListener((status) => {
      setPaused(status === 'paused');
      if (status === 'paused') audioRef.current?.pause();
      if (status === 'running') audioRef.current?.resume();
    });
    return () => subscription.remove();
  }, [session]);

  // Saves are a durable profile/statistics projection. The shell's async
  // factory seeds the live session from the validated startup projection
  // BEFORE the ready slot publishes (T20G-R2); this content-side load is a
  // display refresh, and a recovery baseline only when no projection was
  // provided (see MEMO.md).
  useEffect(() => {
    let mounted = true;
    const store = createGameSaveStore({
      schema: mossyCavern2ProfileSchema,
      adapter: createGameStorageAdapter(),
      namespace: 'playground',
    });
    saveStoreRef.current = store;
    void store.load('profile').then(
      ({ data }) => {
        if (!mounted) return;
        if (startupProfile !== null) {
          // T20G-R2: the hydrated projection owns the durable baseline; the
          // loaded record is the same persisted source the shell already
          // applied and must never regress an early gameplay save.
          setSaveState('Journal restored');
          return;
        }
        // Recovery path (no startup projection): the player can collect a
        // relic before the asynchronous journal read finishes. The store
        // queue already preserves its later save; keep that newer in-memory
        // projection rather than overwriting it with the older loaded value.
        if (profileChangedBeforeLoadRef.current) {
          setSaveState('Journal saving current expedition');
          return;
        }
        profileRef.current = data;
        setProfile(data);
        audioRef.current?.setMuted(data.muted);
        hapticsRef.current?.setMuted(data.hapticsMuted);
        setSaveState('Journal restored');
      },
      () => {
        if (mounted) setSaveState('Journal unavailable on this build');
      },
    );
    return () => {
      mounted = false;
      if (saveStoreRef.current === store) saveStoreRef.current = null;
      void store.flush().catch(() => {});
      store.dispose();
    };
  }, [startupProfile]);

  // Audio/haptics are optional native peers. The game remains fully playable
  // when a development build does not contain either capability.
  useEffect(() => {
    let mounted = true;
    try {
      const haptics = createGameHaptics({ muted: profileRef.current.hapticsMuted });
      hapticsRef.current = haptics;
    } catch {}
    void createGameAudio({ sounds: MOSSY_CAVERN_2_AUDIO_SOURCES }).then(
      async (audio) => {
        if (!mounted) {
          audio.dispose();
          return;
        }
        audioRef.current = audio;
        audio.setMuted(profileRef.current.muted);
        if (session.status === 'paused') audio.pause();
        try {
          await audio.playMusic('music');
        } catch {
          // A decoded SFX system is still useful even if the music request is
          // refused by a platform audio policy.
        }
      },
      () => {
        if (mounted) setNotice('Sound is unavailable on this build; the expedition still plays normally.');
      },
    );
    return () => {
      mounted = false;
      audioRef.current?.dispose();
      audioRef.current = null;
      hapticsRef.current?.dispose();
      hapticsRef.current = null;
    };
  }, [session]);

  // Commit-time event bridge: deterministic gameplay emits become native
  // audio/haptics after state has committed, never during update. Particle
  // emissions ride the shell's presentation binding (T20.3) on the same
  // committed events — both bridges are presentation-only, so ordering
  // between them is irrelevant.
  useEffect(() => {
    const subscriptions = [
      session.addGameEventListener('jump', () => {
        audioRef.current?.play('jump', { category: 'sfx', volume: 0.56 });
        hapticsRef.current?.play('light');
      }),
      session.addGameEventListener('dash', () => {
        audioRef.current?.play('dash', {
          category: 'sfx',
          volume: 0.7,
          concurrency: { key: 'dash', limit: 2, overflow: 'stop-oldest' },
        });
        hapticsRef.current?.play('medium');
      }),
      session.addGameEventListener('slime-cleared', () => {
        audioRef.current?.play('slime', { category: 'sfx', volume: 0.72 });
        hapticsRef.current?.play('impact');
        setNotice('The roots recoil — keep the dash moving.');
      }),
      session.addGameEventListener('relic-collected', (event) => {
        audioRef.current?.play('relic', { category: 'sfx', volume: 0.76 });
        hapticsRef.current?.play('success');
        persistProfile({
          ...profileRef.current,
          relicsRecovered: profileRef.current.relicsRecovered + 1,
        });
        setNotice(`${event.payload.collected}/3 dew relics are glowing in the shrine.`);
      }),
      session.addGameEventListener('checkpoint', (event) => {
        audioRef.current?.play('checkpoint', { category: 'sfx', volume: 0.68 });
        hapticsRef.current?.play('selection');
        persistProfile({
          ...profileRef.current,
          checkpointsReached: Math.max(profileRef.current.checkpointsReached, event.payload.index),
        });
        setNotice('Moss remembers this path. Your journal has been marked.');
      }),
      session.addGameEventListener('damage', (event) => {
        audioRef.current?.play('damage', { category: 'sfx', volume: 0.7 });
        hapticsRef.current?.play('warning');
        setNotice(event.payload.cause === 'poison' ? 'Poison spores return you to the last moss mark.' : 'A slime knocked you back to the last moss mark.');
      }),
      session.addGameEventListener('complete', (event) => {
        audioRef.current?.play('complete', { category: 'sfx', volume: 0.85 });
        audioRef.current?.play('fanfare', { category: 'music', volume: 0.8 });
        hapticsRef.current?.play('success');
        const timeMs = Math.round(event.payload.elapsedSeconds * 1_000);
        const oldBest = profileRef.current.bestTimeMs;
        persistProfile({
          ...profileRef.current,
          completedRuns: profileRef.current.completedRuns + 1,
          bestTimeMs: oldBest === null ? timeMs : Math.min(oldBest, timeMs),
        });
        setNotice('The Root Shrine wakes. Mossy Cavern 2 is complete.');
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [persistProfile, session]);

  const togglePause = useCallback(() => {
    if (session.status === 'running') session.pause();
    else if (session.status !== 'disposed') session.start();
  }, [session]);

  const toggleMuted = useCallback(() => {
    const next = { ...profileRef.current, muted: !profileRef.current.muted };
    audioRef.current?.setMuted(next.muted);
    persistProfile(next);
  }, [persistProfile]);

  const toggleHaptics = useCallback(() => {
    const next = { ...profileRef.current, hapticsMuted: !profileRef.current.hapticsMuted };
    hapticsRef.current?.setMuted(next.hapticsMuted);
    persistProfile(next);
  }, [persistProfile]);

  const restart = useCallback(() => {
    session.restartScene();
    setNotice('The cavern exhales. A new expedition begins.');
  }, [session]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="auto" style={[styles.hud, { top: insets.top + 12 }]}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>MOSSY CAVERN 2</Text>
          <Text style={styles.subtitle}>ROOTWAKE EXPEDITION</Text>
        </View>
        <View style={styles.hudRight}>
          <Text style={styles.relics}>✦ {hud.relicCount}/3</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Resume expedition' : 'Pause expedition'}
            onPress={togglePause}
            style={styles.hudButton}
            testID="mossy-cavern-2-pause"
          >
            <Text style={styles.hudButtonText}>{paused ? '▶' : 'Ⅱ'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave Mossy Cavern 2"
            onPress={onExit}
            style={styles.hudButton}
            testID="mossy-cavern-2-back"
          >
            <Text style={styles.hudButtonText}>×</Text>
          </Pressable>
        </View>
      </View>

      <View pointerEvents="none" style={[styles.notice, { top: insets.top + 76 }]}>
        <Text numberOfLines={2} style={styles.noticeText}>{notice}</Text>
        <Text style={styles.saveText}>
          {saveState} · checkpoint {hud.checkpointIndex} · best {formatTime(profile.bestTimeMs)}
        </Text>
      </View>

      <View pointerEvents="auto" style={[styles.settings, { top: insets.top + 142 }]}>
        <Pressable accessibilityRole="button" onPress={toggleMuted} style={styles.settingButton}>
          <Text style={styles.settingText}>{profile.muted ? 'sound off' : 'sound on'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={toggleHaptics} style={styles.settingButton}>
          <Text style={styles.settingText}>{profile.hapticsMuted ? 'haptics off' : 'haptics on'}</Text>
        </Pressable>
      </View>

      <View pointerEvents="none" style={styles.promptHint}>
        <View style={styles.promptImages}>
          <Image source={MOSSY_CAVERN_2_PROMPTS.keyboard} style={styles.promptImage} />
          <Image source={MOSSY_CAVERN_2_PROMPTS.xbox} style={styles.promptImage} />
          <Image source={MOSSY_CAVERN_2_PROMPTS.playstation} style={styles.promptImage} />
          <Image source={MOSSY_CAVERN_2_PROMPTS.switch} style={styles.promptImage} />
        </View>
        <Text style={styles.promptText}>layout references · touch pad is active</Text>
      </View>

      <GameButtonPad
        game={session}
        hitSlop={12}
        style={[styles.controls, { bottom: Math.max(insets.bottom, 14) + 16 }]}
        testID="mossy-cavern-2-controls"
      >
        <View style={styles.moveCluster}>
          <GameButton action="left" accessibilityRole="button" style={styles.controlButton} testID="mossy-cavern-2-left">
            <Text style={styles.controlLabel}>◀</Text>
          </GameButton>
          <GameButton action="right" accessibilityRole="button" style={styles.controlButton} testID="mossy-cavern-2-right">
            <Text style={styles.controlLabel}>▶</Text>
          </GameButton>
        </View>
        <View style={styles.actionCluster}>
          <GameButton action="jump" accessibilityRole="button" style={[styles.controlButton, styles.jumpButton]} testID="mossy-cavern-2-jump">
            <Text style={styles.actionLabel}>JUMP</Text>
          </GameButton>
          <GameButton action="dash" accessibilityRole="button" style={[styles.controlButton, styles.dashButton]} testID="mossy-cavern-2-dash">
            <Text style={styles.actionLabel}>DASH</Text>
          </GameButton>
        </View>
      </GameButtonPad>

      {hud.status === 'complete' ? (
        <View pointerEvents="auto" style={styles.completionCard}>
          <Text style={styles.completeEyebrow}>ROOT SHRINE AWAKENED</Text>
          <Text style={styles.completeTitle}>Cavern restored</Text>
          <Text style={styles.completeCopy}>
            Your relics and best time are safely recorded in the moss journal.
          </Text>
          <Pressable accessibilityRole="button" onPress={restart} style={styles.restartButton}>
            <Text style={styles.restartText}>EXPLORE AGAIN</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hud: {
    alignItems: 'center',
    backgroundColor: 'rgba(5, 20, 13, 0.82)',
    borderColor: 'rgba(167, 235, 105, 0.32)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 14,
    paddingHorizontal: 13,
    paddingVertical: 9,
    position: 'absolute',
    right: 14,
  },
  title: { color: '#e9ffd2', fontSize: 14, fontWeight: '900', letterSpacing: 1.1 },
  subtitle: { color: '#9fd987', fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 2 },
  hudRight: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  relics: { color: '#fff3a5', fontSize: 15, fontVariant: ['tabular-nums'], fontWeight: '800', marginRight: 2 },
  hudButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(163, 229, 116, 0.16)',
    borderColor: 'rgba(211, 255, 167, 0.35)',
    borderRadius: 18,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  hudButtonText: { color: '#efffd8', fontSize: 19, fontWeight: '800', lineHeight: 22 },
  notice: { alignItems: 'center', left: 30, position: 'absolute', right: 30 },
  noticeText: { color: '#dcf8c5', fontSize: 12, fontWeight: '600', textAlign: 'center', textShadowColor: '#071510', textShadowRadius: 4 },
  saveText: { color: '#91c783', fontSize: 10, marginTop: 4, textAlign: 'center' },
  settings: { flexDirection: 'row', gap: 7, left: 16, position: 'absolute' },
  settingButton: { backgroundColor: 'rgba(5, 20, 13, 0.66)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  settingText: { color: '#c9f2a5', fontSize: 10, fontWeight: '700' },
  promptHint: { alignItems: 'center', bottom: 178, left: 0, opacity: 0.7, position: 'absolute', right: 0 },
  promptImages: { alignItems: 'center', flexDirection: 'row', gap: 3, height: 28 },
  promptImage: { height: 28, resizeMode: 'contain', width: 31 },
  promptText: { color: '#b8e8a0', fontSize: 9, fontWeight: '700', marginTop: 1 },
  controls: { flexDirection: 'row', height: 72, justifyContent: 'space-between', left: 18, position: 'absolute', right: 18 },
  moveCluster: { flexDirection: 'row', gap: 11 },
  actionCluster: { flexDirection: 'row', gap: 11 },
  controlButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 47, 28, 0.9)',
    borderColor: 'rgba(203, 255, 148, 0.58)',
    borderRadius: 36,
    borderWidth: 2,
    height: 64,
    justifyContent: 'center',
    shadowColor: '#8df55d',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    width: 64,
  },
  controlLabel: { color: '#efffd8', fontSize: 22, fontWeight: '900' },
  jumpButton: { backgroundColor: 'rgba(62, 100, 36, 0.94)', width: 70 },
  dashButton: { backgroundColor: 'rgba(79, 70, 31, 0.94)', width: 70 },
  actionLabel: { color: '#fbffd5', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  completionCard: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(8, 39, 22, 0.96)',
    borderColor: '#d9ff9f',
    borderRadius: 24,
    borderWidth: 2,
    bottom: 196,
    left: 24,
    padding: 22,
    position: 'absolute',
    right: 24,
  },
  completeEyebrow: { color: '#b5ef7e', fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  completeTitle: { color: '#f4ffdf', fontSize: 25, fontWeight: '900', marginTop: 6 },
  completeCopy: { color: '#c9e9b3', fontSize: 12, lineHeight: 18, marginTop: 8, textAlign: 'center' },
  restartButton: { backgroundColor: '#c7f47d', borderRadius: 12, marginTop: 16, paddingHorizontal: 18, paddingVertical: 11 },
  restartText: { color: '#16351c', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
});
