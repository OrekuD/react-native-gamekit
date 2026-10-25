/** Compile-only: the React owner preserves the definition's typed events. */
import { createGameSession, defineGame, defineGameEvents, defineScene, gameEvent } from 'rn-gamekit';
import { createGameLifecycleSource, GameView, useGameSession, useGameSessionStatus } from 'rn-gamekit/react';

const events = defineGameEvents({ scored: gameEvent<{ points: number }>() });
const scenes = {
  play: defineScene({
    actions: [],
    create: () => ({ score: 0 }),
    update: ({ state }) => state,
    snapshot: ({ state }) => state,
  }),
};
const game = defineGame({
  viewport: { logicalSize: { width: 320, height: 480 }, mode: 'fit' },
  input: {},
  scenes,
  initialScene: 'play',
  events,
});
const noEvents = defineGame({
  viewport: game.viewport,
  input: {},
  scenes,
  initialScene: 'play',
});

function Renderer() { return null; }

// Existing consumers must also accept the fully typed headless session.
export function HeadlessConsumers() {
  const session = createGameSession(game);
  useGameSessionStatus(session);
  createGameLifecycleSource(session);
  return <GameView game={session} renderer={Renderer} />;
}

export function HookConsumers() {
  const session = useGameSession(game);
  useGameSessionStatus(session);
  // @ts-expect-error The owner still returns undefined before commit.
  void session.status;
  if (session === undefined) return null;
  session.addGameEventListener('scored', (event) => {
    const points: number = event.payload.points;
    // @ts-expect-error Payloads retain their declared types.
    const text: string = event.payload.points;
    // @ts-expect-error Published payloads remain readonly.
    event.payload.points = 2;
    void points; void text;
  });
  // @ts-expect-error Undeclared event names are rejected.
  session.addGameEventListener('missing', () => {});
  createGameLifecycleSource(session);
  return <GameView game={session} renderer={Renderer} />;
}

export function NoEventOwner() {
  const session = useGameSession<typeof noEvents.scenes, typeof noEvents.input>(noEvents);
  useGameSessionStatus(session);
  return session === undefined ? null : <GameView game={session} renderer={Renderer} />;
}
