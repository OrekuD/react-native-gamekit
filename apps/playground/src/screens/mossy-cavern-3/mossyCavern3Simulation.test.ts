import assert from 'node:assert/strict';
import test from 'node:test';

import { MOSSY_CAVERN_3_LEVEL } from './mossyCavern3Level.ts';
import {
  createMossyCavern3State,
  stepMossyCavern3,
  type MossyCavern3Input,
  type MossyCavern3State,
} from './mossyCavern3Simulation.ts';

const DT = 1 / 60;
const IDLE: MossyCavern3Input = {
  dashPressed: false,
  downHeld: false,
  jumpHeld: false,
  jumpPressed: false,
  moveX: 0,
  restartPressed: false,
};

function step(state: MossyCavern3State, input: Partial<MossyCavern3Input> = {}) {
  return stepMossyCavern3(MOSSY_CAVERN_3_LEVEL, state, { ...IDLE, ...input }, DT);
}

function withPlayer(
  state: MossyCavern3State,
  player: Partial<MossyCavern3State['player']>,
): MossyCavern3State {
  return { ...state, player: { ...state.player, ...player } };
}

test('falls onto GameKit tile collision and becomes grounded', () => {
  let state = withPlayer(createMossyCavern3State(), {
    body: { x: 160, y: 560, width: 42, height: 64 },
    velocity: { x: 0, y: 0 },
  });

  for (let tick = 0; tick < 90; tick += 1) state = step(state).state;

  assert.equal(state.player.body.y + state.player.body.height, 704);
  assert.equal(state.player.velocity.y, 0);
  assert.equal(state.player.grounded, true);
});

test('buffered jump fires on landing and held input does not retrigger it', () => {
  let state = withPlayer(createMossyCavern3State(), {
    body: { x: 160, y: 625, width: 42, height: 64 },
    velocity: { x: 0, y: 560 },
    grounded: false,
  });

  const buffered = step(state, { jumpHeld: true, jumpPressed: true });
  state = buffered.state;
  const events = [...buffered.events];
  for (let tick = 0; tick < 8; tick += 1) {
    const result = step(state, { jumpHeld: true });
    state = result.state;
    events.push(...result.events);
  }

  assert.equal(events.filter((event) => event.type === 'jumped').length, 1);
  assert.ok(state.player.velocity.y < 0);
});

test('coyote jump is accepted shortly after leaving a ledge', () => {
  const initial = withPlayer(createMossyCavern3State(), {
    body: { x: 500, y: 400, width: 42, height: 64 },
    coyoteSeconds: 0.05,
    grounded: false,
    velocity: { x: 120, y: 10 },
  });

  const result = step(initial, { jumpHeld: true, jumpPressed: true });

  assert.ok(result.state.player.velocity.y < 0);
  assert.deepEqual(result.events.map((event) => event.type), ['jumped']);
});

test('crossing a collectible at speed collects it exactly once', () => {
  const crystal = MOSSY_CAVERN_3_LEVEL.crystals[0]!;
  let state = withPlayer(createMossyCavern3State(), {
    body: { x: crystal.bounds.x - 180, y: crystal.bounds.y, width: 42, height: 64 },
    velocity: { x: 12_000, y: 0 },
    dashSeconds: 0.2,
  });

  const first = step(state);
  state = first.state;
  const second = step(state);

  assert.deepEqual(first.state.collectedCrystalIds, [crystal.id]);
  assert.equal(first.events.filter((event) => event.type === 'crystal-collected').length, 1);
  assert.equal(second.events.filter((event) => event.type === 'crystal-collected').length, 0);
});

test('checkpoint applies before same-tick hazard and becomes respawn target', () => {
  const checkpoint = MOSSY_CAVERN_3_LEVEL.checkpoints[0]!;
  const hazardState = {
    ...createMossyCavern3State(),
    player: {
      ...createMossyCavern3State().player,
      body: { ...checkpoint.bounds },
      velocity: { x: 0, y: 0 },
    },
  };
  const level = {
    ...MOSSY_CAVERN_3_LEVEL,
    hazards: [{ id: 'test-hazard', bounds: checkpoint.bounds }],
  };

  const result = stepMossyCavern3(level, hazardState, IDLE, DT);

  assert.equal(result.state.activeCheckpointId, checkpoint.id);
  assert.equal(result.state.phase, 'respawning');
  assert.deepEqual(result.events.map((event) => event.type), ['checkpoint-activated', 'player-hurt']);
});

test('respawn preserves progress, clears transients, and cuts the camera', () => {
  const checkpoint = MOSSY_CAVERN_3_LEVEL.checkpoints[0]!;
  let state: MossyCavern3State = {
    ...createMossyCavern3State(),
    activeCheckpointId: checkpoint.id,
    cameraCutId: 4,
    collectedCrystalIds: [MOSSY_CAVERN_3_LEVEL.crystals[0]!.id],
    phase: 'respawning',
    respawnSeconds: 0.001,
  };

  state = step(state).state;

  assert.equal(state.phase, 'playing');
  assert.deepEqual(state.player.body, checkpoint.respawnBody);
  assert.deepEqual(state.player.velocity, { x: 0, y: 0 });
  assert.equal(state.cameraCutId, 5);
  assert.equal(state.collectedCrystalIds.length, 1);
});

test('exit is locked until every crystal is collected and win emits once', () => {
  const exit = MOSSY_CAVERN_3_LEVEL.exit;
  const atExit = withPlayer(createMossyCavern3State(), {
    body: { ...exit.bounds },
    velocity: { x: 0, y: 0 },
  });

  const locked = step(atExit);
  assert.equal(locked.state.phase, 'playing');

  const ready = {
    ...atExit,
    collectedCrystalIds: MOSSY_CAVERN_3_LEVEL.crystals.map((crystal) => crystal.id),
  };
  const won = step(ready);
  const after = step(won.state);

  assert.equal(won.state.phase, 'won');
  assert.equal(won.events.filter((event) => event.type === 'level-completed').length, 1);
  assert.equal(after.events.filter((event) => event.type === 'level-completed').length, 0);
});

test('camera shake decays while gameplay is frozen for respawn or victory', () => {
  const respawning = {
    ...createMossyCavern3State(),
    cameraShakeSeconds: 0.4,
    phase: 'respawning' as const,
    respawnSeconds: 0.6,
  };
  const won = {
    ...createMossyCavern3State(),
    cameraShakeSeconds: 0.4,
    phase: 'won' as const,
  };

  assert.ok(step(respawning).state.cameraShakeSeconds < respawning.cameraShakeSeconds);
  assert.ok(step(won).state.cameraShakeSeconds < won.cameraShakeSeconds);
});

test('restarting a won run resets progress and publishes a camera cut', () => {
  const won = {
    ...createMossyCavern3State(),
    cameraCutId: 7,
    collectedCrystalIds: MOSSY_CAVERN_3_LEVEL.crystals.map((crystal) => crystal.id),
    phase: 'won' as const,
  };

  const restarted = step(won, { restartPressed: true }).state;

  assert.equal(restarted.phase, 'playing');
  assert.deepEqual(restarted.collectedCrystalIds, []);
  assert.equal(restarted.cameraCutId, 8);
});

test('step does not mutate its prior state or authored level arrays', () => {
  const state = createMossyCavern3State();
  const priorBody = { ...state.player.body };
  const crystalIds = MOSSY_CAVERN_3_LEVEL.crystals.map((crystal) => crystal.id);

  step(state, { moveX: 1 });

  assert.deepEqual(state.player.body, priorBody);
  assert.deepEqual(MOSSY_CAVERN_3_LEVEL.crystals.map((crystal) => crystal.id), crystalIds);
});
