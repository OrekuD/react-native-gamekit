import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GameButton, GameButtonPad } from 'rn-gamekit/react';
import { createGameAudio, type GameAudio } from 'rn-gamekit/audio';
import { createGameHaptics, type GameHaptics } from 'rn-gamekit/haptics';
import {
  createGameSaveStore,
  createGameStorageAdapter,
  type GameSaveStore,
} from 'rn-gamekit/storage';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import {
  feedbackForMossyCavern3Event,
  type MossyCavern3EventName,
  type MossyCavern3Sound,
} from './mossyCavern3Feedback.ts';
import type {
  MossyCavern3Session,
  MossyCavern3Snapshot,
} from './mossyCavern3Game.ts';
import {
  createDefaultMossyCavern3Save,
  mossyCavern3SaveSchema,
  readStartupMossyCavern3Save,
  type MossyCavern3SaveData,
} from './mossyCavern3Save.ts';

const MUSIC = require('../../../assets/mossy-cavern-3/audio/music.wav') as number;
const CRYSTAL = require('../../../assets/mossy-cavern-3/audio/crystal.wav') as number;
const DASH = require('../../../assets/mossy-cavern-3/audio/dash.wav') as number;
const CHECKPOINT = require('../../../assets/mossy-cavern-3/audio/checkpoint.wav') as number;
const HURT = require('../../../assets/mossy-cavern-3/audio/hurt.wav') as number;
const COMPLETE = require('../../../assets/mossy-cavern-3/audio/complete.wav') as number;
const UI = require('../../../assets/mossy-cavern-3/audio/ui.wav') as number;

type MossyAudio = GameAudio<
  Record<MossyCavern3Sound | 'music', number>
>;

interface HudState {
  readonly crystals: number;
  readonly deaths: number;
  readonly message: string;
  readonly bestTicks: number | null;
  readonly audioReady: boolean;
}

function playSnapshot(session: MossyCavern3Session): MossyCavern3Snapshot | undefined {
  const frame = session.getRenderFrame();
  return frame.scene === 'play' ? frame.current : undefined;
}

function saveFromSnapshot(
  snapshot: MossyCavern3Snapshot,
  previous: MossyCavern3SaveData,
): MossyCavern3SaveData {
  const completedTicks = snapshot.phase === 'won' ? snapshot.elapsedTicks : null;
  const bestCompletionTicks =
    completedTicks === null
      ? previous.bestCompletionTicks
      : previous.bestCompletionTicks === null
        ? completedTicks
        : Math.min(previous.bestCompletionTicks, completedTicks);
  return {
    activeCheckpointId: snapshot.activeCheckpointId,
    bestCompletionTicks,
    collectedCrystalIds: snapshot.collectedCrystalIds,
    deaths: snapshot.deaths,
    musicEnabled: previous.musicEnabled,
  };
}

function useMossyCavern3Feedback(session: MossyCavern3Session, startupSave?: unknown) {
  const audioRef = useRef<MossyAudio | null>(null);
  const hapticsRef = useRef<GameHaptics | null>(null);
  const saveRef = useRef<GameSaveStore<MossyCavern3SaveData> | null>(null);
  // T20G-R2: the hydrated projection is the durable baseline. The value is
  // computed once (no ref reads during render) and seeds the durable ref
  // before any listener can persist, so an early save-worthy event derives
  // from the hydrated record and never clobbers stored deaths, best ticks,
  // collected ids, or the music preference.
  const [initialDurable] = useState<MossyCavern3SaveData>(() =>
    readStartupMossyCavern3Save(startupSave) ?? createDefaultMossyCavern3Save(),
  );
  const durableRef = useRef<MossyCavern3SaveData>(initialDurable);
  const [hud, setHud] = useState<HudState>({
    audioReady: false,
    bestTicks: initialDurable.bestCompletionTicks,
    crystals: 0,
    deaths: 0,
    message: 'Find all five mooncaps and reach the Moon Gate',
  });

  useEffect(() => {
    let cancelled = false;
    let localAudio: MossyAudio | null = null;
    let localHaptics: GameHaptics | null = null;
    const subscriptions: { remove(): void }[] = [];
    const store = createGameSaveStore({
      adapter: createGameStorageAdapter(),
      namespace: 'mossy-cavern-3',
      schema: mossyCavern3SaveSchema,
    });
    saveRef.current = store;
    // T20G-R2: any save-worthy event before the load resolves pins the
    // durable baseline; the loaded record must never regress it.
    let persistedBeforeLoad = false;

    const publishSnapshot = (message: string): MossyCavern3Snapshot | undefined => {
      const snapshot = playSnapshot(session);
      if (snapshot !== undefined) {
        setHud((previous) => ({
          ...previous,
          crystals: snapshot.crystalCount,
          deaths: snapshot.deaths,
          message,
        }));
      }
      return snapshot;
    };
    const persist = (snapshot: MossyCavern3Snapshot): void => {
      persistedBeforeLoad = true;
      const next = saveFromSnapshot(snapshot, durableRef.current);
      durableRef.current = next;
      void store.save('progress', next).catch((error: unknown) => {
        if (!cancelled) {
          setHud((previous) => ({ ...previous, message: 'Progress could not be saved' }));
        }
        console.warn('[MossyCavern3] save failed', error);
      });
    };
    const feedback = (name: MossyCavern3EventName, message: string): void => {
      const cue = feedbackForMossyCavern3Event(name);
      if (cue.sound !== null) {
        audioRef.current?.play(cue.sound, {
          category: cue.sound === 'ui' ? 'ui' : 'sfx',
          concurrency: { key: cue.sound, limit: cue.sound === 'ui' ? 2 : 4, overflow: 'stop-oldest' },
        });
      }
      if (cue.haptic !== undefined) hapticsRef.current?.play(cue.haptic);
      const snapshot = publishSnapshot(message);
      if (cue.save && snapshot !== undefined) persist(snapshot);
    };

    subscriptions.push(
      session.addGameEventListener('jumped', () => feedback('jumped', 'The cavern wind carries you')),
      session.addGameEventListener('dashed', () => feedback('dashed', 'Moonstep ready after a short breath')),
      session.addGameEventListener('crystal-collected', (event) =>
        feedback('crystal-collected', `Mooncap ${event.payload.id.slice(-1)} gathered`),
      ),
      session.addGameEventListener('checkpoint-activated', () =>
        feedback('checkpoint-activated', 'Lantern awakened — progress saved'),
      ),
      session.addGameEventListener('player-hurt', () =>
        feedback('player-hurt', 'The cavern returns you to your last lantern'),
      ),
      session.addGameEventListener('level-completed', (event) =>
        feedback('level-completed', `Moon Gate opened in ${(event.payload.ticks / 60).toFixed(1)}s`),
      ),
    );
    subscriptions.push(
      session.addStatusListener((status) => {
        if (status === 'paused') {
          audioRef.current?.pause();
          hapticsRef.current?.setPaused(true);
        } else if (status === 'running') {
          audioRef.current?.resume();
          hapticsRef.current?.setPaused(false);
        }
      }),
    );

    const loadProgress = store.load('progress');
    void loadProgress
      .then((result) => {
        if (cancelled) return;
        // T20G-R2: with a hydrated startup projection the loaded record is
        // the same persisted source the shell already applied — never let it
        // regress an early gameplay save. The recovery path (no projection)
        // adopts the loaded record only when nothing persisted yet.
        if (startupSave === undefined && !persistedBeforeLoad) {
          durableRef.current = result.data;
        }
        setHud((previous) => ({
          ...previous,
          bestTicks: durableRef.current.bestCompletionTicks,
          message:
            result.status === 'default'
              ? previous.message
              : 'Chronicle loaded; checkpoints apply to future saved runs',
        }));
      })
      .catch((error: unknown) => {
        console.warn('[MossyCavern3] load failed', error);
      });

    void (async () => {
      try {
        await loadProgress.catch(() => undefined);
        const audio = (await createGameAudio({
          sounds: {
            checkpoint: CHECKPOINT,
            complete: COMPLETE,
            crystal: CRYSTAL,
            dash: DASH,
            hurt: HURT,
            music: MUSIC,
            ui: UI,
          },
        })) as MossyAudio;
        if (cancelled || (session.status as string) === 'disposed') {
          audio.dispose();
          return;
        }
        localAudio = audio;
        audio.setVolume('music', 0.42);
        audio.setVolume('sfx', 0.78);
        audio.setVolume('ui', 0.48);
        const haptics = createGameHaptics();
        if (cancelled || session.status === 'disposed') {
          audio.dispose();
          haptics.dispose();
          return;
        }
        localHaptics = haptics;
        audioRef.current = audio;
        hapticsRef.current = haptics;
        if (session.status === 'paused') {
          audio.pause();
          haptics.setPaused(true);
        } else if (durableRef.current.musicEnabled) {
          await audio.playMusic('music');
        }
        if (!cancelled) setHud((previous) => ({ ...previous, audioReady: true }));
      } catch (error) {
        localAudio?.dispose();
        localHaptics?.dispose();
        console.warn('[MossyCavern3] device feedback unavailable', error);
        if (!cancelled) {
          setHud((previous) => ({ ...previous, message: 'Playing silently — device feedback unavailable' }));
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const subscription of subscriptions) subscription.remove();
      audioRef.current?.dispose();
      hapticsRef.current?.dispose();
      if (localAudio !== audioRef.current) localAudio?.dispose();
      if (localHaptics !== hapticsRef.current) localHaptics?.dispose();
      audioRef.current = null;
      hapticsRef.current = null;
      saveRef.current = null;
      void store.flush().finally(() => store.dispose());
    };
  }, [session, startupSave]);

  return hud;
}

function ControlButton({
  action,
  label,
  style,
  testID,
}: {
  readonly action: string;
  readonly label: string;
  readonly style: object;
  readonly testID: string;
}) {
  return (
    <GameButton
      accessibilityRole="button"
      action={action}
      style={[styles.controlButton, style]}
      testID={testID}
    >
      <Text style={styles.controlLabel}>{label}</Text>
    </GameButton>
  );
}

export default function MossyCavern3Content({
  game,
  onExit,
  startupSave,
}: PlaygroundGameContentProps) {
  const session = game as MossyCavern3Session;
  const insets = useSafeAreaInsets();
  // T20G-R2: the hydrated projection flows into the feedback hook, which
  // owns the durable baseline for saves.
  const hud = useMossyCavern3Feedback(session, startupSave);
  const exit = useCallback(() => onExit(), [onExit]);
  // T20.4 smoke flow: every reference game exposes a pause/resume tap.
  const [paused, setPaused] = useState(session.status === 'paused');
  const togglePause = useCallback(() => {
    if (session.status === 'running') session.pause();
    else if (session.status !== 'disposed') session.start();
  }, [session]);
  // Keep the pause affordance truthful across every pause source (manual tap
  // and app lifecycle backgrounding) for the T20.4 smoke flow.
  useEffect(() => {
    const subscription = session.addStatusListener((status) => {
      setPaused(status === 'paused');
    });
    return () => subscription.remove();
  }, [session]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="box-none"
        style={[styles.topBar, { paddingTop: Math.max(12, insets.top) }]}
      >
        <Pressable
          accessibilityLabel="Back to playground"
          accessibilityRole="button"
          onPress={exit}
          style={styles.backButton}
          testID="mossy-cavern-3-back"
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View pointerEvents="none" style={styles.titleBlock}>
          <Text style={styles.eyebrow}>RN-GAMEKIT EXPEDITION</Text>
          <Text style={styles.title}>Mossy Cavern 3</Text>
        </View>
        <View pointerEvents="none" style={styles.counterPill}>
          <Text style={styles.counter}>◈ {hud.crystals}/5</Text>
          <Text style={styles.deaths}>falls {hud.deaths}</Text>
        </View>
        <Pressable
          accessibilityLabel={paused ? 'Resume the expedition' : 'Pause the expedition'}
          accessibilityRole="button"
          onPress={togglePause}
          style={styles.pauseButton}
          testID="mossy-cavern-3-pause"
        >
          <Text style={styles.pauseText}>{paused ? '▶' : 'Ⅱ'}</Text>
        </Pressable>
      </View>

      <View pointerEvents="none" style={[styles.messageCard, { top: Math.max(86, insets.top + 76) }]}>
        <Text numberOfLines={2} style={styles.message}>{hud.message}</Text>
        <Text style={styles.systemLine}>
          {hud.audioReady ? 'audio + haptics online' : 'awakening device effects'}
          {hud.bestTicks === null ? '' : `  ·  best ${(hud.bestTicks / 60).toFixed(1)}s`}
        </Text>
      </View>

      <View pointerEvents="none" style={styles.promptNote}>
        <Text style={styles.promptText}>TOUCH CONTROLS · keyboard/controller art is prompt-only</Text>
      </View>

      <GameButtonPad
        game={session}
        hitSlop={8}
        style={StyleSheet.absoluteFill}
        testID="mossy-cavern-3-controls"
      >
        <ControlButton action="left" label="←" style={[styles.leftButton, { bottom: insets.bottom + 28 }]} testID="mossy-cavern-3-left" />
        <ControlButton action="right" label="→" style={[styles.rightButton, { bottom: insets.bottom + 28 }]} testID="mossy-cavern-3-right" />
        <ControlButton action="down" label="↓" style={[styles.downButton, { bottom: insets.bottom + 116 }]} testID="mossy-cavern-3-down" />
        <ControlButton action="jump" label="JUMP" style={[styles.jumpButton, { bottom: insets.bottom + 30 }]} testID="mossy-cavern-3-jump" />
        <ControlButton action="dash" label="DASH" style={[styles.dashButton, { bottom: insets.bottom + 126 }]} testID="mossy-cavern-3-dash" />
        <ControlButton action="restart" label="↻" style={[styles.restartButton, { top: insets.top + 92 }]} testID="mossy-cavern-3-restart" />
      </GameButtonPad>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 24, 24, 0.76)',
    borderColor: 'rgba(148, 240, 199, 0.35)',
    borderRadius: 18,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  backText: { color: '#d9fff0', fontSize: 34, fontWeight: '300', lineHeight: 38 },
  pauseButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 24, 24, 0.76)',
    borderColor: 'rgba(148, 240, 199, 0.35)',
    borderRadius: 18,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    marginLeft: 10,
    width: 44,
  },
  pauseText: { color: '#d9fff0', fontSize: 20, fontWeight: '600' },
  controlButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 36, 34, 0.78)',
    borderColor: 'rgba(160, 238, 189, 0.45)',
    borderRadius: 36,
    borderWidth: 1,
    height: 72,
    justifyContent: 'center',
    position: 'absolute',
    width: 72,
  },
  controlLabel: { color: '#e6fff5', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  counter: { color: '#bdffe7', fontSize: 16, fontWeight: '800' },
  counterPill: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(7, 24, 24, 0.72)',
    borderColor: 'rgba(148, 240, 199, 0.24)',
    borderRadius: 14,
    borderWidth: 1,
    marginLeft: 'auto',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dashButton: { backgroundColor: 'rgba(47, 78, 120, 0.82)', right: 40 },
  deaths: { color: '#8fb7a5', fontSize: 10, fontWeight: '600', marginTop: 2 },
  downButton: { left: 84 },
  eyebrow: { color: '#76b9a0', fontSize: 8, fontWeight: '800', letterSpacing: 1.8 },
  jumpButton: {
    backgroundColor: 'rgba(35, 105, 83, 0.84)',
    borderRadius: 45,
    height: 90,
    right: 118,
    width: 90,
  },
  leftButton: { left: 28 },
  message: { color: '#dbf9ed', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  messageCard: {
    alignSelf: 'center',
    backgroundColor: 'rgba(6, 22, 23, 0.7)',
    borderColor: 'rgba(123, 215, 178, 0.2)',
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 390,
    paddingHorizontal: 18,
    paddingVertical: 9,
    position: 'absolute',
  },
  promptNote: { position: 'absolute', right: 30, top: 74 },
  promptText: { color: 'rgba(185, 227, 209, 0.45)', fontSize: 7, fontWeight: '700', letterSpacing: 0.7 },
  restartButton: { height: 44, right: 24, width: 44 },
  rightButton: { left: 142 },
  systemLine: { color: '#719c8a', fontSize: 8, marginTop: 3, textAlign: 'center' },
  title: { color: '#ecfff8', fontSize: 21, fontWeight: '800', letterSpacing: -0.5 },
  titleBlock: { marginLeft: 12 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    left: 18,
    position: 'absolute',
    right: 18,
    top: 0,
  },
});
