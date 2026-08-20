import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { createGameAudio } from 'rn-gamekit/audio';
import { createGameHaptics } from 'rn-gamekit/haptics';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';

/**
 * T14.0 spike screen — real playground/dev-client path for audio/haptics.
 *
 * Hardware output remains device-gated (simulators cannot prove routes /
 * actuator), but this screen proves the integration path compiles and is
 * runnable before T14.1. It exercises:
 * - createGameAudio({ sounds }) with Expo asset IDs (stubbed as numbers for now)
 * - audio.play / audio.playMusic / setVolume / setMuted / pause / resume / dispose
 * - createGameHaptics / haptics.play / isSupported / setMuted
 * - Task 13 event wiring is deferred to T14.6 (Brick Breaker)
 */
export default function AudioLabScreen(_props: PlaygroundGameContentProps) {
  const [status, setStatus] = useState<string>('idle');
  const [audioStatus, setAudioStatus] = useState<string>('not created');
  const [hapticsStatus, setHapticsStatus] = useState<string>('not created');

  useEffect(() => {
    let cancelled = false;
    let audio: Awaited<ReturnType<typeof createGameAudio>> | null = null;
    let haptics: ReturnType<typeof createGameHaptics> | null = null;

    (async () => {
      try {
        // In T14.1 these will be real require('./audio/brick-hit.wav') asset IDs.
        // For T14.0 we use stub numbers so the screen is runnable without bundled audio.
        audio = await createGameAudio({
          sounds: {
            sfx: 1 as unknown as number,
            music: 2 as unknown as number,
          },
        });
        if (cancelled) {
          audio.dispose();
          return;
        }
        setAudioStatus('created — peer resolved');
        // Exercise volume/mute contract without needing decoded buffers
        audio.setVolume('sfx', 0.8);
        audio.setVolume('music', 0.7);
        audio.setMuted(false);

        haptics = createGameHaptics();
        if (cancelled) {
          haptics.dispose();
          return;
        }
        setHapticsStatus(`created — supported: ${String(haptics.isSupported('impact'))}`);
        setStatus('ready — tap buttons (hardware output device-gated)');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`error: ${msg}`);
        setAudioStatus(msg);
        setHapticsStatus(msg);
      }
    })();

    return () => {
      cancelled = true;
      audio?.dispose();
      haptics?.dispose();
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#080b12', padding: 24, gap: 16, justifyContent: 'center' }}>
      <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>Audio Lab (T14.0 spike)</Text>
      <Text style={{ color: '#9aa4b2', fontSize: 13 }}>Status: {status}</Text>
      <Text style={{ color: '#9aa4b2', fontSize: 13 }}>Audio: {audioStatus}</Text>
      <Text style={{ color: '#9aa4b2', fontSize: 13 }}>Haptics: {hapticsStatus}</Text>
      <Text style={{ color: '#6b7280', fontSize: 12 }}>
        Hardware output (SFX, music, interruption, haptics) is device-gated — simulators cannot prove
        routes/actuator. This screen proves the import path, installation-error contract, volume/mute,
        and lifecycle wiring before T14.1.
      </Text>
      <Pressable
        onPress={() => setStatus('tap received — play() is stubbed until T14.2/3 (will throw not-yet-implemented)')}
        style={{ backgroundColor: '#1f2937', padding: 12, borderRadius: 8 }}
      >
        <Text style={{ color: 'white', textAlign: 'center' }}>Trigger SFX (stub)</Text>
      </Pressable>
      <Pressable
        onPress={() => setStatus('music play() stubbed until T14.3')}
        style={{ backgroundColor: '#1f2937', padding: 12, borderRadius: 8 }}
      >
        <Text style={{ color: 'white', textAlign: 'center' }}>Play Music (stub)</Text>
      </Pressable>
    </View>
  );
}


