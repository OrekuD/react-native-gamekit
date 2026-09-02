/**
 * Mossy Cavern's React-owned shell content.
 *
 * This component deliberately observes commits at a low HUD cadence. Audio,
 * haptics, storage, and pause/restart are lifecycle/event effects; none of
 * them become a per-frame React store.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GameSession } from 'rn-gamekit';
import { createGameAudio } from 'rn-gamekit/audio';
import { createGameHaptics } from 'rn-gamekit/haptics';
import { GameButton, GameButtonPad, useGameLifecycleSource } from 'rn-gamekit/react';
import {
  createGameSaveStore,
  createGameStorageAdapter,
  type GameSaveStore,
} from 'rn-gamekit/storage';

import { LabHeader } from '../../components/LabHeader';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import {
  mossyCavernSaveSchema,
  readStartupMossyCavernSave,
  projectMossyCavernSave,
  type MossyCavernSession,
  type MossyCavernSnapshot,
  type MossyCavernSave,
} from './mossyCavernGame';

const AUDIO_SOUNDS = {
  levelMusic: require('../../../assets/mossy-cavern/audio/mixkit-game-level-music-689.wav') as number,
  levelComplete: require('../../../assets/mossy-cavern/audio/mixkit-game-level-completed-2059.wav') as number,
  fanfare: require('../../../assets/mossy-cavern/audio/mixkit-medieval-show-fanfare-announcement-226.wav') as number,
  losing: require('../../../assets/mossy-cavern/audio/mixkit-player-losing-or-failing-2042.wav') as number,
  notification: require('../../../assets/mossy-cavern/audio/mixkit-retro-arcade-casino-notification-211.wav') as number,
  unlock: require('../../../assets/mossy-cavern/audio/mixkit-unlock-game-notification-253.wav') as number,
  treasure: require('../../../assets/mossy-cavern/audio/mixkit-video-game-treasure-2066.wav') as number,
  coin: require('../../../assets/mossy-cavern/audio/mixkit-winning-a-coin-video-game-2069.wav') as number,
  bonus: require('../../../assets/mossy-cavern/audio/mixkit-winning-an-extra-bonus-2060.wav') as number,
} as const;

/** Haptics follow the session lifecycle through the public binder (T20.7). */
type HapticsHandle = ReturnType<typeof createGameHaptics>;

interface MossyHudRecord {
  readonly health: number;
  readonly crystals: number;
  readonly score: number;
  readonly checkpointIndex: number;
  readonly checkpointTotal: number;
  readonly falls: number;
  readonly elapsed: number;
  readonly bestTimeSeconds: number;
}

function hudRecord(snapshot: MossyCavernSnapshot): MossyHudRecord {
  return {
    health: snapshot.health,
    crystals: snapshot.crystals,
    score: snapshot.score,
    checkpointIndex: snapshot.checkpointIndex + 1,
    checkpointTotal: snapshot.checkpoints.length,
    falls: snapshot.falls,
    elapsed: snapshot.elapsed,
    bestTimeSeconds: snapshot.bestTimeSeconds,
  };
}

function sameHud(first: MossyHudRecord, second: MossyHudRecord): boolean {
  return (
    first.health === second.health &&
    first.crystals === second.crystals &&
    first.score === second.score &&
    first.checkpointIndex === second.checkpointIndex &&
    first.falls === second.falls &&
    Math.floor(first.elapsed * 10) === Math.floor(second.elapsed * 10) &&
    first.bestTimeSeconds === second.bestTimeSeconds
  );
}

const DIAGNOSTIC_INTERVAL_SECONDS = 0.125;

export interface MossyCavernContentProps extends PlaygroundGameContentProps {
  /** Test seam for the low-frequency HUD observer. */
  readonly onHudPublish?: () => void;
}

export default function MossyCavernContent(props: MossyCavernContentProps) {
  const { game, onExit, onHudPublish } = props;
  const insets = useSafeAreaInsets();
  const session = game as MossyCavernSession;
  const [hud, setHud] = useState<MossyHudRecord | null>(null);
  const [sessionStatus, setSessionStatus] = useState<GameSession['status']>(session.status);
  const [endgame, setEndgame] = useState<{
    readonly kind: 'clear' | 'game-over';
    readonly seconds: number;
    readonly falls: number;
    readonly score: number;
    readonly crystals: number;
  } | null>(null);
  const [audioStatus, setAudioStatus] = useState('audio warming up');
  const [muted, setMuted] = useState(false);
  // T20G-R2: the hydrated projection seeds the journal display synchronously;
  // the content-side load below is a display refresh only.
  const startupSave = readStartupMossyCavernSave(props.startupSave);
  const [saveStatus, setSaveStatus] = useState(
    startupSave === null ? 'save pending' : 'save profile loaded',
  );
  const [storedSave, setStoredSave] = useState<MossyCavernSave | null>(startupSave);
  const audioRef = useRef<Awaited<ReturnType<typeof createGameAudio>> | null>(null);
  const hapticsRef = useRef<HapticsHandle | null>(null);
  const saveStoreRef = useRef<GameSaveStore<MossyCavernSave> | null>(null);
  const mutedRef = useRef(muted);
  // T20.3/T20.7: haptics follow the session lifecycle via the public binder;
  // GameView supplies the source (the content mounts as a GameView child).
  // The returned detach is retained and invoked on cleanup (T20L-R3).
  const lifecycle = useGameLifecycleSource();
  const hapticsLifecycleDetachRef = useRef<(() => void) | null>(null);

  // Low-frequency observer: commit notifications are simulation cadence, but
  // React only publishes a quantized HUD record every 125 ms when it changes.
  useEffect(() => {
    const last = { at: -Infinity, record: null as MossyHudRecord | null };
    const publish = (): void => {
      const snapshot = session.getRenderFrame().current as unknown as MossyCavernSnapshot;
      const next = hudRecord(snapshot);
      if (last.record === null) {
        last.at = snapshot.elapsed;
        last.record = next;
        setHud(next);
        onHudPublish?.();
        return;
      }
      if (snapshot.elapsed - last.at < DIAGNOSTIC_INTERVAL_SECONDS || sameHud(last.record, next)) return;
      last.at = snapshot.elapsed;
      last.record = next;
      setHud(next);
      onHudPublish?.();
    };
    publish();
    const subscription = session.addCommitListener(publish);
    return () => subscription.remove();
  }, [session, onHudPublish]);

  useEffect(() => {
    const subscription = session.addStatusListener((status) => setSessionStatus(status));
    return () => subscription.remove();
  }, [session]);

  useEffect(() => {
    mutedRef.current = muted;
    audioRef.current?.setMuted(muted);
    hapticsRef.current?.setMuted(muted);
  }, [muted]);

  // Native effect binding: every sound is loaded once by GameKit's shared
  // audio context. Event envelopes carry committed facts, so effect playback
  // never depends on a render frame or wall-clock simulation logic.
  useEffect(() => {
    let cancelled = false;
    const subscriptions = [
      session.addGameEventListener('jump', () => {
        audioRef.current?.play('notification', { category: 'sfx', concurrency: { key: 'jump', limit: 3, overflow: 'drop-new' } });
        hapticsRef.current?.play('light');
      }),
      session.addGameEventListener('dash', () => {
        audioRef.current?.play('treasure', { category: 'sfx', concurrency: { key: 'dash', limit: 2, overflow: 'drop-new' } });
        hapticsRef.current?.play('selection');
      }),
      session.addGameEventListener('crystal', () => {
        audioRef.current?.play('coin', { category: 'sfx', concurrency: { key: 'coin', limit: 4, overflow: 'drop-new' } });
        hapticsRef.current?.play('light');
      }),
      session.addGameEventListener('enemy-defeated', () => {
        audioRef.current?.play('unlock', { category: 'sfx', concurrency: { key: 'enemy', limit: 2, overflow: 'drop-new' } });
        hapticsRef.current?.play('impact');
      }),
      session.addGameEventListener('player-hit', () => {
        audioRef.current?.play('losing', { category: 'sfx', concurrency: { key: 'hit', limit: 2, overflow: 'drop-new' } });
        hapticsRef.current?.play('heavy');
      }),
      session.addGameEventListener('fall', () => {
        audioRef.current?.play('losing', { category: 'sfx', concurrency: { key: 'fall', limit: 1, overflow: 'drop-new' } });
      }),
      session.addGameEventListener('checkpoint', () => {
        audioRef.current?.play('notification', { category: 'ui' });
        hapticsRef.current?.play('success');
      }),
      session.addGameEventListener('finish', (event) => {
        const payload = event.payload;
        setEndgame({
          kind: 'clear',
          seconds: payload.elapsedSeconds,
          falls: payload.falls,
          score: payload.score,
          crystals: payload.crystals,
        });
        audioRef.current?.stopMusic();
        audioRef.current?.play('levelComplete', { category: 'sfx' });
        audioRef.current?.play('fanfare', { category: 'ui' });
        audioRef.current?.play('bonus', { category: 'sfx' });
        hapticsRef.current?.play('success');
      }),
      session.addGameEventListener('game-over', (event) => {
        const payload = event.payload;
        setEndgame({
          kind: 'game-over',
          seconds: payload.elapsedSeconds,
          falls: payload.falls,
          score: payload.score,
          crystals: payload.crystals,
        });
        audioRef.current?.stopMusic();
        audioRef.current?.play('losing', { category: 'sfx' });
        hapticsRef.current?.play('error');
      }),
    ];

    const statusSubscription = session.addStatusListener((status) => {
      const paused = status !== 'running';
      if (paused) audioRef.current?.pause();
      else audioRef.current?.resume();
    });

    const setupAudio = async (): Promise<void> => {
      try {
        const audio = await createGameAudio({ sounds: AUDIO_SOUNDS });
        if (cancelled) {
          audio.dispose();
          return;
        }
        audioRef.current = audio;
        audio.setVolume('music', 0.35);
        audio.setVolume('sfx', 0.82);
        audio.setVolume('ui', 0.75);
        audio.setMuted(mutedRef.current);
        try {
          hapticsRef.current = createGameHaptics();
          hapticsRef.current.setMuted(mutedRef.current);
          hapticsLifecycleDetachRef.current?.();
          hapticsLifecycleDetachRef.current =
            lifecycle !== undefined ? hapticsRef.current.bindLifecycle(lifecycle) : null;
        } catch {
          setAudioStatus('audio ready · haptics unavailable');
        }
        await audio.playMusic('levelMusic');
        if (session.status === 'running') audio.resume();
        else audio.pause();
        if (!cancelled) setAudioStatus('music + event SFX ready');
      } catch {
        if (!cancelled) setAudioStatus('native audio unavailable · game continues');
      }
    };
    void setupAudio();

    return () => {
      cancelled = true;
      statusSubscription.remove();
      for (const subscription of subscriptions) subscription.remove();
      hapticsLifecycleDetachRef.current?.();
      hapticsLifecycleDetachRef.current = null;
      audioRef.current?.dispose();
      hapticsRef.current?.dispose();
      audioRef.current = null;
      hapticsRef.current = null;
    };
  }, [lifecycle, session]);

  // Versioned checkpoint/finish saves. T20G-R2: the shell's async factory
  // seeds the live session from the validated startup projection before the
  // ready slot publishes; this load only refreshes the journal display.
  useEffect(() => {
    let cancelled = false;
    const store = createGameSaveStore({
      schema: mossyCavernSaveSchema,
      adapter: createGameStorageAdapter(),
      namespace: 'mossy-cavern',
    });
    saveStoreRef.current = store;

    const queueSave = (data: MossyCavernSave): void => {
      void store.save('profile', data)
        .then(() => {
          if (!cancelled) setSaveStatus(`checkpoint saved · ${data.score} pts`);
        })
        .catch(() => {
          if (!cancelled) setSaveStatus('save failed · run continues');
        });
    };
    const checkpointSubscription = session.addGameEventListener('checkpoint', (event) => queueSave(event.payload.save));
    const finishSubscription = session.addGameEventListener('finish', (event) => queueSave(event.payload.save));
    void store.load('profile')
      .then((result) => {
        if (cancelled) return;
        // T20G-R2: a hydrated projection owns the durable baseline; only a
        // fresh run (no projection) adopts the loaded record for display.
        if (startupSave === null) setStoredSave(result.data);
        setSaveStatus(result.status === 'default' ? 'new save profile' : 'save profile loaded');
      })
      .catch(() => {
        if (!cancelled) setSaveStatus('storage unavailable · run is local');
      });

    return () => {
      cancelled = true;
      checkpointSubscription.remove();
      finishSubscription.remove();
      store.dispose();
      saveStoreRef.current = null;
    };
  }, [session, startupSave]);

  const togglePause = useCallback((): void => {
    if (session.status === 'running') session.pause();
    else session.start();
  }, [session]);

  const restart = useCallback((): void => {
    session.restartScene();
    setEndgame(null);
  }, [session]);

  const saveNow = useCallback((): void => {
    const store = saveStoreRef.current;
    if (store === null) {
      setSaveStatus('storage unavailable · run is local');
      return;
    }
    const snapshot = session.getRenderFrame().current as unknown as MossyCavernSnapshot;
    const data = projectMossyCavernSave(snapshot);
    void store.save('profile', data)
      .then(() => store.flush())
      .then(() => setSaveStatus(`saved now · ${data.score} pts`))
      .catch(() => setSaveStatus('save failed · run continues'));
  }, [session]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <LabHeader title="Mossy Cavern" onExit={onExit} testID="mossy-cavern-back" />

      <View pointerEvents="auto" style={styles.hud}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>MOSSY CAVERN</Text>
          <Text style={styles.subtitle}>CAVERN RUN</Text>
        </View>
        <View style={styles.hudRight}>
          {hud === null ? null : (
            <Text style={styles.stats}>
              {'♥'.repeat(Math.max(0, hud.health))}
              {'·'} ✦{hud.crystals}  {hud.score} pts  CP {hud.checkpointIndex}/{hud.checkpointTotal}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sessionStatus === 'paused' ? 'Resume cavern run' : 'Pause cavern run'}
            onPress={togglePause}
            style={styles.topButton}
            testID="mossy-cavern-pause"
          >
            <Text style={styles.topButtonText}>{sessionStatus === 'paused' ? '▶' : 'Ⅱ'}</Text>
          </Pressable>
        </View>
      </View>

      {hud === null ? null : (
        <View pointerEvents="none" style={styles.statusColumn}>
          <Text style={styles.effectStatus}>
            {hud.falls} falls · {hud.elapsed.toFixed(1)}s · best {hud.bestTimeSeconds.toFixed(1)}s
          </Text>
        </View>
      )}
      <View pointerEvents="none" style={styles.statusColumn}>
        <Text style={styles.effectStatus}>{audioStatus}</Text>
        <Text style={styles.effectStatus}>{saveStatus}{storedSave === null ? '' : ` · last ${storedSave.crystals} crystals`}</Text>
      </View>

      <View pointerEvents="auto" style={styles.settings}>
        <Pressable accessibilityRole="button" onPress={() => setMuted(!muted)} style={styles.settingButton}>
          <Text style={styles.settingText}>{muted ? 'sound off' : 'sound on'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={saveNow} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>SAVE</Text>
        </Pressable>
      </View>

      {endgame === null ? null : (
        <View pointerEvents="auto" style={styles.completionCard}>
          <Text style={styles.completeEyebrow}>
            {endgame.kind === 'clear' ? 'CAVERN CLEARED' : 'CAUGHT BY THE CAVERN'}
          </Text>
          <Text style={styles.completeTitle}>
            {endgame.seconds.toFixed(1)}s · {endgame.score} pts
          </Text>
          <Text style={styles.completeCopy}>
            ✦ {endgame.crystals} crystals · {endgame.falls} falls
          </Text>
          <Pressable accessibilityRole="button" onPress={restart} style={styles.restartButton}>
            <Text style={styles.restartText}>RUN AGAIN</Text>
          </Pressable>
        </View>
      )}

      <GameButtonPad
        game={session}
        hitSlop={12}
        style={[styles.controls, { bottom: Math.max(insets.bottom, 14) + 16 }]}
        testID="mossy-cavern-controls"
      >
        <View style={styles.moveCluster}>
          <GameButton action="left" accessibilityRole="button" style={styles.controlButton} testID="mossy-cavern-left">
            <Text style={styles.controlLabel}>◀</Text>
          </GameButton>
          <GameButton action="right" accessibilityRole="button" style={styles.controlButton} testID="mossy-cavern-right">
            <Text style={styles.controlLabel}>▶</Text>
          </GameButton>
        </View>
        <View style={styles.actionCluster}>
          <GameButton action="jump" accessibilityRole="button" style={[styles.controlButton, styles.jumpButton]} testID="mossy-cavern-jump">
            <Text style={styles.actionLabel}>JUMP</Text>
          </GameButton>
          <GameButton action="dash" accessibilityRole="button" style={[styles.controlButton, styles.dashButton]} testID="mossy-cavern-dash">
            <Text style={styles.actionLabel}>DASH</Text>
          </GameButton>
          <GameButton action="drop" accessibilityRole="button" style={[styles.controlButton, styles.dropButton]} testID="mossy-cavern-drop">
            <Text style={styles.actionLabel}>DROP</Text>
          </GameButton>
        </View>
      </GameButtonPad>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: {
    alignItems: 'center',
    backgroundColor: 'rgba(5, 20, 13, 0.82)',
    borderColor: 'rgba(105, 214, 194, 0.32)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 14,
    paddingHorizontal: 13,
    paddingVertical: 9,
    position: 'absolute',
    right: 14,
    top: 62,
  },
  title: { color: '#d9fff6', fontSize: 14, fontWeight: '900', letterSpacing: 1.1 },
  subtitle: { color: '#8fd8c8', fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 2 },
  hudRight: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  stats: { color: '#d8fff2', fontSize: 10, fontVariant: ['tabular-nums'], fontWeight: '800', marginRight: 2 },
  topButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(105, 214, 194, 0.16)',
    borderColor: 'rgba(167, 243, 208, 0.35)',
    borderRadius: 18,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  topButtonText: { color: '#eafffa', fontSize: 19, fontWeight: '800', lineHeight: 22 },
  statusColumn: { alignItems: 'center', left: 30, position: 'absolute', right: 30, top: 122 },
  effectStatus: {
    color: '#c7efe4',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
    textShadowColor: '#071510',
    textShadowRadius: 4,
  },
  settings: { flexDirection: 'row', gap: 7, left: 16, position: 'absolute', top: 170 },
  settingButton: { backgroundColor: 'rgba(5, 20, 13, 0.66)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  settingText: { color: '#b9e9dc', fontSize: 10, fontWeight: '700' },
  saveButton: { height: 32, borderRadius: 9, paddingHorizontal: 10, backgroundColor: 'rgba(105, 214, 194, 0.18)', borderWidth: 1, borderColor: 'rgba(105, 214, 194, 0.35)', alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { color: '#a7f3d0', fontSize: 10, fontWeight: '800' },
  completionCard: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(8, 39, 33, 0.96)',
    borderColor: '#a7f3d0',
    borderRadius: 24,
    borderWidth: 2,
    bottom: 196,
    left: 24,
    padding: 22,
    position: 'absolute',
    right: 24,
  },
  completeEyebrow: { color: '#8fe8cf', fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  completeTitle: { color: '#eafff8', fontSize: 25, fontWeight: '900', marginTop: 6 },
  completeCopy: { color: '#c4ece0', fontSize: 12, lineHeight: 18, marginTop: 8, textAlign: 'center' },
  restartButton: { backgroundColor: '#7de8cd', borderRadius: 12, marginTop: 16, paddingHorizontal: 18, paddingVertical: 11 },
  restartText: { color: '#16351c', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  controls: { flexDirection: 'row', height: 72, justifyContent: 'space-between', left: 18, position: 'absolute', right: 18 },
  moveCluster: { flexDirection: 'row', gap: 11 },
  actionCluster: { flexDirection: 'row', gap: 11 },
  controlButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 47, 40, 0.9)',
    borderColor: 'rgba(148, 255, 214, 0.58)',
    borderRadius: 36,
    borderWidth: 2,
    height: 64,
    justifyContent: 'center',
    shadowColor: '#5df5c8',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    width: 64,
  },
  controlLabel: { color: '#eafff8', fontSize: 22, fontWeight: '900' },
  jumpButton: { backgroundColor: 'rgba(36, 100, 86, 0.94)', width: 70 },
  dashButton: { backgroundColor: 'rgba(31, 79, 70, 0.94)', width: 70 },
  dropButton: { backgroundColor: 'rgba(27, 62, 56, 0.94)', width: 70 },
  actionLabel: { color: '#f0fffb', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
});
