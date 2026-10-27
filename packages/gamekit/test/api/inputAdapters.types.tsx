/** Public input adapter names and eventful-session compatibility. Compile only. */
import { createGameSession, defineGame, defineGameEvents, defineScene, gameEvent } from 'rn-gamekit';
import { GameButton, GameButtonPad, GamePointerInput, type ButtonActionName } from 'rn-gamekit/react';

const input = { drag: { type: 'pointer' }, jump: { type: 'button' } } as const;
const definition = defineGame({
  viewport: { logicalSize: { width: 320, height: 480 }, mode: 'fit' },
  input,
  events: defineGameEvents({ scored: gameEvent<{ points: number }>() }),
  scenes: {
    play: defineScene({
      actions: ['drag', 'jump'],
      create: () => ({}),
      update: ({ state }) => state,
      snapshot: ({ state }) => state,
    }),
  },
  initialScene: 'play',
});
const session = createGameSession(definition);
const dragResetRevision: number = session.input.getResetRevision('drag');
const jumpResetRevision: number = session.input.getResetRevision('jump');
// @ts-expect-error Reset revisions are available only for declared actions.
session.input.getResetRevision('missing');
void dragResetRevision;
void jumpResetRevision;

const buttonActions = { jump: 'jump' } satisfies Record<string, ButtonActionName<typeof input>>;
// @ts-expect-error A pointer name cannot be used in a typed button-action map.
const wrongButton: ButtonActionName<typeof input> = 'drag';
// @ts-expect-error Unknown action names are rejected by the public type helper.
const unknownButton: ButtonActionName<typeof input> = 'shoot';
void wrongButton;
void unknownButton;

export const pointer = <GamePointerInput game={session} action="drag" />;
// @ts-expect-error Pointer adapter rejects a declared button action.
export const wrongPointer = <GamePointerInput game={session} action="jump" />;
// @ts-expect-error Pointer adapter rejects an undeclared action.
export const unknownPointer = <GamePointerInput game={session} action="missing" />;
export const buttons = (
  <GameButtonPad game={session} hitSlop={12}>
    <GameButton action={buttonActions.jump}>Jump</GameButton>
  </GameButtonPad>
);
