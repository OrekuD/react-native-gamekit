/**
 * Sprite Field renderer (T7.8).
 *
 * The renderer presents the committed snapshot through the public sprite
 * surface: one retained `GameSprite` for the player and one `SpriteBatch`
 * for the enemy field. No sprite position or animation frame is held in
 * React state; the select mappers run on the UI runtime.
 */
import { GameSprite, GameWorld2D, SpriteBatch, type GameRendererProps } from 'react-native-gamekit/react';
import type { SharedValue } from 'react-native-reanimated';

import { spriteFieldAssets, type PlaySnapshot, type SpriteFieldDefinition } from './spriteFieldGame';

type RendererProps = GameRendererProps<SpriteFieldDefinition['scenes'], typeof spriteFieldAssets>;


export function SpriteFieldRenderer({ frame, alpha, viewport, assets }: RendererProps) {
  if (assets === undefined) {
    return null;
  }

  return (
    <GameWorld2D viewport={viewport}>
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
      />
    </GameWorld2D>
  );
}

// Re-export for the renderer's props typing at the call site.
export type SpriteFieldRendererProps = RendererProps & {
  readonly alpha: SharedValue<number>;
};
