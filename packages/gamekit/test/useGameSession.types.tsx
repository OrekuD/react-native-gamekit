/**
 * Compile-time fixture (T9.0/T9.4) for the `useGameSession` call surface.
 *
 * Typechecked only — never executed. Proves exact scene/snapshot/input
 * inference from a supplied `GameDefinition`, the initial-`undefined`
 * contract, the asset-ready outer boundary, and expected type failures for
 * non-definitions, dependency-array overloads, and undeclared actions.
 */
import { createGameSession, defineAssets, defineGame, defineScene, image } from '../src/index';
import {
  GamePointerInput,
  GameView,
  useGameAssets,
  useGameSession,
  type GameRendererProps,
} from '../src/react';

const game = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {
    steer: { type: 'pointer', description: 'Move the paddle' },
    fire: { type: 'button' },
  },
  scenes: {
    ready: defineScene({
      actions: ['fire'],
      create: () => ({ started: false }),
      update: ({ state, input }) => (input.button('fire').pressed ? { started: true } : state),
      snapshot: ({ state }) => ({ started: state.started }),
    }),
    play: defineScene({
      actions: ['steer'],
      create: () => ({ x: 0, y: 0 }),
      update: ({ state, input }) => {
        const steer = input.pointer('steer');
        return steer.active && steer.position !== undefined
          ? { x: steer.position.x, y: state.y }
          : state;
      },
      snapshot: ({ state }) => ({ x: state.x, y: state.y }),
    }),
  },
  initialScene: 'ready',
});

type Game = typeof game;

function RendererFixture(props: GameRendererProps<Game['scenes']>): null {
  props.frame.value.scene satisfies 'ready' | 'play';
  props.alpha.value satisfies number;
  props.viewport.value satisfies unknown;
  if (props.frame.value.scene === 'play') {
    props.frame.value.current.x satisfies number;
    props.frame.value.current.y satisfies number;
  }
  return null;
}

export function ScreenFixture() {
  const session = useGameSession(game);

  if (session === undefined) {
    // The initial-undefined contract: deliberate fallback, no loading flag.
    return null;
  }

  // Exact scene and input inference from the definition.
  session.scene satisfies 'ready' | 'play';
  session.input.begin('steer', 1, { x: 1, y: 2 });
  session.input.press('fire');

  return (
    <GameView game={session} renderer={RendererFixture}>
      <GamePointerInput game={session} action="steer" />
    </GameView>
  );
}

// --- expected failures ------------------------------------------------------

// @ts-expect-error a live session is not a definition
useGameSession(createGameSession(game));

// @ts-expect-error plain objects are not definitions
useGameSession({});

// @ts-expect-error the dependency-array overload does not exist
useGameSession(game, [game]);

export function FailuresFixture() {
  const session = useGameSession(game);
  if (session === undefined) {
    return null;
  }

  // @ts-expect-error undeclared input actions are rejected
  session.input.begin('nope', 1, { x: 0, y: 0 });

  return (
    <GameView game={session} renderer={RendererFixture}>
      {/* @ts-expect-error the pointer action must be declared on the game */}
      <GamePointerInput game={session} action="nope" />
    </GameView>
  );
}

// --- asset-backed outer boundary (T9.0) --------------------------------------

const manifest = defineAssets({
  boot: { logo: image(1) },
  gameplay: { player: image(2) },
});

const assetGame = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {},
  assets: manifest,
  scenes: {
    play: defineScene({
      actions: [],
      create: () => ({}),
      update: ({ state }) => state,
      snapshot: () => ({}),
    }),
  },
  initialScene: 'play',
});

function AssetReadyChild(): null {
  // The hook is used only inside a child that mounts after readiness.
  const session = useGameSession(assetGame);
  session?.scene satisfies 'play' | undefined;
  return null;
}

export function AssetBackedScreenFixture() {
  const state = useGameAssets(manifest, { groups: ['gameplay'] });
  if (state.status !== 'ready') {
    return null;
  }
  return <AssetReadyChild />;
}

export {};
