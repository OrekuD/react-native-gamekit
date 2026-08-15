/**
 * Compile-time fixture (T10.1) for the observable status contract.
 * Typechecked only — never executed.
 */
import {
  createGameSession,
  defineGame,
  defineScene,
  type GameSessionStatus,
  type GameSubscription,
} from '../src/index';

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

const session = createGameSession(game);

// The listener receives the exact status union.
const subscription: GameSubscription = session.addStatusListener(
  (status: GameSessionStatus) => {
    status satisfies GameSessionStatus;
  },
);

// The established removable subscription shape applies.
subscription.remove();
subscription.remove();

// @ts-expect-error the listener must be a function accepting the status
session.addStatusListener(42);

// @ts-expect-error the status union has no other members
const impossible: GameSessionStatus = 'nope';
void impossible;

export {};
