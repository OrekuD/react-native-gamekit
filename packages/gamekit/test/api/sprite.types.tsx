/**
 * Compile-time fixture: `GameSprite`/`Sprite` and `GameWorld2D` (Example 3).
 *
 * Type-checked by `pnpm typecheck`. Documents the retained-sprite surface:
 *
 * - `GameWorld2D` applies the resolved viewport once to its children;
 * - `GameSprite` owns the derived-value plumbing, narrows the snapshot by
 *   `scene`, and exposes one coherent worklet `select` mapper;
 * - `Sprite` accepts plain numbers AND Reanimated shared/derived values for
 *   position, rotation, scale, and opacity (asserted at the bottom);
 * - the animation selection is driven by fixed-step state (`clip` +
 *   `elapsedMs`), never by the wall clock.
 */
import { GameWorld2D, GameSprite, Sprite } from '../../src/react';
import type { GameRendererProps } from '../../src/react';
import type { SharedValue } from 'react-native-reanimated';

import { gameAssets } from '../api/assetsManifest.types';

type Scenes = {
  play: unknown;
};

type RendererProps = GameRendererProps<Scenes, typeof gameAssets>;

function PlayerSprite({ frame, alpha, viewport, assets }: RendererProps & {
  readonly assets: never;
}) {
  return (
    <GameWorld2D viewport={viewport}>
      <GameSprite
        scene="play"
        commit={frame}
        alpha={alpha}
        source={assets.get(gameAssets.gameplay.player)}
        anchor={{ x: 0.5, y: 1 }}
        select={({ previous, current, alpha: t }) => {
          'worklet';
          return {
            x: previous.playerX + (current.playerX - previous.playerX) * t,
            y: current.playerY,
            clip: current.animation.clip,
            elapsedMs: current.animation.elapsedMs,
            flipX: current.facing === 'left',
          };
        }}
      />
    </GameWorld2D>
  );
}

// Lower-level Sprite: the direct-prop primitive for advanced composition.
function DirectSprite(props: {
  readonly source: unknown;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly opacity: number;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly flipX: boolean;
  readonly clip: string;
  readonly elapsedMs: number;
}) {
  return <Sprite {...props} />;
}

// Reanimated-compatible surface: shared/derived values and numbers are both
// accepted for every animatable sprite property.
function AnimatedSprite(props: {
  readonly source: unknown;
  readonly x: SharedValue<number>;
  readonly y: number;
  readonly rotation: SharedValue<number>;
  readonly scale: number | SharedValue<number>;
  readonly opacity: SharedValue<number>;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly flipX: boolean;
  readonly clip: SharedValue<string>;
  readonly elapsedMs: SharedValue<number>;
}) {
  return <Sprite {...props} />;
}

void PlayerSprite;
void DirectSprite;
void AnimatedSprite;
