/**
 * Compile-time fixture for the React adapter call sites: `GameView`,
 * `GamePointerInput`, external transitions, restarts, pointer sampling, and
 * cleanup. This file is typechecked only; it never executes React Native.
 */
import { GameView, GamePointerInput, type GameRendererProps } from '../src/react';
import { defineGame, defineScene, type GameSession } from '../src/index';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

const _definition = defineGame({
  viewport,
  input: {
    primary: { type: 'pointer' },
    boost: { type: 'button' },
  },
  scenes: {
    ready: defineScene({
      actions: ['primary'],
      transitions: ['play'],
      create: () => ({ ready: true }),
      update: ({ state, input, transition }) => {
        if (input.pointer('primary').pressed) {
          transition.setScene('play');
        }
        return state;
      },
      snapshot: ({ state }) => ({ ready: state.ready }),
    }),
    play: defineScene({
      actions: ['primary'],
      create: () => ({ x: 0 }),
      update: ({ state }) => ({ x: state.x + 1 }),
      snapshot: ({ state }) => ({ x: state.x }),
    }),
  },
  initialScene: 'ready',
});

type Scenes = typeof _definition.scenes;

// The renderer receives a scene-discriminated commit envelope, the UI-owned
// alpha clock, and the shared viewport (T5).
function MyRenderer(props: GameRendererProps<Scenes>) {
  props.frame.value.scene satisfies 'ready' | 'play';
  props.alpha.value satisfies number;
  props.viewport.value satisfies unknown;
  return null;
}

// T5: the envelope carries no presentation fraction; alpha is a UI clock.
function _AlphaClockRenderer(props: GameRendererProps<Scenes>) {
  // @ts-expect-error alpha moved out of the commit frame (T5)
  void props.frame.value.alpha;
  return null;
}

// T2: renderer props no longer carry a size polled from the Skia canvas;
// layout is the single size authority (onLayout only).
function _NoSurfaceSizeRenderer(props: GameRendererProps<Scenes>) {
  // @ts-expect-error surfaceSize was removed from renderer props (T2)
  void props.surfaceSize;
  return null;
}

declare const session: GameSession<Scenes, typeof _definition.input>;
session.scene satisfies 'ready' | 'play';
session.setScene('play');
session.restartScene();
// @ts-expect-error setScene accepts only declared scene names
session.setScene('bogus');
// @ts-expect-error the session input is constrained to declared actions
session.input.begin('bogus', 1, { x: 0, y: 0 });

// The composable pointer adapter takes the session and a declared action.
<GameView game={session} renderer={MyRenderer}>
  <GamePointerInput game={session} action="primary" />
</GameView>;

// @ts-expect-error GamePointerInput only accepts declared pointer actions
<GamePointerInput game={session} action="boost" />;

// GameView accepts any declared scene map and keeps static children as HUD.
declare function Hud(): null;
<GameView game={session} renderer={MyRenderer}>
  <Hud />
</GameView>;
