/**
 * Compile-time fixture: `SpriteBatch` and the shared-texture Atlas path
 * (Example 4).
 *
 * Type-checked by `pnpm typecheck`. Documents the batched surface:
 *
 * - one decoded image shared by many instances;
 * - `capacity` is fixed for the mounted batch;
 * - `select` maps the committed snapshot to the batch item array;
 * - `write` is a UI-runtime setter that writes transforms in place —
 *   `write.set(index, frame, x, y, rotation, scale)` — no per-frame
 *   allocation and no React per-frame work.
 */
import { GameWorld2D, SpriteBatch } from '../../src/react';
import type { GameRendererProps } from '../../src/react';
import { defineScene } from '../../src/index';

import { gameAssets } from '../api/assetsManifest.types';

const scenes = {
  play: defineScene({
    actions: [],
    create: () => ({
      enemies: [] as readonly { readonly frame: string; readonly x: number; readonly y: number; readonly rotation: number; readonly scale: number; readonly visible: boolean }[],
    }),
    update: ({ state }) => state,
    snapshot: ({ state }) => state,
  }),
};

type RendererProps = GameRendererProps<typeof scenes, typeof gameAssets>;
void scenes;

function EnemiesBatch({ frame, alpha, viewport, assets }: RendererProps) {
  if (assets === undefined) {
    return null;
  }
  return (
    <GameWorld2D viewport={viewport}>
      <SpriteBatch<typeof scenes, 'play', { readonly frame: string; readonly x: number; readonly y: number; readonly rotation: number; readonly scale: number; readonly visible: boolean }>
        scene="play"
        commit={frame}
        alpha={alpha}
        source={assets.get(gameAssets.gameplay.enemies)}
        capacity={512}
        select={({ current }) => current.enemies}
        write={(write, enemy, index) => {
          'worklet';
          write.set(index, enemy.frame, enemy.x, enemy.y, enemy.rotation, enemy.scale, enemy.visible);
        }}
      />
    </GameWorld2D>
  );
}

// The write setter also accepts an explicit frame name and a visibility flag
// so inactive slots stay hidden without remounting topology.
function BatchedWithVisibility({ frame, alpha, viewport, assets }: RendererProps) {
  if (assets === undefined) {
    return null;
  }
  return (
    <GameWorld2D viewport={viewport}>
      <SpriteBatch<typeof scenes, 'play', { readonly frame: string; readonly x: number; readonly y: number; readonly rotation: number; readonly scale: number; readonly visible: boolean }>
        scene="play"
        commit={frame}
        alpha={alpha}
        source={assets.get(gameAssets.gameplay.enemies)}
        capacity={16}
        select={({ current }) => current.enemies}
        write={(write, enemy, index) => {
          'worklet';
          write.set(index, enemy.frame, enemy.x, enemy.y, enemy.rotation, enemy.scale, enemy.visible);
        }}
      />
    </GameWorld2D>
  );
}

void EnemiesBatch;
void BatchedWithVisibility;
