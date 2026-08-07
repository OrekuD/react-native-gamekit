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
] as const;

/** Every canonical game id, used for runtime validation at the untyped boundary. */
export const PLAYGROUND_GAME_IDS: readonly PlaygroundGameId[] = PLAYGROUND_GAMES.map(
  (game) => game.id,
);

/** Runtime guard for untyped JavaScript callers reaching the store. */
export function isPlaygroundGameId(value: unknown): value is PlaygroundGameId {
  return typeof value === 'string' && PLAYGROUND_GAME_IDS.includes(value as PlaygroundGameId);
}
