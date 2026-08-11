/**
 * Compile-time fixture: shape-only games keep working without assets.
 *
 * Type-checked by `pnpm typecheck`. A game definition without an `assets`
 * manifest, a renderer without the asset generic, and a `GameView` without
 * the `assets` prop all compile unchanged — the manifest is strictly
 * optional and adds no native dependency to the headless definition.
 */
import { defineGame, defineScene } from '../../src/index';
import { GameView, type GameRendererProps } from '../../src/react';

const viewport = {
  logicalSize: { width: 320, height: 480 },
  mode: 'fit',
} as const;

const scenes = {
  play: defineScene({
    actions: [],
    create: () => ({ circleX: 80 }),
    update: ({ state }) => ({ circleX: state.circleX + 1 }),
    snapshot: ({ state }) => ({ circleX: state.circleX }),
  }),
};

// No `assets` key at all.
export const shapeOnlyGame = defineGame({
  viewport,
  input: {},
  scenes,
  initialScene: 'play',
});

// The renderer needs only the scene generic.
type ShapeRendererProps = GameRendererProps<typeof scenes>;
function ShapeRenderer(_props: ShapeRendererProps) {
  return null;
}

// GameView works without the asset prop.
export function ShapeGameView({ game }: { readonly game: never }) {
  return <GameView game={game} renderer={ShapeRenderer} />;
}
