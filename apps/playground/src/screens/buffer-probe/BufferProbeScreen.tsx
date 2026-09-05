/**
 * Buffer Probe screen (GS-REACT-03).
 *
 * A deterministic native-integration reproduction: one lab timer advances a
 * synthetic commit, pans the viewport, and emits particles. Three Atlas
 * systems — a fixed-count orbiting sprite batch, a scrolling tile layer, a
 * looping sprite emitter — change ONLY their buffer slots per frame. No
 * session, no camera, no React state per frame, no alpha-driven visuals.
 *
 * On device: watch for 20 seconds. Orbiters must circle smoothly, tiles
 * must scroll with the pan (teeth every fourth column make motion obvious),
 * and puffs must rise and fade continuously. Frozen slots while commits
 * advance (see the headless commit-revision counter in tests) means buffer
 * writes are not notifying the native renderer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas } from '@shopify/react-native-skia';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { createParticleSystem } from 'rn-gamekit/particles';
import {
  GameWorld2D,
  ParticleView,
  SpriteBatch,
  TileMapLayer2D,
  useGameAssets,
  useParticlePresentation,
} from 'rn-gamekit/react';
import type { CommitFrame, ResolvedViewport2D } from 'rn-gamekit';

import { LabHeader } from '../../components/LabHeader';
import type { PlaygroundGameContentProps } from '../../shell/PlaygroundGameContentProps';
import {
  BUFFER_PROBE_CONFIG,
  BUFFER_PROBE_FRAMES,
  bufferProbeAssets,
  bufferProbeLevel,
  probeOrbitPositions,
  probePuff,
  type BufferProbeScenes,
} from './bufferProbeGame';

/** A full synthetic commit: every field the batch select path may read. */
export function makeProbeCommit(tick: number): CommitFrame<BufferProbeScenes> {
  return {
    scene: 'probe',
    previous: { tick: Math.max(0, tick - 1) },
    current: { tick },
    tick,
    elapsedSeconds: tick / 60,
    revision: tick,
    hardCut: false,
    stepMs: 1000 / 60,
  };
}

function initialViewport(): ResolvedViewport2D {
  const { width, height } = BUFFER_PROBE_CONFIG;
  return {
    surfaceSize: { width, height },
    logicalBounds: { x: 0, y: 0, width, height },
    visibleLogicalBounds: { x: 0, y: 0, width, height },
    contentBounds: { x: 0, y: 0, width, height },
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  } as ResolvedViewport2D;
}

export default function BufferProbeScreen({ onExit }: PlaygroundGameContentProps) {
  const insets = useSafeAreaInsets();
  const [system] = useState(() => createParticleSystem({ effects: { puff: probePuff } }));
  const assetsState = useGameAssets(bufferProbeAssets, { groups: ['sprites', 'tiles'] });
  useEffect(() => () => system.dispose(), [system]);

  // Presentation clock for the particle views; the probe has no session.
  const statusReader = useMemo(() => ({ sessionStatus: () => 'running' as const }), []);
  const presentation = useParticlePresentation(system, statusReader);

  // Synthetic commit: revision + tick advance at display cadence. The batch
  // select reads only `current.tick`, so slot contents — and nothing else —
  // change per frame.
  const commit: SharedValue<CommitFrame<BufferProbeScenes>> = useSharedValue(
    makeProbeCommit(0),
  );
  const alpha = useSharedValue(0);
  // Viewport pan: 1px per frame with wraparound. The tile layer reads only
  // visibleLogicalBounds (no camera exists), so tile slots — and nothing
  // else — change per frame.
  const viewport: SharedValue<ResolvedViewport2D | undefined> = useSharedValue<ResolvedViewport2D | undefined>(initialViewport());
  const tickRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current += 1;
      const tick = tickRef.current;
      commit.value = makeProbeCommit(tick);
      const bounds = viewport.value?.visibleLogicalBounds;
      if (bounds !== undefined) {
        viewport.value = {
          ...(viewport.value as ResolvedViewport2D),
          visibleLogicalBounds: { ...bounds, x: tick % 640 },
        };
      }
      if (tick % BUFFER_PROBE_CONFIG.puffEveryTicks === 0) {
        system.emit('puff', { position: { x: 160, y: 200 }, seed: tick });
      }
    }, 1000 / 60);
    return () => clearInterval(id);
  }, [commit, viewport, system]);

  const spriteSource = (
    assetsState.status === 'ready'
      ? assetsState.assets.get(bufferProbeAssets.sprites.probe)
      : undefined
  );
  const tileImage = (
    assetsState.status === 'ready'
      ? (assetsState.assets.get(bufferProbeAssets.tiles.sheet) as { readonly image: unknown })
          ?.image
      : undefined
  );

  return (
    <View style={styles.screen}>
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        {spriteSource === undefined || tileImage === undefined ? null : (
          <GameWorld2D viewport={viewport}>
            <TileMapLayer2D
              map={bufferProbeLevel}
              layer="terrain"
              source={{ image: tileImage as never, frames: BUFFER_PROBE_FRAMES }}
              width={BUFFER_PROBE_CONFIG.width}
              height={BUFFER_PROBE_CONFIG.height}
              overscan={1}
            />
            <SpriteBatch<BufferProbeScenes, 'probe', { readonly x: number; readonly y: number }>
              scene="probe"
              commit={commit}
              alpha={alpha}
              source={spriteSource as never}
              capacity={BUFFER_PROBE_CONFIG.orbitCount}
              select={({ current }) => {
                'worklet';
                return probeOrbitPositions(current.tick).map((position) => ({ ...position }));
              }}
              write={(write, item, index) => {
                'worklet';
                write.set(index, 'probe', item.x, item.y, 0, 0.5);
              }}
              anchor={{ x: 0.5, y: 0.5 }}
            />
            <ParticleView
              system={system}
              effect="puff"
              width={BUFFER_PROBE_CONFIG.width}
              height={BUFFER_PROBE_CONFIG.height}
              presentation={presentation}
              spriteSource={{
                image: spriteSource as never,
                frame: { x: 0, y: 0, width: 64, height: 64 },
              }}
            />
          </GameWorld2D>
        )}
      </Canvas>

      <LabHeader title="Buffer Probe" onExit={onExit} testID="buffer-probe-back" />
      <View pointerEvents="none" style={[styles.hud, { top: insets.top + 76 }]}>
        <Text style={styles.line}>GS-REACT-03 reproduction: watch 20 seconds.</Text>
        <Text style={styles.line}>Orbiters circle · tiles scroll · puffs rise and fade.</Text>
        <Text style={styles.line}>Frozen slots while commits advance = missing publication.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12' },
  hud: { alignItems: 'center', left: 24, position: 'absolute', right: 24 },
  line: { color: '#c7efe4', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 2 },
});
