/**
 * Idle placeholder session (T7 R2).
 *
 * The persistent surface needs a session before a required-asset game has
 * created its real session; the placeholder is a minimal one-scene game with
 * an empty snapshot, created and disposed with the surface. It exists so
 * loading and error UI can be represented without a running gameplay session.
 */
import { createGameSession, defineGame, defineScene, type GameSession } from 'rn-gamekit';

const idleScene = defineScene({
  actions: [],
  create: () => ({}),
  update: ({ state }) => state,
  snapshot: () => ({}),
});

const idleDefinition = defineGame({
  viewport: {
    logicalSize: { width: 320, height: 480 },
    mode: 'fit',
  },
  input: {},
  scenes: { play: idleScene },
  initialScene: 'play',
});

export function createIdleSession(): GameSession {
  // The placeholder is treated opaquely by the surface; the concrete scene
  // types differ only in their generic parameters, so the cast is contained.
  return createGameSession(idleDefinition) as unknown as GameSession;
}
