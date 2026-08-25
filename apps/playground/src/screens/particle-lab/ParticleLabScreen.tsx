import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';

import { defineParticleEffect, createParticleSystem } from 'rn-gamekit/particles';
import { ParticleView, useParticlePresentation , GameWorld2D , useGameAssets } from 'rn-gamekit/react';
import type { ResolvedViewport2D , createGameSession } from 'rn-gamekit';
import type { CameraCut2D } from 'rn-gamekit/camera2d';
import { defineAssets, spriteSheet } from 'rn-gamekit/assets';

import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';

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

// T15-RF4: a real bundled sheet drives the Atlas sprite path.
const particleAssets = defineAssets({
  effects: {
    spark: spriteSheet(require('../../../assets/kenney/tiny-farm.png'), {
      frames: {
        spark: { x: 0, y: 0, width: 32, height: 32 },
      },
      animations: {
        idle: { frames: ['spark'], frameDurationMs: 100, mode: 'once' },
      },
    }),
  },
});

const worldBurst = defineParticleEffect({
  capacity: 48,
  space: 'world',
  overflow: 'recycle-oldest',
  particle: { kind: 'shape', shape: 'rectangle', width: 6, height: 6, color: '#f472b6' },
  burst: { count: 12 },
  lifetimeSeconds: { min: 0.5, max: 1.0 },
  speed: { min: 60, max: 160 },
  gravity: { x: 0, y: 80 },
  fadeOut: true,
});

const sparks = defineParticleEffect({
  capacity: 64,
  space: 'screen',
  overflow: 'recycle-oldest',
  particle: {
    kind: 'sprite',
    sheet: 'effects',
    frame: 'spark',
    size: { width: 24, height: 24 },
  },
  burst: { count: 10 },
  lifetimeSeconds: { min: 0.35, max: 0.8 },
  speed: { min: 80, max: 180 },
  gravity: { x: 0, y: 140 },
  fadeOut: true,
});

export default function ParticleLabScreen({ game }: PlaygroundGameContentProps) {
  const session = game as ReturnType<typeof createGameSession>;
  const [status, setStatus] = useState('tap to burst');
  const [paused, setPaused] = useState(false);
  // Created once per mount; disposed exactly once on unmount.
  const [system] = useState<ReturnType<typeof createParticleSystem>>(() =>
    createParticleSystem({ effects: { burst, drops, sparks, worldBurst } }),
  );
  const assetsState = useGameAssets(particleAssets, { groups: ['effects'] });
  useEffect(() => () => system.dispose(), [system]);
  // Diagnostics HUD sampled at ~8Hz — control frequency only.
  const [diagTick, setDiagTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDiagTick((n) => n + 1), 125);
    return () => clearInterval(id);
  }, []);
  void diagTick;

  // THE single presentation clock (T15-F1): views never advance the system.
  // T15-SF3: the imperative setManualPaused control applies reactively — a
  // running session can never cancel it.
  const statusReader = useMemo(() => ({ sessionStatus: () => 'running' as const }), []);
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

  const emitSparks = (): void => {
    if (system.status !== 'running') return;
    system.emit('sparks', {
      position: { x: 50 + Math.random() * 220, y: 100 + Math.random() * 240 },
      seed: Math.floor(Date.now() * 7) >>> 0,
    });
    setStatus(`sparks — active ${system.getDiagnostics('sparks').active}`);
  };

  const togglePause = (): void => {
    if (!paused) {
      presentation.setManualPaused(true);
      setPaused(true);
      setStatus('paused — frozen across frames (independent of session)');
    } else {
      presentation.setManualPaused(false);
      setPaused(false);
      setStatus('resumed');
    }
  };

  // T15-SF4: world-space row — presented camera the lab can move/zoom/rotate.
  const cameraSV = useSharedValue<CameraCut2D | undefined>({
    camera: { center: { x: 160, y: 240 }, zoom: 1, rotationRadians: 0 },
    cutId: 1,
  });
  const viewportSV = useSharedValue<ResolvedViewport2D | undefined>({
    surfaceSize: { width: 320, height: 480 },
    logicalBounds: { x: 0, y: 0, width: 320, height: 480 },
    visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 },
    contentBounds: { x: 0, y: 0, width: 320, height: 480 },
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  const moveCamera = (dx: number, dy: number): void => {
    const current = cameraSV.value;
    if (current === undefined) return;
    const c = current.camera.center;
    cameraSV.value = {
      camera: { center: { x: c.x + dx, y: c.y + dy }, zoom: current.camera.zoom, rotationRadians: current.camera.rotationRadians },
      cutId: current.cutId + 1,
    };
    setStatus(`camera (${Math.round(c.x + dx)},${Math.round(c.y + dy)})`);
  };
  const zoomCamera = (factor: number): void => {
    const current = cameraSV.value;
    if (current === undefined) return;
    const z = Math.max(0.25, Math.min(4, current.camera.zoom * factor));
    cameraSV.value = { camera: { ...current.camera, zoom: z }, cutId: current.cutId + 1 };
    setStatus(`zoom ${z.toFixed(2)}x`);
  };
  const rotateCamera = (deltaRad: number): void => {
    const current = cameraSV.value;
    if (current === undefined) return;
    const r = current.camera.rotationRadians + deltaRad;
    cameraSV.value = { camera: { ...current.camera, rotationRadians: r }, cutId: current.cutId + 1 };
    setStatus(`rotate ${Math.round((r * 180) / Math.PI)}deg`);
  };

  const emitWorldBurst = (): void => {
    if (system.status !== 'running') return;
    system.emit('worldBurst', {
      position: { x: 100 + Math.random() * 120, y: 180 + Math.random() * 120 },
      seed: Math.floor(Date.now() * 13) >>> 0,
    });
    setStatus(`world burst — active ${system.getDiagnostics('worldBurst').active}`);
  };

  // Diagnostics sampled during render are fine here because forceTick runs at ~8Hz.
  const d1 = system.getDiagnostics('burst');
  const d2 = system.getDiagnostics('drops');

  return (
    <View style={styles.screen}>
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <ParticleView system={system} effect="burst" width={320} height={480} presentation={presentation} />
        <ParticleView system={system} effect="drops" width={320} height={480} presentation={presentation} />
        {assetsState.status === 'ready' ? (
          <ParticleView
            system={system}
            effect="sparks"
            width={320}
            height={480}
            presentation={presentation}
            spriteSource={{
              image: assetsState.assets.get(particleAssets.effects.spark).image as never,
              frame: { x: 0, y: 0, width: 32, height: 32 },
            }}
          />
        ) : null}
        {/* T15-SF4: world-space row inside GameWorld2D — camera transform and
            culling apply here; the screen effects above stay fixed. */}
        <GameWorld2D viewport={viewportSV} camera={cameraSV}>
          <ParticleView system={system} effect="worldBurst" width={320} height={480} presentation={presentation} />
        </GameWorld2D>
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

      <View pointerEvents="box-none" style={[styles.controls, styles.cameraControls]}>
        <Pressable onPress={() => moveCamera(-40, 0)} style={styles.miniCam}>
          <Text style={styles.camText}>{'\u2190'}</Text>
        </Pressable>
        <Pressable onPress={() => moveCamera(40, 0)} style={styles.miniCam}>
          <Text style={styles.camText}>{'\u2192'}</Text>
        </Pressable>
        <Pressable onPress={() => moveCamera(0, -40)} style={styles.miniCam}>
          <Text style={styles.camText}>{'\u2191'}</Text>
        </Pressable>
        <Pressable onPress={() => moveCamera(0, 40)} style={styles.miniCam}>
          <Text style={styles.camText}>{'\u2193'}</Text>
        </Pressable>
        <Pressable onPress={() => zoomCamera(1.25)} style={styles.miniCam}>
          <Text style={styles.camText}>+</Text>
        </Pressable>
        <Pressable onPress={() => zoomCamera(0.8)} style={styles.miniCam}>
          <Text style={styles.camText}>{'\u2212'}</Text>
        </Pressable>
        <Pressable onPress={() => rotateCamera(Math.PI / 12)} style={styles.miniCam}>
          <Text style={styles.camText}>{'\u21BB'}</Text>
        </Pressable>
      </View>

      <View pointerEvents="box-none" style={styles.controls}>
        <Pressable onPress={emitBurst} style={styles.button}>
          <Text style={styles.buttonText}>Burst (recycle-oldest)</Text>
        </Pressable>
        <Pressable onPress={emitDrops} style={styles.button}>
          <Text style={styles.buttonText}>Drops (drop-new)</Text>
        </Pressable>
        <Pressable onPress={emitSparks} style={styles.button}>
          <Text style={styles.buttonText}>Sparks (Atlas)</Text>
        </Pressable>
        <Pressable onPress={emitWorldBurst} style={styles.button}>
          <Text style={styles.buttonText}>World</Text>
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
  cameraControls: { bottom: 76 },
  miniCam: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  camText: { color: '#e2e8f0', textAlign: 'center', fontSize: 13 },
  buttonText: { color: 'white', textAlign: 'center', fontSize: 11, fontWeight: '600' },
});
