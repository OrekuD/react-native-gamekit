/**
 * Buffer Probe data contracts (GS-REACT-03).
 *
 * A deterministic native-integration reproduction for buffer-slot
 * publication: a fixed-count orbiting sprite batch, a panning tile layer,
 * and a looping particle emitter. No session, no React state per frame —
 * the screen drives shared values from one lab timer, so on device the
 * ONLY thing changing per frame is batch-slot contents. If slots visibly
 * move/scroll/fade, buffer writes notify the native renderer; if they sit
 * frozen while commits advance, the publication link is missing.
 */
import { defineAssets, image } from 'rn-gamekit/assets';
import { defineParticleEffect } from 'rn-gamekit/particles';
import { defineTileMap2D, defineTileSet2D } from 'rn-gamekit/tilemap';

export const BUFFER_PROBE_CONFIG = {
  width: 320,
  height: 480,
  orbitCount: 8,
  orbitCenterX: 160,
  orbitCenterY: 240,
  orbitRadius: 90,
  /** Radians advanced per tick: one orbit ≈ 126 ticks. */
  orbitSpeed: 0.05,
  cellSize: 32,
  mapColumns: 40,
  mapRows: 12,
  /** Particle emission cadence in ticks. */
  puffEveryTicks: 30,
} as const;

export const bufferProbeAssets = defineAssets({
  sprites: {
    probe: image(require('../../../assets/player.png')),
  },
  tiles: {
    sheet: image(require('../../../assets/platformer-tiles.png')),
  },
});

export interface BufferProbeSnapshot {
  readonly tick: number;
}

export type BufferProbeScenes = {
  readonly probe: {
    readonly kind: 'gamekit.scene';
    readonly __snapshotType?: BufferProbeSnapshot;
  };
};

/** Deterministic orbit: constant count, positions move every tick. */
export function probeOrbitPositions(tick: number): { readonly x: number; readonly y: number }[] {
  const positions: { x: number; y: number }[] = [];
  for (let index = 0; index < BUFFER_PROBE_CONFIG.orbitCount; index += 1) {
    const angle =
      tick * BUFFER_PROBE_CONFIG.orbitSpeed + (index * Math.PI * 2) / BUFFER_PROBE_CONFIG.orbitCount;
    positions.push({
      x: BUFFER_PROBE_CONFIG.orbitCenterX + BUFFER_PROBE_CONFIG.orbitRadius * Math.cos(angle),
      y: BUFFER_PROBE_CONFIG.orbitCenterY + BUFFER_PROBE_CONFIG.orbitRadius * Math.sin(angle),
    });
  }
  return positions;
}

export const bufferProbeTileset = defineTileSet2D({
  tiles: {
    ground: { frame: 'ground', collision: 'solid' },
    brick: { frame: 'brick', collision: 'solid' },
  },
});

function buildProbeTerrain(): number[] {
  const { mapColumns: width, mapRows: height } = BUFFER_PROBE_CONFIG;
  const data = new Array<number>(width * height).fill(0);
  for (let x = 0; x < width; x += 1) {
    data[(height - 1) * width + x] = 1;
    // Alternating teeth make horizontal scroll unambiguous on device.
    data[(height - 2) * width + x] = x % 4 < 2 ? 2 : 0;
  }
  return data;
}

export const bufferProbeLevel = defineTileMap2D({
  cellSize: { width: BUFFER_PROBE_CONFIG.cellSize, height: BUFFER_PROBE_CONFIG.cellSize },
  origin: { x: 0, y: 0 },
  tileset: bufferProbeTileset,
  layers: [
    {
      id: 'terrain',
      width: BUFFER_PROBE_CONFIG.mapColumns,
      height: BUFFER_PROBE_CONFIG.mapRows,
      data: buildProbeTerrain(),
    },
  ],
});

/** Sheet frames: two 32x32 cells laid out horizontally. */
export const BUFFER_PROBE_FRAMES = {
  ground: { x: 0, y: 0, width: 32, height: 32 },
  brick: { x: 32, y: 0, width: 32, height: 32 },
} as const;

export const probePuff = defineParticleEffect({
  capacity: 32,
  space: 'screen',
  overflow: 'recycle-oldest',
  particle: {
    kind: 'sprite',
    sheet: 'sprites',
    frame: 'probe',
    size: { width: 24, height: 24 },
  },
  burst: { count: 6 },
  lifetimeSeconds: { min: 0.6, max: 1.0 },
  speed: { min: 30, max: 90 },
  direction: { min: -Math.PI, max: 0 },
  gravity: { x: 0, y: 60 },
  fadeOut: true,
});
