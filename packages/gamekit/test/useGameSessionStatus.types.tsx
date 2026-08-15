/**
 * Compile-time fixture (T10.5): useGameSessionStatus composes
 * unconditionally with useGameSession (Rules of Hooks) and preserves exact
 * `GameSessionStatus | undefined` inference. Typechecked only.
 */
import { defineGame, defineScene, type GameSessionStatus } from '../src/index';
import { useGameSession, useGameSessionStatus } from '../src/react';

const game = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {},
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

export function Screen() {
  const session = useGameSession(game);
  const status = useGameSessionStatus(session);

  status satisfies GameSessionStatus | undefined;

  if (session === undefined) {
    return null;
  }

  if (status === 'paused') {
    // Paused UI can drive lifecycle commands on the live session.
    session.start();
  }

  return null;
}

// @ts-expect-error the hook takes a session or undefined, not a definition
useGameSessionStatus(game);

// @ts-expect-error the hook takes at most one argument
useGameSessionStatus(undefined, undefined);

export {};
