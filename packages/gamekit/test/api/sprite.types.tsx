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
import { defineScene, type LoadedImage, type LoadedSpriteSheet } from '../../src/index';
import type { SharedValue } from 'react-native-reanimated';

import { gameAssets } from '../api/assetsManifest.types';

const scenes = {
  play: defineScene({
    actions: [],
    create: () => ({
      playerX: 160,
      playerY: 300,
      facing: 'right' as 'left' | 'right',
      animation: { clip: 'idle', elapsedMs: 0 },
    }),
    update: ({ state }) => state,
    snapshot: ({ state }) => ({ ...state, animation: { ...state.animation } }),
  }),
};

type RendererProps = GameRendererProps<typeof scenes, typeof gameAssets>;
void scenes;

function PlayerSprite({ frame, alpha, viewport, assets }: RendererProps) {
  if (assets === undefined) {
    return null;
  }
  return (
    <GameWorld2D viewport={viewport}>
      <GameSprite<typeof scenes, 'play'>
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
  readonly source: LoadedImage | LoadedSpriteSheet;
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
  readonly source: LoadedImage | LoadedSpriteSheet;
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
