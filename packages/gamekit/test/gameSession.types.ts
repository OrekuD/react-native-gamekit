/**
 * Compile-time fixture for the Task 3 public contract: named scenes,
 * discriminated render frames, typed lifecycle operations, pointer sampling,
 * and readonly public values.
 */
import {
  createGameSession,
  defineGame,
  defineScene,
  type CommitFrame,
  type GameRenderFrame,
  type GameSession,
  type InputFrame,
  type PointerState,
} from '../src/index.ts';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

// Three scenes with different snapshot shapes.
const readyScene = defineScene({
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
});

const playScene = defineScene({
  actions: ['primary'],
  transitions: ['game-over'],
  create: () => ({ score: 0, paddleX: 160 }),
  update: ({ state, input, transition }) => {
    const pointer = input.pointer('primary');
    if (pointer.position !== undefined) {
      state = { ...state, paddleX: pointer.position.x };
    }
    if (state.score >= 10) {
      transition.setScene('game-over');
    }
    return state;
  },
  snapshot: ({ state }) => ({ score: state.score, paddleX: state.paddleX }),
});

const gameOverScene = defineScene({
  actions: [],
  transitions: ['play'],
  create: () => ({ won: false }),
  update: ({ state, transition }) => {
    transition.restartScene();
    return state;
  },
  snapshot: ({ state }) => ({ won: state.won }),
});

const game = defineGame({
  viewport,
  input: {
    primary: { type: 'pointer' },
    boost: { type: 'button' },
  },
  scenes: { ready: readyScene, play: playScene, 'game-over': gameOverScene },
  initialScene: 'ready',
});

const session = createGameSession(game);

// `game.scene` is typed as the union of declared scene names.
session.scene satisfies 'ready' | 'play' | 'game-over';
// @ts-expect-error session scene names are the declared scene keys
session.scene satisfies 'bogus';

// `setScene` accepts only declared scene names.
session.setScene('play');
// @ts-expect-error setScene accepts only declared scene names
session.setScene('bogus');

// `session.input` is constrained to declared action names.
session.input.press('boost');
session.input.begin('primary', 1, { x: 0, y: 0 });
// @ts-expect-error input action names are inferred from the game definition
session.input.press('missing');
// @ts-expect-error pointer operations require a declared action name
session.input.begin('bogus', 1, { x: 0, y: 0 });

// The render frame is a discriminated union: narrowing on `scene` narrows
// both `previous` and `current` to the corresponding snapshot type.
declare const frame: CommitFrame<typeof game.scenes>;
frame.scene satisfies 'ready' | 'play' | 'game-over';
if (frame.scene === 'play') {
  frame.current.score satisfies number;
  frame.current.paddleX satisfies number;
  frame.previous.score satisfies number;
  // @ts-expect-error `previous` and `current` are narrowed to the play snapshot
  frame.current.ready satisfies boolean;
}
if (frame.scene === 'ready') {
  frame.current.ready satisfies boolean;
  // @ts-expect-error ready snapshots do not carry a score
  frame.current.score satisfies number;
}

// Public commit frames are readonly.
// @ts-expect-error commit frames are readonly
frame.scene = 'ready';
frame.revision satisfies number;
frame.hardCut satisfies boolean;
frame.stepMs satisfies number;
// @ts-expect-error renderer snapshots are deeply readonly
frame.current.position = { x: 1, y: 2 };

// Pointer frames are readonly.
declare const pointer: PointerState;
pointer.active satisfies boolean;
pointer.delta satisfies { readonly x: number; readonly y: number };
// @ts-expect-error pointer state is readonly
pointer.active = false;
// @ts-expect-error pointer delta is readonly
pointer.delta.x = 1;

// Session viewport config and status are readonly.
session.viewport.mode satisfies 'fit' | 'fill' | 'extend-world';
session.status satisfies 'idle' | 'running' | 'paused' | 'disposed';

// The session type is preserved for external callers.
declare const externalSession: GameSession<typeof game.scenes, typeof game.input>;
externalSession.setScene('play');
externalSession.restartScene();

// Scene input frames carry both action kinds with runtime-safe names.
declare const inputFrame: InputFrame<'boost' | 'primary'>;
inputFrame.button('boost').held satisfies boolean;
inputFrame.pointer('primary').active satisfies boolean;

// A generic CommitFrame remains available for snapshot-level helpers.
declare const genericFrame: CommitFrame<typeof game.scenes>;
genericFrame.current satisfies unknown;

// Commit listeners receive envelopes without a presentation fraction; the
// render-frame shape (with on-demand alpha) stays available for headless use.
declare const renderFrame: GameRenderFrame<typeof game.scenes>;
renderFrame.alpha satisfies number;
declare function observe(frame: CommitFrame<typeof game.scenes>): void;
declare const someSession: GameSession<typeof game.scenes, typeof game.input>;
someSession.addCommitListener(observe);
// @ts-expect-error the presentation-frame listener API was removed before v1
game.addRenderFrameListener(observe);
