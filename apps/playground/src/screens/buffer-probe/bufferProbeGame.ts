/** Deterministic input fixtures for the isolated native buffer probe. */
import { defineAssets, spriteSheet } from 'rn-gamekit/assets';
import { defineParticleEffect } from 'rn-gamekit/particles';
import { defineTileMap2D, defineTileSet2D } from 'rn-gamekit/tilemap';
import type { CommitFrame, ResolvedViewport2D } from 'rn-gamekit';

export const BUFFER_PROBE_CONFIG = { width: 320, height: 128, capacity: 3 } as const;
export const BUFFER_PROBE_PHASES = ['initial', 'move', 'hide', 'reappear', 'fade'] as const;
export type BufferProbePhase = (typeof BUFFER_PROBE_PHASES)[number];

export const BUFFER_PROBE_FRAMES = {
  ground: { x: 0, y: 0, width: 32, height: 32 },
  brick: { x: 32, y: 0, width: 32, height: 32 },
} as const;
export const bufferProbeAssets = defineAssets({
  tiles: {
    sheet: spriteSheet(require('../../../assets/platformer-tiles.png'), {
      frames: BUFFER_PROBE_FRAMES,
      animations: {},
    }),
  },
});

export interface BufferProbeSnapshot { readonly phase: BufferProbePhase }
export type BufferProbeScenes = {
  readonly probe: {
    readonly kind: 'gamekit.scene';
    readonly __snapshotType?: BufferProbeSnapshot;
  };
};
export interface ProbeSprite {
  readonly x: number;
  readonly y: number;
  readonly frame: 'ground' | 'brick';
}

export function makeProbeCommit(phase: BufferProbePhase, revision: number): CommitFrame<BufferProbeScenes> {
  return {
    scene: 'probe', previous: { phase }, current: { phase }, tick: revision,
    revision, elapsedSeconds: revision / 60, hardCut: false, stepMs: 1000 / 60,
  };
}

export function probeSprites({ current }: { readonly current: BufferProbeSnapshot }): readonly ProbeSprite[] {
  'worklet';
  if (current.phase === 'hide') return [];
  const offset = current.phase === 'move' ? 96 : 0;
  const frame = current.phase === 'reappear' || current.phase === 'fade' ? 'brick' : 'ground';
  return [32, 96, 160].map((x) => ({ x: x + offset, y: 64, frame }));
}

/** Only the tile culling window changes. No transform consumes this value. */
export function probeViewport(phase: BufferProbePhase): ResolvedViewport2D {
  const { width, height } = BUFFER_PROBE_CONFIG;
  const x = phase === 'hide' ? 640 : phase === 'move' ? 128 : phase === 'initial' ? 0 : 64;
  return {
    surfaceSize: { width, height },
    logicalBounds: { x: 0, y: 0, width, height },
    visibleLogicalBounds: { x, y: 0, width: 63, height: 127 },
    contentBounds: { x: 0, y: 0, width, height }, scale: 1, offsetX: 0, offsetY: 0,
  };
}

export const bufferProbeLevel = defineTileMap2D({
  cellSize: { width: 32, height: 32 }, origin: { x: 0, y: 0 },
  tileset: defineTileSet2D({
    tiles: { ground: { frame: 'ground' }, brick: { frame: 'brick' } },
  }),
  layers: [{
    id: 'terrain', width: 10, height: 4,
    data: Array.from({ length: 40 }, (_, index) =>
      index < 20 ? 0 : Math.floor((index % 10) / 2) % 2 === 0 ? 1 : 2),
  }],
});

/** One particle: x = 64 + 40 * age; y = 64; opacity = 1 - age / 4. */
export const probePuff = defineParticleEffect({
  capacity: 1, space: 'screen', overflow: 'recycle-oldest',
  particle: { kind: 'sprite', sheet: 'tiles', frame: 'ground', size: { width: 32, height: 32 } },
  burst: { count: 1 }, lifetimeSeconds: { min: 4, max: 4 },
  speed: { min: 40, max: 40 }, direction: { min: 0, max: 0 },
  gravity: { x: 0, y: 0 }, fadeOut: true,
});
