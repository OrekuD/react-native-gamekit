import {
  clampCameraBounds2D,
  followCamera2D,
  type Aabb2D,
  type Camera2D,
  type Vector2D,
} from 'rn-gamekit';
import { intersectsAabbAabb2D, sweepAabbAabb2D } from 'rn-gamekit/collision2d';
import { movePlatformerBody2D } from 'rn-gamekit/tilemap';

import {
  checkpointById,
  MOSSY_CAVERN_3_LEVEL,
  type MossyCavern3Level,
  type MossyCavern3Sensor,
} from './mossyCavern3Level.ts';
import type { MossyCavern3SaveData } from './mossyCavern3Save.ts';

const RUN_SPEED = 360;
const RUN_ACCELERATION = 2_400;
const AIR_ACCELERATION = 1_500;
const GROUND_BRAKE = 3_000;
const GRAVITY = 2_100;
const RELEASE_GRAVITY = 3_500;
const MAX_FALL_SPEED = 1_100;
const JUMP_SPEED = 760;
const COYOTE_SECONDS = 0.11;
const JUMP_BUFFER_SECONDS = 0.12;
const DASH_SPEED = 940;
const DASH_SECONDS = 0.16;
const DASH_COOLDOWN_SECONDS = 0.5;
const DROP_THROUGH_SECONDS = 0.18;
const RESPAWN_SECONDS = 0.72;

export interface MossyCavern3Input {
  readonly moveX: -1 | 0 | 1 | number;
  readonly jumpPressed: boolean;
  readonly jumpHeld: boolean;
  readonly dashPressed: boolean;
  readonly downHeld: boolean;
  readonly restartPressed: boolean;
}

export interface MossyCavern3PlayerState {
  readonly body: Aabb2D;
  readonly velocity: Vector2D;
  readonly grounded: boolean;
  readonly facing: -1 | 1;
  readonly coyoteSeconds: number;
  readonly jumpBufferSeconds: number;
  readonly dashSeconds: number;
  readonly dashCooldownSeconds: number;
  readonly dropThroughSeconds: number;
}

export type MossyCavern3Phase = 'playing' | 'respawning' | 'won';

export interface MossyCavern3State {
  readonly player: MossyCavern3PlayerState;
  readonly phase: MossyCavern3Phase;
  readonly collectedCrystalIds: readonly string[];
  readonly activeCheckpointId: string | null;
  readonly deaths: number;
  readonly respawnSeconds: number;
  readonly elapsedTicks: number;
  readonly cameraCutId: number;
  readonly camera: Camera2D;
  readonly cameraShakeSeconds: number;
  readonly effectSequence: number;
  readonly effectKind: MossyCavern3EffectKind;
  readonly effectPosition: { readonly x: number; readonly y: number };
}

export type MossyCavern3EffectKind =
  | 'none'
  | 'jump'
  | 'land'
  | 'dash'
  | 'crystal'
  | 'checkpoint'
  | 'hurt'
  | 'win';

export type MossyCavern3SimulationEvent =
  | { readonly type: 'jumped'; readonly x: number; readonly y: number }
  | { readonly type: 'landed'; readonly x: number; readonly y: number }
  | { readonly type: 'dashed'; readonly x: number; readonly y: number }
  | { readonly type: 'crystal-collected'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly type: 'checkpoint-activated'; readonly id: string; readonly deaths: number }
  | { readonly type: 'player-hurt'; readonly deaths: number; readonly cause: string }
  | { readonly type: 'level-completed'; readonly ticks: number; readonly deaths: number };

export interface MossyCavern3StepResult {
  readonly state: MossyCavern3State;
  readonly events: readonly MossyCavern3SimulationEvent[];
}

function toward(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(value + amount, target);
  if (value > target) return Math.max(value - amount, target);
  return value;
}

function playerCenter(body: Aabb2D): { readonly x: number; readonly y: number } {
  return { x: body.x + body.width / 2, y: body.y + body.height / 2 };
}

function touchesSensor(
  previousBody: Aabb2D,
  displacement: Vector2D,
  sensor: MossyCavern3Sensor,
): boolean {
  return (
    intersectsAabbAabb2D(previousBody, sensor.bounds) ||
    sweepAabbAabb2D({ aabb: previousBody, displacement, target: sensor.bounds }) !== undefined
  );
}

function withEffect(
  state: MossyCavern3State,
  kind: MossyCavern3EffectKind,
  position: { readonly x: number; readonly y: number },
): MossyCavern3State {
  return {
    ...state,
    cameraShakeSeconds:
      kind === 'hurt' || kind === 'win' ? 0.42 : state.cameraShakeSeconds,
    effectKind: kind,
    effectPosition: position,
    effectSequence: state.effectSequence + 1,
  };
}

export function createMossyCavern3State(
  level: MossyCavern3Level = MOSSY_CAVERN_3_LEVEL,
  save?: MossyCavern3SaveData,
): MossyCavern3State {
  // T20F-R3: hydrate from the validated save — respawn at the saved lantern
  // with its saved crystals and death counter. T20G-R4: an unknown checkpoint
  // id normalizes to `null` (the same normalization the save schema applies)
  // and falls back to the authored spawn, so impossible ids never leak into
  // snapshots or content saves. T20G-R6: the collected-id array is cloned at
  // the state boundary so deep-freezing the first published snapshot never
  // freezes — nor later observes — caller-owned save data.
  const requestedCheckpointId = save?.activeCheckpointId ?? null;
  const checkpoint =
    requestedCheckpointId !== null ? checkpointById(level, requestedCheckpointId) : undefined;
  const activeCheckpointId = checkpoint?.id ?? null;
  const spawnBody = checkpoint?.respawnBody ?? level.spawnBody;
  const camera =
    checkpoint !== undefined
      ? clampCameraBounds2D(
          {
            center: playerCenter(spawnBody),
            rotationRadians: 0,
            zoom: 1,
          },
          level.map.worldBounds,
          { x: 0, y: 0, width: 1280, height: 720 },
        )
      : {
          center: { x: 640, y: 448 },
          rotationRadians: 0,
          zoom: 1,
        };
  return {
    activeCheckpointId,
    camera,
    cameraCutId: 0,
    cameraShakeSeconds: 0,
    collectedCrystalIds: [...(save?.collectedCrystalIds ?? [])],
    deaths: save?.deaths ?? 0,
    effectKind: 'none',
    effectPosition: playerCenter(spawnBody),
    effectSequence: 0,
    elapsedTicks: 0,
    phase: 'playing',
    player: {
      body: { ...spawnBody },
      coyoteSeconds: 0,
      dashCooldownSeconds: 0,
      dashSeconds: 0,
      dropThroughSeconds: 0,
      facing: 1,
      grounded: false,
      jumpBufferSeconds: 0,
      velocity: { x: 0, y: 0 },
    },
    respawnSeconds: 0,
  };
}

function respawn(level: MossyCavern3Level, state: MossyCavern3State): MossyCavern3State {
  const checkpoint = checkpointById(level, state.activeCheckpointId);
  const body = checkpoint?.respawnBody ?? level.spawnBody;
  return {
    ...state,
    camera: clampCameraBounds2D(
      {
        center: playerCenter(body),
        rotationRadians: 0,
        zoom: 1,
      },
      level.map.worldBounds,
      { x: 0, y: 0, width: 1280, height: 720 },
    ),
    cameraCutId: state.cameraCutId + 1,
    cameraShakeSeconds: 0,
    effectKind: 'none',
    phase: 'playing',
    player: {
      body: { ...body },
      coyoteSeconds: 0,
      dashCooldownSeconds: 0,
      dashSeconds: 0,
      dropThroughSeconds: 0,
      facing: 1,
      grounded: false,
      jumpBufferSeconds: 0,
      velocity: { x: 0, y: 0 },
    },
    respawnSeconds: 0,
  };
}

export function stepMossyCavern3(
  level: MossyCavern3Level,
  state: MossyCavern3State,
  input: MossyCavern3Input,
  deltaSeconds: number,
): MossyCavern3StepResult {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    throw new Error(`deltaSeconds must be finite and greater than zero; got ${String(deltaSeconds)}`);
  }
  if (state.phase === 'won') {
    return input.restartPressed
      ? {
          state: {
            ...createMossyCavern3State(level),
            cameraCutId: state.cameraCutId + 1,
          },
          events: [],
        }
      : {
          state: {
            ...state,
            cameraShakeSeconds: Math.max(0, state.cameraShakeSeconds - deltaSeconds),
          },
          events: [],
        };
  }
  if (state.phase === 'respawning') {
    const remaining = state.respawnSeconds - deltaSeconds;
    return remaining <= 0
      ? { state: respawn(level, state), events: [] }
      : {
          state: {
            ...state,
            cameraShakeSeconds: Math.max(0, state.cameraShakeSeconds - deltaSeconds),
            respawnSeconds: remaining,
          },
          events: [],
        };
  }

  let events: readonly MossyCavern3SimulationEvent[] = [];
  const previousPlayer = state.player;
  const moveX = Math.max(-1, Math.min(1, Number.isFinite(input.moveX) ? input.moveX : 0));
  const facing: -1 | 1 = moveX < 0 ? -1 : moveX > 0 ? 1 : previousPlayer.facing;
  const startedDash = input.dashPressed && previousPlayer.dashCooldownSeconds <= 0;
  const dashing = startedDash || previousPlayer.dashSeconds > 0;
  let velocityX = previousPlayer.velocity.x;
  let velocityY = previousPlayer.velocity.y;
  let dashSeconds = Math.max(0, previousPlayer.dashSeconds - deltaSeconds);
  let dashCooldownSeconds = Math.max(0, previousPlayer.dashCooldownSeconds - deltaSeconds);

  if (startedDash) {
    velocityX = facing * DASH_SPEED;
    velocityY = 0;
    dashSeconds = DASH_SECONDS;
    dashCooldownSeconds = DASH_COOLDOWN_SECONDS;
    const center = playerCenter(previousPlayer.body);
    events = [...events, { type: 'dashed', ...center }];
  } else if (!dashing) {
    const targetSpeed = moveX * RUN_SPEED;
    const acceleration = previousPlayer.grounded ? RUN_ACCELERATION : AIR_ACCELERATION;
    velocityX =
      moveX === 0 && previousPlayer.grounded
        ? toward(velocityX, 0, GROUND_BRAKE * deltaSeconds)
        : toward(velocityX, targetSpeed, acceleration * deltaSeconds);
  }

  let jumpBufferSeconds = input.jumpPressed
    ? JUMP_BUFFER_SECONDS
    : Math.max(0, previousPlayer.jumpBufferSeconds - deltaSeconds);
  let coyoteSeconds = previousPlayer.grounded
    ? COYOTE_SECONDS
    : Math.max(0, previousPlayer.coyoteSeconds - deltaSeconds);
  let jumped = false;
  if (!dashing && jumpBufferSeconds > 0 && coyoteSeconds > 0) {
    velocityY = -JUMP_SPEED;
    jumpBufferSeconds = 0;
    coyoteSeconds = 0;
    jumped = true;
    const center = playerCenter(previousPlayer.body);
    events = [...events, { type: 'jumped', ...center }];
  }

  if (!dashing) {
    const gravity = !input.jumpHeld && velocityY < 0 ? RELEASE_GRAVITY : GRAVITY;
    velocityY = Math.min(MAX_FALL_SPEED, velocityY + gravity * deltaSeconds);
  }

  const dropThroughSeconds = input.downHeld
    ? DROP_THROUGH_SECONDS
    : Math.max(0, previousPlayer.dropThroughSeconds - deltaSeconds);
  const movement = movePlatformerBody2D({
    body: previousPlayer.body,
    collisionLayers: level.collisionLayers,
    deltaSeconds,
    dropThroughOneWay: dropThroughSeconds > 0,
    floorSnapDistance: 5,
    map: level.map,
    velocity: { x: velocityX, y: velocityY },
  });
  const grounded = movement.contacts.floor !== undefined;
  const landed = grounded && !previousPlayer.grounded && previousPlayer.velocity.y >= 180;
  velocityX = movement.velocity.x;
  velocityY = movement.velocity.y;
  if (landed) {
    const center = playerCenter(movement.body);
    events = [...events, { type: 'landed', ...center }];
  }
  if (!jumped && grounded && jumpBufferSeconds > 0 && !dashing) {
    velocityY = -JUMP_SPEED;
    jumpBufferSeconds = 0;
    coyoteSeconds = 0;
    jumped = true;
    const center = playerCenter(movement.body);
    events = [...events, { type: 'jumped', ...center }];
  } else if (grounded) {
    coyoteSeconds = COYOTE_SECONDS;
  }

  let next: MossyCavern3State = {
    ...state,
    cameraShakeSeconds: Math.max(0, state.cameraShakeSeconds - deltaSeconds),
    effectKind: 'none',
    elapsedTicks: state.elapsedTicks + 1,
    player: {
      body: movement.body,
      coyoteSeconds,
      dashCooldownSeconds,
      dashSeconds,
      dropThroughSeconds,
      facing,
      grounded: grounded && !jumped,
      jumpBufferSeconds,
      velocity: { x: velocityX, y: velocityY },
    },
  };

  next = {
    ...next,
    camera: clampCameraBounds2D(
      followCamera2D(
        state.camera,
        playerCenter(movement.body),
        {
          dampingHalfLifeSeconds: 0.12,
          deadZone: { x: -210, y: -90, width: 420, height: 180 },
        },
        deltaSeconds,
      ),
      level.map.worldBounds,
      { x: 0, y: 0, width: 1280, height: 720 },
    ),
  };

  if (startedDash) next = withEffect(next, 'dash', playerCenter(movement.body));
  else if (jumped) next = withEffect(next, 'jump', playerCenter(movement.body));
  else if (landed) next = withEffect(next, 'land', playerCenter(movement.body));

  let collectedCrystalIds = next.collectedCrystalIds;
  for (const crystal of level.crystals) {
    if (
      !collectedCrystalIds.includes(crystal.id) &&
      touchesSensor(previousPlayer.body, movement.displacement, crystal)
    ) {
      collectedCrystalIds = [...collectedCrystalIds, crystal.id];
      events = [
        ...events,
        {
          type: 'crystal-collected',
          id: crystal.id,
          x: crystal.bounds.x + crystal.bounds.width / 2,
          y: crystal.bounds.y + crystal.bounds.height / 2,
        },
      ];
      next = withEffect(
        { ...next, collectedCrystalIds },
        'crystal',
        {
          x: crystal.bounds.x + crystal.bounds.width / 2,
          y: crystal.bounds.y + crystal.bounds.height / 2,
        },
      );
    }
  }

  for (const checkpoint of level.checkpoints) {
    if (
      checkpoint.id !== next.activeCheckpointId &&
      touchesSensor(previousPlayer.body, movement.displacement, checkpoint)
    ) {
      next = withEffect(
        { ...next, activeCheckpointId: checkpoint.id },
        'checkpoint',
        playerCenter(checkpoint.bounds),
      );
      events = [
        ...events,
        { type: 'checkpoint-activated', id: checkpoint.id, deaths: next.deaths },
      ];
    }
  }

  const hazard = level.hazards.find((candidate) =>
    touchesSensor(previousPlayer.body, movement.displacement, candidate),
  );
  const fell = movement.body.y > level.deathY;
  if (hazard !== undefined || fell) {
    const deaths = next.deaths + 1;
    next = withEffect(
      {
        ...next,
        deaths,
        phase: 'respawning',
        respawnSeconds: RESPAWN_SECONDS,
        player: { ...next.player, velocity: { x: 0, y: 0 } },
      },
      'hurt',
      playerCenter(movement.body),
    );
    events = [
      ...events,
      { type: 'player-hurt', cause: hazard?.id ?? 'abyss', deaths },
    ];
    return { events, state: next };
  }

  if (
    collectedCrystalIds.length === level.crystals.length &&
    touchesSensor(previousPlayer.body, movement.displacement, level.exit)
  ) {
    next = withEffect({ ...next, phase: 'won' }, 'win', playerCenter(level.exit.bounds));
    events = [
      ...events,
      { type: 'level-completed', deaths: next.deaths, ticks: next.elapsedTicks },
    ];
  }

  return { events, state: next };
}
