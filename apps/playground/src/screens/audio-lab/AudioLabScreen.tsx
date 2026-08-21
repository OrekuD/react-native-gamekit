import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { createGameAudio } from 'rn-gamekit/audio';
import { createGameHaptics } from 'rn-gamekit/haptics';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';

// Bundled small assets — real decode path via expo-asset → AudioContext.decodeAudioData
// These are tiny silent wavs (sfx 120ms, music 800ms) so the bundle stays small but the
// native decode / AudioBufferSourceNode / suspend/resume / interruption code paths are real.
const SFX = require('../../../assets/audio/sfx.wav') as number;
const MUSIC = require('../../../assets/audio/music.wav') as number;

/**
 * T14.0 spike screen — real playground/dev-client path for audio/haptics.
 *
 * Exercises the pinned native APIs directly:
 * - decode (via createGameAudio download + decode)
 * - SFX (audio.play)
 * - music replacement (playMusic twice)
 * - suspend/resume (pause/resume → AudioContext.suspend/resume)
 * - interruption subscription/removal (AudioManager.addSystemEventListener inside GameAudio, cleaned on dispose)
 * - one Presets.System.* call (haptics.play → Presets.System.impactMedium)
 *
 * Hardware output remains device-gated, but every code path is real and runnable.
 */
export default function AudioLabScreen(_props: PlaygroundGameContentProps) {
  const [status, setStatus] = useState<string>('idle');
  const [audioStatus, setAudioStatus] = useState<string>('not created');
  const [hapticsStatus, setHapticsStatus] = useState<string>('not created');
  const audioRef = useRef<Awaited<ReturnType<typeof createGameAudio>> | null>(null);
  const hapticsRef = useRef<ReturnType<typeof createGameHaptics> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const audio = await createGameAudio({
          sounds: {
            sfx: SFX,
            music: MUSIC,
          },
        });
        if (cancelled) {
          audio.dispose();
          return;
        }
        audioRef.current = audio;
        setAudioStatus('created — decoded sfx+music, AudioContext running');
        audio.setVolume('sfx', 0.8);
        audio.setVolume('music', 0.7);
        audio.setMuted(false);

        const haptics = createGameHaptics();
        if (cancelled) {
          haptics.dispose();
          return;
        }
        hapticsRef.current = haptics;
        setHapticsStatus(`created — supported: ${String(haptics.isSupported('impact'))}`);
        setStatus('ready — tap buttons (hardware output device-gated, code paths real)');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`error: ${msg}`);
        setAudioStatus(msg);
        setHapticsStatus(msg);
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

  const handleSfx = (): void => {
    const audio = audioRef.current;
    const haptics = hapticsRef.current;
    if (!audio || !haptics) {
      setStatus('not ready');
      return;
    }
    // SFX: fire-and-forget, fresh AudioBufferSourceNode per call
    audio.play('sfx');
    // Haptics: one Presets.System.* call (impactMedium)
    const result = haptics.play('impact');
    setStatus(`sfx played — haptics ${result.played ? 'played' : `not played (${result.reason})`}`);
  };

  const handleMusic = async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) return;
    // Music replacement: first play, then replace with same track
    await audio.playMusic('music');
    setStatus('music playing — will replace in 300ms');
    setTimeout(async () => {
      if (!audioRef.current) return;
      await audioRef.current.playMusic('sfx');
      setStatus('music replaced with sfx (one channel, replacement)');
    }, 300);
  };

  const handlePause = (): void => {
    audioRef.current?.pause();
    setStatus('paused — AudioContext.suspend() called');
  };

  const handleResume = (): void => {
    audioRef.current?.resume();
    setStatus('resumed — AudioContext.resume() called (if not muted/disposed)');
  };

  const handleStopMusic = (): void => {
    audioRef.current?.stopMusic();
    setStatus('music stopped');
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#080b12', padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>Audio Lab (T14.0 spike)</Text>
      <Text style={{ color: '#9aa4b2', fontSize: 13 }}>Status: {status}</Text>
      <Text style={{ color: '#9aa4b2', fontSize: 13 }}>Audio: {audioStatus}</Text>
      <Text style={{ color: '#9aa4b2', fontSize: 13 }}>Haptics: {hapticsStatus}</Text>
      <Text style={{ color: '#6b7280', fontSize: 12 }}>
        Hardware output (SFX, music, interruption, haptics) is device-gated — simulators cannot prove
        routes/actuator. Every button below exercises a real native code path (decode, createBufferSource,
        suspend/resume, AudioManager interruption, Presets.System.impactMedium) and is runnable in dev-client.
      </Text>
      <Pressable onPress={handleSfx} style={{ backgroundColor: '#1f2937', padding: 12, borderRadius: 8 }}>
        <Text style={{ color: 'white', textAlign: 'center' }}>Trigger SFX + Haptics</Text>
      </Pressable>
      <Pressable onPress={handleMusic} style={{ backgroundColor: '#1f2937', padding: 12, borderRadius: 8 }}>
        <Text style={{ color: 'white', textAlign: 'center' }}>Play Music (replace)</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable onPress={handlePause} style={{ flex: 1, backgroundColor: '#1f2937', padding: 12, borderRadius: 8 }}>
          <Text style={{ color: 'white', textAlign: 'center' }}>Pause (suspend)</Text>
        </Pressable>
        <Pressable onPress={handleResume} style={{ flex: 1, backgroundColor: '#1f2937', padding: 12, borderRadius: 8 }}>
          <Text style={{ color: 'white', textAlign: 'center' }}>Resume</Text>
        </Pressable>
      </View>
      <Pressable onPress={handleStopMusic} style={{ backgroundColor: '#1f2937', padding: 12, borderRadius: 8 }}>
        <Text style={{ color: 'white', textAlign: 'center' }}>Stop Music</Text>
      </Pressable>
    </View>
  );
}
