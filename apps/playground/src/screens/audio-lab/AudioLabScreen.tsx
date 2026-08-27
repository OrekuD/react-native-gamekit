import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LabHeader } from '../../components/LabHeader';
import { createGameAudio } from 'rn-gamekit/audio';
import { createGameHaptics } from 'rn-gamekit/haptics';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';

const LEVEL_MUSIC = require('../../../assets/audio/mixkit-game-level-music-689.wav') as number;
const BONUS_SFX = require('../../../assets/audio/mixkit-winning-an-extra-bonus-2060.wav') as number;

export default function AudioLabScreen({ onExit }: PlaygroundGameContentProps) {
  const [status, setStatus] = useState('loading…');
  const [ready, setReady] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [bonusPlaying, setBonusPlaying] = useState(false);
  const audioRef = useRef<Awaited<ReturnType<typeof createGameAudio>> | null>(null);
  const hapticsRef = useRef<ReturnType<typeof createGameHaptics> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const audio = await createGameAudio({
          sounds: {
            levelMusic: LEVEL_MUSIC,
            bonus: BONUS_SFX,
          },
        });
        if (cancelled) { audio.dispose(); return; }
        audioRef.current = audio;
        audio.setVolume('music', 0.7);
        audio.setVolume('sfx', 0.85);
        audio.setMuted(false);
        const haptics = createGameHaptics();
        hapticsRef.current = haptics;
        if (cancelled) { haptics.dispose(); return; }
        setReady(true);
        setStatus('ready');
      } catch (e) {
        setStatus(`error: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      audioRef.current?.dispose();
      hapticsRef.current?.dispose();
      audioRef.current = null;
      hapticsRef.current = null;
    };
  }, []);

  const toggleMusic = async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (musicPlaying) {
        audio.pause();
        setMusicPlaying(false);
        setStatus('music paused');
      } else {
        audio.resume();
        await audio.playMusic('levelMusic');
        setMusicPlaying(true);
        setStatus('music playing');
      }
    } catch (e) { setStatus(`music error: ${(e as Error).message}`); }
  };

  const restartMusic = async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.resume();
      audio.stopMusic();
      await audio.playMusic('levelMusic');
      setMusicPlaying(true);
      setStatus('music restarted');
    } catch (e) { setStatus(`restart error: ${(e as Error).message}`); }
  };

  const toggleBonus = async (): Promise<void> => {
    const audio = audioRef.current;
    const haptics = hapticsRef.current;
    if (!audio) return;
    try {
      if (bonusPlaying) {
        // SFX are fire-and-forget; pause suspends the shared AudioContext
        audio.pause();
        setBonusPlaying(false);
        setStatus('bonus paused');
      } else {
        audio.resume();
        audio.play('bonus');
        haptics?.play('impact');
        setBonusPlaying(true);
        setStatus('bonus played');
        // bonus is ~1s, auto-reset toggle after
        setTimeout(() => setBonusPlaying(false), 1200);
      }
    } catch (e) { setStatus(`bonus error: ${(e as Error).message}`); }
  };

  const restartBonus = async (): Promise<void> => {
    const audio = audioRef.current;
    const haptics = hapticsRef.current;
    if (!audio) return;
    try {
      audio.resume();
      audio.play('bonus');
      haptics?.play('impact');
      setBonusPlaying(true);
      setStatus('bonus restarted');
      setTimeout(() => setBonusPlaying(false), 1200);
    } catch (e) { setStatus(`bonus error: ${(e as Error).message}`); }
  };

  return (
    <View style={styles.screen}>
      <LabHeader title="Audio Lab" onExit={onExit} testID="audio-back" />

      <View style={styles.body}>
        <Text style={styles.status}>{status}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Level Music</Text>
          <Text style={styles.cardSub}>mixkit-game-level-music-689 • longer • music channel</Text>
          <View style={styles.row}>
            <Pressable onPress={toggleMusic} disabled={!ready} style={[styles.primary, !ready && styles.disabled]}>
              <Text style={styles.primaryText}>{musicPlaying ? 'Pause' : 'Play'}</Text>
            </Pressable>
            <Pressable onPress={restartMusic} disabled={!ready} style={[styles.secondary, !ready && styles.disabled]}>
              <Text style={styles.secondaryText}>Restart</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bonus SFX</Text>
          <Text style={styles.cardSub}>mixkit-winning-an-extra-bonus-2060 • sfx channel</Text>
          <View style={styles.row}>
            <Pressable onPress={toggleBonus} disabled={!ready} style={[styles.primary, !ready && styles.disabled]}>
              <Text style={styles.primaryText}>{bonusPlaying ? 'Pause' : 'Play'}</Text>
            </Pressable>
            <Pressable onPress={restartBonus} disabled={!ready} style={[styles.secondary, !ready && styles.disabled]}>
              <Text style={styles.secondaryText}>Restart</Text>
            </Pressable>
          </View>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  backButton: { backgroundColor: 'rgba(255,255,255,0.14)', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, minWidth: 36, alignItems: 'center' },
  backText: { color: 'white', fontSize: 14, fontWeight: '700' },
  title: { color: 'white', fontSize: 18, fontWeight: '700' },
  headerSpacer: { flex: 1 },
  body: { flex: 1, padding: 16, gap: 16, justifyContent: 'center' },
  status: { color: '#9aa4b2', fontSize: 13, textAlign: 'center' },
  card: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 16, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cardTitle: { color: 'white', fontSize: 15, fontWeight: '700' },
  cardSub: { color: '#64748b', fontSize: 11 },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  primary: { flex: 1, backgroundColor: '#22c55e', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  secondary: { flex: 1, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  primaryText: { color: 'white', fontWeight: '700', fontSize: 13 },
  secondaryText: { color: 'white', fontWeight: '600', fontSize: 13 },
  hint: { color: '#475569', fontSize: 10, textAlign: 'center', lineHeight: 14 },
});
