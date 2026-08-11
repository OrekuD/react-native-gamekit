/**
 * Compile-time fixture: `useGameAssets` loading states, the `GameView` asset
 * prop, and the renderer manifest generic (Example 2).
 *
 * Type-checked by `pnpm typecheck`. The loading-state shape is:
 *
 * - `{ status: 'loading'; progress: number }` — progress in [0, 1];
 * - `{ status: 'error'; error: GameAssetsError; retry: () => void }`;
 * - `{ status: 'ready'; assets: LoadedAssets<Manifest> }`.
 *
 * The session is created only after assets are ready; `GameView` receives the
 * stable loaded lease and the renderer looks frames up through the
 * manifest-typed `GameRendererProps` generic.
 */
import { defineGame, defineScene, type GameAssetError, type GameDefinition, type LoadedAssets } from '../../src/index';
import { GameView, useGameAssets, type GameRendererProps } from '../../src/react';

import { gameAssets } from '../api/assetsManifest.types';

const viewport = {
  logicalSize: { width: 320, height: 480 },
  mode: 'fit',
} as const;

const scenes = {
  play: defineScene({
    actions: ['primary'],
    create: () => ({ playerX: 160 }),
    update: ({ state, input }) => {
      const primary = input.pointer('primary');
      return { playerX: primary.pressed ? state.playerX + 1 : state.playerX };
    },
    snapshot: ({ state }) => ({ playerX: state.playerX }),
  }),
};

export const spriteGameDefinition = defineGame({
  viewport,
  assets: gameAssets,
  input: {
    primary: { type: 'pointer' },
  },
  scenes,
  initialScene: 'play',
});

// The definition carries the manifest type without the session owning
// native resources.
spriteGameDefinition satisfies GameDefinition<typeof scenes, typeof spriteGameDefinition.input, 'play', typeof gameAssets>;

export function SpriteGameScreen() {
  const state = useGameAssets(gameAssets, {
    groups: ['boot', 'gameplay'],
  });

  if (state.status === 'loading') {
    // progress is a number in [0, 1]; no assets are available yet.
    const progress: number = state.progress;
    void progress;
    return null;
  }

  if (state.status === 'error') {
    const error: GameAssetError = state.error;
    const retry: () => void = state.retry;
    void error;
    void retry;
    return null;
  }

  // Ready: the lease is stable and typed to THIS manifest.
  const assets: LoadedAssets<typeof gameAssets> = state.assets;
  const playerSheet = assets.get(gameAssets.gameplay.player);
  void playerSheet;
  return <SpriteGameView assets={assets} />;
}

function SpriteGameView({ assets }: { readonly assets: LoadedAssets<typeof gameAssets> }) {
  // The session is created after assets are ready and disposed by this
  // component; the loaded lease is passed into GameView.
  return (
    <GameView
      game={createSession()}
      assets={assets}
      renderer={SpriteGameRenderer}
    />
  );
}

function createSession() {
  return undefined as never;
}

type RendererProps = GameRendererProps<typeof scenes, typeof gameAssets>;

function SpriteGameRenderer(_props: RendererProps) {
  return null;
}
