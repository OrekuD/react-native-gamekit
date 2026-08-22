import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas } from '@shopify/react-native-skia';

import { defineParticleEffect, createParticleSystem } from 'rn-gamekit/particles';
import { ParticleView, useParticlePresentation } from 'rn-gamekit/react';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import type { createGameSession } from 'rn-gamekit';

/**
 * T15.5 focused particle screen: sprite/shape discriminants are exercised via
 * shape effects here (sprite Atlas path is device-measured in T15.4), world/
 * screen space, capacity bounds, pause, and overflow behavior.
 *
 * All particles are presentation-only: nothing here touches session state.
 */
const burst = defineParticleEffect({
  capacity: 96,
  space: 'screen',
  overflow: 'recycle-oldest',
  particle: { kind: 'shape', shape: 'circle', radius: 4, color: '#60a5fa' },
  burst: { count: 16 },
  lifetimeSeconds: { min: 0.4, max: 0.9 },
  speed: { min: 60, max: 200 },
  gravity: { x: 0, y: 160 },
  fadeOut: true,
});

const drops = defineParticleEffect({
  capacity: 24,
  space: 'screen',
  overflow: 'drop-new',
  particle: { kind: 'shape', shape: 'rectangle', width: 5, height: 9, color: '#34d399' },
  burst: { count: 12 },
  lifetimeSeconds: { min: 0.5, max: 1.1 },
  speed: { min: 40, max: 120 },
  gravity: { x: 0, y: -60 },
  fadeOut: true,
});

export default function ParticleLabScreen({ game }: PlaygroundGameContentProps) {
  const session = game as ReturnType<typeof createGameSession>;
  const [status, setStatus] = useState('tap to burst');
  const [paused, setPaused] = useState(false);
  // Created once per mount; disposed exactly once on unmount.
  const [system] = useState<ReturnType<typeof createParticleSystem>>(() =>
    createParticleSystem({ effects: { burst, drops } }),
  );
  useEffect(() => () => system.dispose(), [system]);
  // Diagnostics HUD sampled at ~8Hz — control frequency only.
  const [diagTick, setDiagTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDiagTick((n) => n + 1), 125);
    return () => clearInterval(id);
  }, []);
  void diagTick;

  // THE single presentation clock (T15-F1): views never advance the system.
  const sessionStatusRef = useRef<'idle' | 'running' | 'paused' | 'disposed'>('running');
  useEffect(() => {
    sessionStatusRef.current = session?.status ?? 'running';
  }, [session]);
  const statusReader = useMemo(() => ({ sessionStatus: () => sessionStatusRef.current }), []);
  const presentation = useParticlePresentation(system, statusReader);

  const emitBurst = (): void => {
    if (system.status !== 'running') return;
    system.emit('burst', {
      position: { x: 60 + Math.random() * 200, y: 120 + Math.random() * 220 },
      seed: Math.floor(Date.now()) >>> 0,
    });
    setStatus(`burst — active ${system.getDiagnostics('burst').active}`);
  };

  const emitDrops = (): void => {
    if (system.status !== 'running') return;
    system.emit('drops', {
      position: { x: 40 + Math.random() * 240, y: 80 + Math.random() * 160 },
      seed: Math.floor(Date.now() * 3) >>> 0,
    });
    setStatus(`drops — dropped ${system.getDiagnostics('drops').dropped}`);
  };

  const togglePause = (): void => {
    if (system.status === 'paused') {
      system.resume();
      setPaused(false);
      setStatus('resumed');
    } else if (system.status === 'running') {
      system.pause();
      setPaused(true);
      setStatus('paused — age frozen');
    }
  };

  // Diagnostics sampled during render are fine here because forceTick runs at ~8Hz.
  const d1 = system.getDiagnostics('burst');
  const d2 = system.getDiagnostics('drops');

  return (
    <View style={styles.screen}>
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <ParticleView system={system} effect="burst" width={320} height={480} snapshot={presentation.snapshot} />
        <ParticleView system={system} effect="drops" width={320} height={480} snapshot={presentation.snapshot} />
      </Canvas>

      <View pointerEvents="box-none" style={styles.hud}>
        <Text style={styles.title}>Particle Lab</Text>
        <Text style={styles.line}>{status}</Text>
        <Text style={styles.diag}>
          burst a:{String(d1?.active ?? 0)} e:{String(d1?.emitted ?? 0)} d:{String(d1?.dropped ?? 0)} r:
          {String(d1?.recycled ?? 0)}
        </Text>
        <Text style={styles.diag}>
          drops a:{String(d2?.active ?? 0)} e:{String(d2?.emitted ?? 0)} d:{String(d2?.dropped ?? 0)}
        </Text>
        <Text style={styles.hint}>
          Session {session.status}; diagnostics sampled at ~8Hz, never per frame.
        </Text>
      </View>

      <View pointerEvents="box-none" style={styles.controls}>
        <Pressable onPress={emitBurst} style={styles.button}>
          <Text style={styles.buttonText}>Burst (recycle-oldest)</Text>
        </Pressable>
        <Pressable onPress={emitDrops} style={styles.button}>
          <Text style={styles.buttonText}>Drops (drop-new)</Text>
        </Pressable>
        <Pressable onPress={togglePause} style={[styles.button, paused && styles.buttonActive]}>
          <Text style={styles.buttonText}>{paused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12' },
  hud: { position: 'absolute', top: 64, left: 16, right: 16, gap: 4 },
  title: { color: 'white', fontSize: 18, fontWeight: '700' },
  line: { color: '#cbd5e1', fontSize: 13 },
  diag: { color: '#64748b', fontSize: 11, fontVariant: ['tabular-nums'] },
  hint: { color: '#475569', fontSize: 10 },
  controls: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    padding: 10,
    borderRadius: 8,
  },
  buttonActive: { backgroundColor: 'rgba(96,165,250,0.35)' },
  buttonText: { color: 'white', textAlign: 'center', fontSize: 11, fontWeight: '600' },
});
