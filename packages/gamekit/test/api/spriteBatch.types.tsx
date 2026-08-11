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

import { gameAssets } from '../api/assetsManifest.types';

type Scenes = {
  play: unknown;
};

type RendererProps = GameRendererProps<Scenes, typeof gameAssets>;

function EnemiesBatch({ frame, alpha, viewport, assets }: RendererProps & {
  readonly assets: never;
}) {
  return (
    <GameWorld2D viewport={viewport}>
      <SpriteBatch
        scene="play"
        commit={frame}
        alpha={alpha}
        source={assets.get(gameAssets.gameplay.enemies)}
        capacity={512}
        select={({ current }) => current.enemies}
        write={(write, enemy, index) => {
          'worklet';
          write.set(index, enemy.frame, enemy.x, enemy.y, enemy.rotation, enemy.scale);
        }}
      />
    </GameWorld2D>
  );
}

// The write setter also accepts an explicit frame name and a visibility flag
// so inactive slots stay hidden without remounting topology.
function BatchedWithVisibility({ frame, alpha, viewport, assets }: RendererProps & {
  readonly assets: never;
}) {
  return (
    <GameWorld2D viewport={viewport}>
      <SpriteBatch
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
