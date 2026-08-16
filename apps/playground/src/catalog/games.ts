/**
 * The playground's canonical game catalog.
 *
 * One immutable list drives the home screen metadata, the store's
 * `PlaygroundGameId` union, and the shell's exhaustive screen registry, so an
 * id can never be declared in one place and forgotten in another.
 */

/** Canonical, type-checked ids of every catalogued playground game. */
export type PlaygroundGameId = (typeof PLAYGROUND_GAMES)[number]['id'];

/** Home-list metadata for one catalogued game. */
export type PlaygroundGameInfo = (typeof PLAYGROUND_GAMES)[number];

export const PLAYGROUND_GAMES = [
  {
    id: 'brick-breaker',
    title: 'Brick Breaker',
    description: 'A complete arcade loop: pointer paddle, collisions, win/lose, restart.',
    label: 'Play',
  },
  {
    id: 'bootstrap',
    title: 'First runtime slice',
    description: 'A moving Skia circle driven by a fixed-step GameSession.',
    label: 'Play',
  },
  {
    id: 'perf-lab',
    title: 'Performance Lab',
    description: 'Deterministic diagnostics: counters, frame deltas, stall probe.',
    label: 'Run',
  },
  {
    id: 'collision-lab',
    title: 'Collision Lab',
    description: 'Inspect static and swept contacts, filters, and broad-phase candidates.',
    label: 'Run',
  },
  {
    id: 'paddle',
    title: 'Paddle',
    description: 'The getting-started tutorial game: steer with your finger, keep the ball alive, pause anytime.',
    label: 'Play',
  },
  {
    id: 'camera-lab',
    title: 'Camera Lab',
    description: 'Follow, zoom, rotation, cuts, shake, world bounds, and culling on one screen.',
    label: 'Run',
  },
  {
    id: 'sprite-field',
    title: 'Sprite Field',
    description: 'A retained animated character over an Atlas batch field.',
    label: 'Play',
  },
] as const;

/** Every canonical game id, used for runtime validation at the untyped boundary. */
export const PLAYGROUND_GAME_IDS: readonly PlaygroundGameId[] = PLAYGROUND_GAMES.map(
  (game) => game.id,
);

/** Runtime guard for untyped JavaScript callers reaching the store. */
export function isPlaygroundGameId(value: unknown): value is PlaygroundGameId {
  return typeof value === 'string' && PLAYGROUND_GAME_IDS.includes(value as PlaygroundGameId);
}
