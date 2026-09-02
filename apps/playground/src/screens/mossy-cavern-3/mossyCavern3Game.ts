import {
  createGameSession,
  defineGame,
  defineScene,
  sampleCameraShake2D,
  type CommitFrame,
  type GameSession,
} from 'rn-gamekit';
import { defineGameEvents, gameEvent } from 'rn-gamekit/events';

import { MOSSY_CAVERN_3_LEVEL } from './mossyCavern3Level.ts';
import type { MossyCavern3SaveData } from './mossyCavern3Save.ts';
import {
  createMossyCavern3State,
  stepMossyCavern3,
  type MossyCavern3SimulationEvent,
  type MossyCavern3State,
} from './mossyCavern3Simulation.ts';

export const mossyCavern3Events = defineGameEvents({
  jumped: gameEvent<{ readonly x: number; readonly y: number }>(),
  landed: gameEvent<{ readonly x: number; readonly y: number }>(),
  dashed: gameEvent<{ readonly x: number; readonly y: number }>(),
  'crystal-collected': gameEvent<{
    readonly id: string;
    readonly x: number;
    readonly y: number;
  }>(),
  'checkpoint-activated': gameEvent<{
    readonly id: string;
    readonly deaths: number;
  }>(),
  'player-hurt': gameEvent<{ readonly deaths: number; readonly cause: string }>(),
  'level-completed': gameEvent<{ readonly ticks: number; readonly deaths: number }>(),
});

export interface MossyCavern3Snapshot {
  readonly player: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly velocityX: number;
    readonly velocityY: number;
    readonly facing: -1 | 1;
    readonly grounded: boolean;
    readonly dashing: boolean;
  };
  readonly phase: MossyCavern3State['phase'];
  readonly collectedCrystalIds: readonly string[];
  readonly crystalCount: number;
  readonly crystalTotal: number;
  readonly activeCheckpointId: string | null;
  readonly deaths: number;
  readonly elapsedTicks: number;
  readonly camera: MossyCavern3State['camera'];
  readonly cameraCutId: number;
  readonly effectSequence: number;
  readonly effectKind: MossyCavern3State['effectKind'];
  readonly effectPosition: MossyCavern3State['effectPosition'];
}

function emitSimulationEvent(
  event: MossyCavern3SimulationEvent,
  emitter: {
    emit(name: 'jumped', payload: { readonly x: number; readonly y: number }): void;
    emit(name: 'landed', payload: { readonly x: number; readonly y: number }): void;
    emit(name: 'dashed', payload: { readonly x: number; readonly y: number }): void;
    emit(name: 'crystal-collected', payload: { readonly id: string; readonly x: number; readonly y: number }): void;
    emit(name: 'checkpoint-activated', payload: { readonly id: string; readonly deaths: number }): void;
    emit(name: 'player-hurt', payload: { readonly deaths: number; readonly cause: string }): void;
    emit(name: 'level-completed', payload: { readonly ticks: number; readonly deaths: number }): void;
  },
): void {
  switch (event.type) {
    case 'jumped':
      emitter.emit('jumped', { x: event.x, y: event.y });
      break;
    case 'landed':
      emitter.emit('landed', { x: event.x, y: event.y });
      break;
    case 'dashed':
      emitter.emit('dashed', { x: event.x, y: event.y });
      break;
    case 'crystal-collected':
      emitter.emit(event.type, { id: event.id, x: event.x, y: event.y });
      break;
    case 'checkpoint-activated':
      emitter.emit(event.type, { deaths: event.deaths, id: event.id });
      break;
    case 'player-hurt':
      emitter.emit(event.type, { cause: event.cause, deaths: event.deaths });
      break;
    case 'level-completed':
      emitter.emit(event.type, { deaths: event.deaths, ticks: event.ticks });
      break;
  }
}

const playScene = defineScene({
  actions: ['left', 'right', 'jump', 'dash', 'down', 'restart'],
  emits: [
    'jumped',
    'landed',
    'dashed',
    'crystal-collected',
    'checkpoint-activated',
    'player-hurt',
    'level-completed',
  ],
  events: mossyCavern3Events,
  create: createMossyCavern3State,
  update: ({ state, input, events, deltaSeconds }) => {
    const left = input.button('left');
    const right = input.button('right');
    const jump = input.button('jump');
    const result = stepMossyCavern3(
      MOSSY_CAVERN_3_LEVEL,
      state,
      {
        dashPressed: input.button('dash').pressed,
        downHeld: input.button('down').held,
        jumpHeld: jump.held,
        jumpPressed: jump.pressed,
        moveX: left.held === right.held ? 0 : left.held ? -1 : 1,
        restartPressed: input.button('restart').pressed,
      },
      deltaSeconds,
    );
    for (const event of result.events) emitSimulationEvent(event, events);
    return result.state;
  },
  snapshot: ({ state }): MossyCavern3Snapshot => {
    const camera =
      state.cameraShakeSeconds > 0
        ? sampleCameraShake2D(state.camera, {
            amplitude: state.effectKind === 'win' ? 8 : 14,
            durationSeconds: 0.42,
            elapsedSeconds: Math.max(0, 0.42 - state.cameraShakeSeconds),
            frequency: 54,
            seed: state.effectSequence + state.deaths * 101,
          })
        : state.camera;
    return {
      activeCheckpointId: state.activeCheckpointId,
      camera,
      cameraCutId: state.cameraCutId,
      collectedCrystalIds: state.collectedCrystalIds,
      crystalCount: state.collectedCrystalIds.length,
      crystalTotal: MOSSY_CAVERN_3_LEVEL.crystals.length,
      deaths: state.deaths,
      effectKind: state.effectKind,
      effectPosition: state.effectPosition,
      effectSequence: state.effectSequence,
      elapsedTicks: state.elapsedTicks,
      phase: state.phase,
      player: {
        dashing: state.player.dashSeconds > 0,
        facing: state.player.facing,
        grounded: state.player.grounded,
        height: state.player.body.height,
        velocityX: state.player.velocity.x,
        velocityY: state.player.velocity.y,
        width: state.player.body.width,
        x: state.player.body.x,
        y: state.player.body.y,
      },
    };
  },
});

/** T20F-R3: build the definition for one session generation (see the save hydration). */
export function createMossyCavern3Definition(save?: MossyCavern3SaveData) {
  return defineGame({
    events: mossyCavern3Events,
    initialScene: 'play',
    input: {
      left: { description: 'Move left', type: 'button' },
      right: { description: 'Move right', type: 'button' },
      jump: { description: 'Jump', type: 'button' },
      dash: { description: 'Dash', type: 'button' },
      down: { description: 'Drop through one-way platforms', type: 'button' },
      restart: { description: 'Restart after completing the cavern', type: 'button' },
    },
    scenes: {
      play: { ...playScene, create: () => createMossyCavern3State(MOSSY_CAVERN_3_LEVEL, save) },
    },
    viewport: {
      logicalSize: { height: 720, width: 1280 },
      mode: 'fit',
    },
  });
}

export const mossyCavern3Definition = createMossyCavern3Definition();

export type MossyCavern3Definition = ReturnType<typeof createMossyCavern3Definition>;
export type MossyCavern3RenderFrame = CommitFrame<MossyCavern3Definition['scenes']>;
export type MossyCavern3Session = GameSession<
  MossyCavern3Definition['scenes'],
  MossyCavern3Definition['input'],
  typeof mossyCavern3Events
>;

/** Create one session, hydrating from a prepared save when provided (T20F-R3). */
export function createMossyCavern3Session(save?: MossyCavern3SaveData): MossyCavern3Session {
  return createGameSession(createMossyCavern3Definition(save));
}
