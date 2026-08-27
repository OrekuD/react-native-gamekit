/**
 * Sprite Field renderer (T7.8, T12.7).
 *
 * The renderer presents the committed snapshot through the public sprite
 * surface: one retained `GameSprite` for the player and one `SpriteBatch`
 * for the enemy field, both inside a camera-aware `GameWorld2D` with
 * parallax layers. The enemy batch culls off-screen slots through the
 * presented camera; culling never touches the simulation. No sprite
 * position or animation frame is held in React state.
 */
import { GameSprite, GameLayer2D, GameWorld2D, SpriteBatch, type GameRendererProps } from 'rn-gamekit/react';
import type { SharedValue } from 'react-native-reanimated';
import { Rect } from '@shopify/react-native-skia';

import { spriteFieldAssets, type PlaySnapshot, type SpriteFieldDefinition } from './spriteFieldGame';

type RendererProps = GameRendererProps<SpriteFieldDefinition['scenes'], typeof spriteFieldAssets>;

export function SpriteFieldRenderer({ frame, alpha, viewport, camera, assets }: RendererProps) {
  if (assets === undefined) {
    return null;
  }

  return (
    <GameWorld2D viewport={viewport} camera={camera}>
      {/* Parallax hills (T12.7): camera-fixed-ish decoration at 0.25 and
          0.5; the layer correction is a pure translation, so zoom and
          rotation still apply fully. */}
      <GameLayer2D parallax={{ x: 0.25, y: 0.25 }}>
        <Rect x={200} y={900} width={500} height={300} color="rgba(34, 197, 94, 0.18)" />
        <Rect x={1300} y={1100} width={600} height={400} color="rgba(34, 197, 94, 0.14)" />
      </GameLayer2D>
      <GameLayer2D parallax={{ x: 0.5, y: 0.5 }}>
        <Rect x={700} y={1200} width={400} height={250} color="rgba(59, 130, 246, 0.15)" />
        <Rect x={1700} y={700} width={450} height={280} color="rgba(59, 130, 246, 0.12)" />
      </GameLayer2D>

      <GameSprite<SpriteFieldDefinition['scenes'], 'play'>
        scene="play"
        commit={frame}
        alpha={alpha}
        source={assets.get(spriteFieldAssets.gameplay.player)}
        anchor={{ x: 0.5, y: 1 }}
        select={({ previous, current, alpha: t }) => {
          'worklet';
          return {
            x: previous.playerX + (current.playerX - previous.playerX) * t,
            y: current.playerY,
            clip: current.animation.clip,
            elapsedMs: current.animation.elapsedMs,
            scale: 0.7,
            flipX: current.facing === 'left',
          };
        }}
      />
      <SpriteBatch<
        SpriteFieldDefinition['scenes'],
        'play',
        { readonly frame: string; readonly x: number; readonly y: number; readonly rotation: number; readonly scale: number; readonly visible: boolean }
      >
        scene="play"
        commit={frame}
        alpha={alpha}
        source={assets.get(spriteFieldAssets.gameplay.enemies)}
        capacity={64}
        select={({ current }) => {
          'worklet';
          const play = current as unknown as PlaySnapshot;
          return play.enemies;
        }}
        write={(write, enemy, index) => {
          'worklet';
          write.set(index, enemy.frame, enemy.x, enemy.y, enemy.rotation, enemy.scale, enemy.visible);
        }}
        // T12.7: the batch hides slots outside the presented camera view.
        // Slot identity and capacity stay fixed; the simulation never
        // knows culling happened. Without a camera binding the batch draws
        // everything (the exact pre-camera path).
        cull={
          camera === undefined
            ? undefined
            : {
                camera,
                viewport,
                padding: 32,
                bounds: (enemy) => {
                  'worklet';
                  return {
                    x: enemy.x - 10,
                    y: enemy.y - 10,
                    width: 20,
                    height: 20,
                  };
                },
              }
        }
      />
    </GameWorld2D>
  );
}

// Re-export for the renderer's props typing at the call site.
export type SpriteFieldRendererProps = RendererProps & {
  readonly alpha: SharedValue<number>;
};
