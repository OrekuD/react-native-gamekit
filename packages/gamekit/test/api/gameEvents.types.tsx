/**
 * Compile-time contract fixture (T13.0) for deterministic game events.
 *
 * Typechecked only — never executed. Frozen by `tsconfig.assets.json`
 * (`pnpm typecheck:assets`) once the events surface lands.
 */

import { defineGame, defineGameEvents, defineScene, gameEvent, type GameEventEnvelope, type GameSession, type Point2D } from 'rn-gamekit';

// ---------------------------------------------------------------------------
// Definitions preserve literal names and payload types.
// ---------------------------------------------------------------------------
const events = defineGameEvents({
  'brick-hit': gameEvent<{ brickId: string; point: Point2D }>(),
  'life-lost': gameEvent<{ remaining: number }>(),
  'game-over': gameEvent<{ won: boolean; score: number }>(),
});

// Literal inference: keyof typeof events is 'brick-hit' | 'life-lost' | 'game-over'
type EventNames = keyof typeof events; // 'brick-hit' | 'life-lost' | 'game-over'
const _names: EventNames = 'brick-hit';

// ---------------------------------------------------------------------------
// Scenes declare which events they may emit; the game validates emits.
// ---------------------------------------------------------------------------
const ready = defineScene({
  actions: ['primary'],
  transitions: ['play'],
  create: () => ({ ready: true }),
  update: ({ state, transition, tick }) => {
    if (tick === 1) transition.setScene('play');
    return state;
  },
  snapshot: ({ state }) => state,
});

// Inline-scene emission is fully typed via defineGame's contextual event map.
// Separate definitions without an explicit event map default to unknown payloads,
// so this fixture demonstrates the typed path inline.


// A scene that emits an unknown event for validation tests.
const badNameScene = defineScene({
  actions: [],
  emits: ['unknown-event'],
  create: () => ({}),
  update: ({ events }) => {
    // @ts-expect-error - cannot emit undeclared name
    events.emit('unknown-event', {});
    return {};
  },
  snapshot: () => ({}),
});

// Wrong payload shape is a type error (when events map is known via defineGame's contextual typing).
// For the fixture, demonstrate wrong payload at the subscription site as well.

const gameOver = defineScene({
  actions: [],
  create: () => ({}),
  update: ({ state }) => state,
  snapshot: ({ state }) => state,
});

const game = defineGame({ // eslint-disable-line @typescript-eslint/no-unused-vars
  viewport: { logicalSize: { width: 320, height: 480 }, mode: 'fit' },
  input: { primary: { type: 'pointer' } },
  events,
  scenes: {
    ready,
    play: defineScene({
      actions: ['primary'],
      transitions: ['game-over'],
      emits: ['brick-hit', 'life-lost'],
      create: () => ({ score: 0 }),
      update: ({ state, events, tick }) => {
        if (tick === 2) {
          events.emit('brick-hit', { brickId: '1', point: { x: 10, y: 20 } });
        }
        if (tick === 3) {
          events.emit('life-lost', { remaining: 2 });
        }
        return state;
      },
      snapshot: ({ state }) => state,
    }),
    'game-over': gameOver,
  },
  initialScene: 'ready',
});

// Game without events retains the fast path.
const noEventGame = defineGame({
  viewport: { logicalSize: { width: 100, height: 100 }, mode: 'fit' },
  input: {},
  scenes: {
    solo: defineScene({
      actions: [],
      create: () => ({ x: 0 }),
      update: ({ state }) => state,
      snapshot: ({ state }) => state,
    }),
  },
  initialScene: 'solo',
});

// ---------------------------------------------------------------------------
// Session subscriptions are typed to the game's event map.
// ---------------------------------------------------------------------------
declare const session: GameSession<typeof game.scenes, typeof game.input, typeof events>;

// Correct subscription
const sub1 = session.addGameEventListener('brick-hit', (event) => {
  const id: string = event.payload.brickId;
  const pt: Point2D = event.payload.point;
  const tick: number = event.tick;
  const ordinal: number = event.ordinal;
  void id; void pt; void tick; void ordinal;
});

// @ts-expect-error - cannot subscribe to undeclared event
session.addGameEventListener('unknown-event', () => {});

// Wrong payload access should error (payload is DeepReadonly, but reading is okay; writing is error)
session.addGameEventListener('brick-hit', (event) => {
  // @ts-expect-error - payload is readonly
  event.payload.brickId = 'hacked';
});

// Envelope shape is frozen and typed
type BrickHitEnvelope = GameEventEnvelope<'brick-hit', { brickId: string; point: Point2D }>;
declare const envelope: BrickHitEnvelope;
const frozenPayload: Readonly<BrickHitEnvelope['payload']> = envelope.payload;

// ---------------------------------------------------------------------------
// defineGame validates that scene emits are subset of game events.
// ---------------------------------------------------------------------------
// @ts-expect-error - scene emits 'unknown-event' not in game events
defineGame({
  viewport: { logicalSize: { width: 100, height: 100 }, mode: 'fit' },
  input: {},
  events,
  scenes: { solo: badNameScene },
  initialScene: 'solo',
});

const emittingScene = defineScene({
  actions: [],
  emits: ['brick-hit'],
  create: () => ({}),
  update: ({ state }) => state,
  snapshot: () => ({}),
});

// @ts-expect-error - scene emits but game has no events map
defineGame({
  viewport: { logicalSize: { width: 100, height: 100 }, mode: 'fit' },
  input: {},
  scenes: { solo: emittingScene },
  initialScene: 'solo',
});

// ---------------------------------------------------------------------------
// Cleanup is idempotent.
// ---------------------------------------------------------------------------
sub1.remove();
sub1.remove();

void noEventGame;
void _names;
void frozenPayload;
