import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, Rect } from '@shopify/react-native-skia';
import { LabHeader } from '../../components/LabHeader';
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

export default function ParticleLabScreen({ game, onExit }: PlaygroundGameContentProps) {
  const insets = useSafeAreaInsets();
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

  const moveCamera = (dx: number, dy: number): void => { // larger step so movement is visually obvious

    const current = cameraSV.value;
    if (current === undefined) return;
    const c = current.camera.center;
    // Invert so ← moves the pink world left on screen (was inverted)
    cameraSV.value = {
      camera: { center: { x: c.x - dx, y: c.y - dy }, zoom: current.camera.zoom, rotationRadians: current.camera.rotationRadians },
      cutId: current.cutId + 1,
    };
    setStatus(`camera (${Math.round(c.x - dx)},${Math.round(c.y - dy)}) — world moves with arrows`);
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
        {/* Visible world frame so camera moves are obvious even before you emit.
            The faint pink rectangle IS the world — it pans/zooms/rotates with the
            camera above. Screen effects (Burst/Drops/Sparks) stay fixed. */}
        <GameWorld2D viewport={viewportSV} camera={cameraSV}>
          <Rect x={0} y={0} width={320} height={480} color="rgba(244,114,182,0.07)" />
          <Rect x={0} y={0} width={320} height={480} style="stroke" strokeWidth={2} color="rgba(244,114,182,0.40)" />
          {/* center crosshair */}
          <Rect x={156} y={238} width={8} height={2} color="rgba(244,114,182,0.95)" />
          <Rect x={159} y={235} width={2} height={8} color="rgba(244,114,182,0.95)" />
          <Rect x={100} y={140} width={120} height={1} color="rgba(244,114,182,0.18)" />
          <Rect x={100} y={140} width={1} height={120} color="rgba(244,114,182,0.18)" />
          <ParticleView system={system} effect="worldBurst" width={320} height={480} presentation={presentation} />
        </GameWorld2D>
      </Canvas>

      <LabHeader title="Particle Lab" onExit={onExit} testID="particle-back" />
      <View pointerEvents="box-none" style={styles.hud}>
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

      <View pointerEvents="box-none" style={[styles.cameraShelf, { marginBottom: insets.bottom }]}>
        <Text style={styles.shelfLabel}>Camera — World only (pink)</Text>
        <View style={styles.cameraRow}>
          <Pressable
            onPress={() => moveCamera(-40, 0)}
            style={styles.miniCam}
            accessibilityLabel="Move camera left"
          >
            <Text style={styles.camText}>{'\u2190'}</Text>
          </Pressable>
          <Pressable
            onPress={() => moveCamera(40, 0)}
            style={styles.miniCam}
            accessibilityLabel="Move camera right"
          >
            <Text style={styles.camText}>{'\u2192'}</Text>
          </Pressable>
          <Pressable
            onPress={() => moveCamera(0, -40)}
            style={styles.miniCam}
            accessibilityLabel="Move camera up"
          >
            <Text style={styles.camText}>{'\u2191'}</Text>
          </Pressable>
          <Pressable
            onPress={() => moveCamera(0, 40)}
            style={styles.miniCam}
            accessibilityLabel="Move camera down"
          >
            <Text style={styles.camText}>{'\u2193'}</Text>
          </Pressable>
          <View style={styles.camDivider} />
          <Pressable
            onPress={() => zoomCamera(1.25)}
            style={styles.miniCam}
            accessibilityLabel="Zoom in"
          >
            <Text style={styles.camText}>+</Text>
          </Pressable>
          <Pressable
            onPress={() => zoomCamera(0.8)}
            style={styles.miniCam}
            accessibilityLabel="Zoom out"
          >
            <Text style={styles.camText}>{'\u2212'}</Text>
          </Pressable>
          <Pressable
            onPress={() => rotateCamera(Math.PI / 12)}
            style={styles.miniCam}
            accessibilityLabel="Rotate camera"
          >
            <Text style={styles.camText}>{'\u21BB'}</Text>
          </Pressable>
        </View>
        <Text style={styles.shelfHint}>Arrows pan, + − zoom, ↻ rotate. Only World (pink) moves with camera; others are screen-space.</Text>
      </View>

      <View pointerEvents="box-none" style={[styles.controls, { paddingBottom: insets.bottom > 0 ? 4 : 0 }]}>
        <View style={styles.effectsRow}>
          <Pressable onPress={emitBurst} style={styles.button} accessibilityLabel="Emit burst">
            <Text style={styles.buttonText}>Burst</Text>
            <Text style={styles.buttonSub}>recycle</Text>
          </Pressable>
          <Pressable onPress={emitDrops} style={styles.button} accessibilityLabel="Emit drops">
            <Text style={styles.buttonText}>Drops</Text>
            <Text style={styles.buttonSub}>drop-new</Text>
          </Pressable>
          <Pressable onPress={emitSparks} style={styles.button} accessibilityLabel="Emit sparks (Atlas sprite)">
            <Text style={styles.buttonText}>Sparks</Text>
            <Text style={styles.buttonSub}>Atlas</Text>
          </Pressable>
          <Pressable onPress={emitWorldBurst} style={styles.button} accessibilityLabel="Emit world burst">
            <Text style={styles.buttonText}>World</Text>
            <Text style={styles.buttonSub}>world-space</Text>
          </Pressable>
          <Pressable
            onPress={togglePause}
            style={[styles.button, paused && styles.buttonActive]}
            accessibilityLabel={paused ? 'Resume' : 'Pause'}
          >
            <Text style={styles.buttonText}>{paused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
        </View>
        <Text style={styles.controlsHint}>Burst/Drops/Sparks = screen-space (fixed to screen). World = pink rectangles inside GameWorld2D, moves with camera above.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12' },
  hud: { position: 'absolute', top: 12, left: 16, right: 16, gap: 4, zIndex: 10 },
  hudTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    minWidth: 36,
    alignItems: 'center',
  },
  backText: { color: 'white', fontSize: 14, fontWeight: '700' },
  title: { color: 'white', fontSize: 18, fontWeight: '700' },
  line: { color: '#cbd5e1', fontSize: 13 },
  diag: { color: '#64748b', fontSize: 11, fontVariant: ['tabular-nums'] },
  hint: { color: '#475569', fontSize: 10 },
  cameraShelf: {
    position: 'absolute',
    bottom: 88,
    left: 16,
    right: 16,
    gap: 6,
    backgroundColor: 'rgba(15,23,42,0.55)',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  shelfLabel: { color: '#93c5fd', fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  cameraRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  camDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 2 },
  shelfHint: { color: '#64748b', fontSize: 10, lineHeight: 13 },
  controls: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    gap: 6,
  },
  effectsRow: { flexDirection: 'row', gap: 8 },
  controlsHint: { color: '#475569', fontSize: 9, lineHeight: 12, textAlign: 'center' },
  button: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    gap: 2,
  },
  buttonActive: { backgroundColor: 'rgba(96,165,250,0.35)' },
  miniCam: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    minWidth: 32,
    alignItems: 'center',
  },
  camText: { color: '#e2e8f0', textAlign: 'center', fontSize: 14, fontWeight: '600' },
  buttonText: { color: 'white', textAlign: 'center', fontSize: 11, fontWeight: '700' },
  buttonSub: { color: '#94a3b8', textAlign: 'center', fontSize: 8, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
});
