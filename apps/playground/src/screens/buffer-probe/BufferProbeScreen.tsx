/**
 * GS-REACT-03: manual native redraw probe, not an animation/FPS benchmark.
 * Each renderer owns a separate Canvas with no animated transform or sibling.
 * Phase buttons change shared inputs without rerendering React. The final
 * picture must remain unchanged until another phase is requested.
 *
 * Expected coordinates are local to each 320x128 panel:
 * Initial: 3 ground sprites at x=32/96/160,y=64; 4 ground tiles at
 * x=0/32,y=64/96; one particle centered at (64,64), alpha=1.
 * Move: sprite x=128/192/256; tile x=128/160; particle x=104,alpha=.75.
 * Hide: all three panels empty.
 * Reappear: initial sprite positions with brick frames; brick tiles at
 * x=64/96; particle x=64,alpha=1.
 * Fade: sprites/tiles unchanged; particle x=184,alpha=.25.
 * Rerender and Remount must preserve the current phase. Exit/reopen resets it.
 * Native results remain pending until these pixels are observed on device.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, type SkImage } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';
import { createParticleSystem } from 'rn-gamekit/particles';
import { ParticleView, SpriteBatch, TileMapLayer2D, useGameAssets } from 'rn-gamekit/react';
import type { ResolvedViewport2D } from 'rn-gamekit';

// Deliberately internal to this development harness: GameWorld2D adds a
// changing transform, which would mask a missing tile-buffer notification.
import { GameWorldContext } from '../../../../../packages/gamekit/src/react/sprites/GameWorld2D';
import { LabHeader } from '../../components/LabHeader';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import {
  BUFFER_PROBE_CONFIG, BUFFER_PROBE_PHASES, BUFFER_PROBE_FRAMES,
  bufferProbeAssets, bufferProbeLevel, makeProbeCommit, probePuff, probeSprites,
  probeViewport, type BufferProbePhase, type BufferProbeScenes, type ProbeSprite,
} from './bufferProbeGame';

export default function BufferProbeScreen({ onExit }: PlaygroundGameContentProps) {
  const [system] = useState(() => {
    const created = createParticleSystem({ effects: { puff: probePuff } });
    created.emit('puff', { position: { x: 64, y: 64 }, seed: 1 });
    return created;
  });
  const binding = useMemo(() => system.bindPresentation(), [system]);
  useEffect(() => () => system.dispose(), [system]);
  const clock = useSharedValue(binding.activeClock);
  const registry = useSharedValue(binding.buildUiRegistry());
  const presentation = useMemo(() => ({ clock, registry }), [clock, registry]);
  const commit = useSharedValue(makeProbeCommit('initial', 0));
  const alpha = useSharedValue(0);
  const viewport = useSharedValue<ResolvedViewport2D | undefined>(probeViewport('initial'));
  const world = useMemo(() => ({ viewport, camera: undefined }), [viewport]);
  const revision = useRef(0);
  const [, rerender] = useState(0);
  const [generation, remount] = useState(0);
  const assets = useGameAssets(bufferProbeAssets, { groups: ['tiles'] });
  const sheet = assets.status === 'ready' ? assets.assets.get(bufferProbeAssets.tiles.sheet) : undefined;
  const tileSource = useMemo(() => sheet === undefined ? undefined : {
    image: sheet.image as SkImage, frames: sheet.frames,
  }, [sheet]);
  const spriteSource = useMemo(() => sheet === undefined ? undefined : {
    image: sheet.image as SkImage, frame: BUFFER_PROBE_FRAMES.ground,
  }, [sheet]);

  const applyPhase = (phase: BufferProbePhase) => {
    revision.current += 1;
    // Recycle the single slot, so every button works independently and can
    // be repeated. Manual binding ticks are the only particle clock owner.
    system.emit('puff', { position: { x: 64, y: 64 }, seed: 1 });
    binding.tick(phase === 'hide' ? 4 : phase === 'fade' ? 3 : phase === 'move' ? 1 : 0);
    registry.set(binding.buildUiRegistry());
    clock.set(binding.activeClock);
    commit.set(makeProbeCommit(phase, revision.current));
    viewport.set(probeViewport(phase));
  };
  const { width, height, capacity } = BUFFER_PROBE_CONFIG;

  return (
    <View style={styles.screen}>
      <LabHeader title="Buffer Probe" onExit={onExit} testID="buffer-probe-back" />
      <Text style={styles.hint}>Tap phases in order. Each panel redraws independently.</Text>
      <View style={styles.controls}>
        {BUFFER_PROBE_PHASES.map((phase) => (
          <Pressable key={phase} testID={`buffer-probe-${phase}`} accessibilityRole="button"
            onPress={() => applyPhase(phase)} style={styles.button}>
            <Text style={styles.buttonText}>{phase}</Text>
          </Pressable>
        ))}
        <Pressable testID="buffer-probe-rerender" accessibilityRole="button"
          onPress={() => rerender((value) => value + 1)} style={styles.button}>
          <Text style={styles.buttonText}>Rerender</Text>
        </Pressable>
        <Pressable testID="buffer-probe-remount" accessibilityRole="button"
          onPress={() => remount((value) => value + 1)} style={styles.button}>
          <Text style={styles.buttonText}>Remount</Text>
        </Pressable>
      </View>
      <Text style={styles.label}>Sprites: move, hide, return as brick</Text>
      <Canvas style={styles.canvas}>
        {sheet === undefined ? null : (
          <SpriteBatch<BufferProbeScenes, 'probe', ProbeSprite> key={generation}
            scene="probe" commit={commit} alpha={alpha} source={sheet}
            capacity={capacity} select={probeSprites}
            write={(writer, item, index) => {
              'worklet';
              writer.set(index, item.frame, item.x, item.y, 0, 1);
            }} />
        )}
      </Canvas>
      <Text style={styles.label}>Tiles: move visible columns, hide, return as brick</Text>
      <Canvas style={styles.canvas}>
        <GameWorldContext.Provider value={world}>
          {tileSource === undefined ? null : (
            <TileMapLayer2D key={generation} map={bufferProbeLevel} layer="terrain"
              source={tileSource} width={width} height={height} overscan={0} />
          )}
        </GameWorldContext.Provider>
      </Canvas>
      <Text style={styles.label}>Particle: move, hide, return, fade to 25%</Text>
      <Canvas style={styles.canvas}>
        {spriteSource === undefined ? null : (
          <ParticleView key={generation} system={system} effect="puff"
            width={width} height={height} presentation={presentation} spriteSource={spriteSource} />
        )}
      </Canvas>
      <Text style={styles.hint}>Rerender / Remount must keep the current picture.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12' },
  canvas: { width: BUFFER_PROBE_CONFIG.width, height: BUFFER_PROBE_CONFIG.height,
    alignSelf: 'center', backgroundColor: '#172033' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, padding: 10 },
  button: { paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#32435d', borderRadius: 6 },
  buttonText: { color: '#fff', fontSize: 12 },
  label: { color: '#c7efe4', fontSize: 12, marginTop: 10, marginBottom: 4, textAlign: 'center' },
  hint: { color: '#c7efe4', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
