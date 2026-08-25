/**
 * Storage Lab reference game — T17.4.
 *
 * Provides real settings and checkpoint projections with versioned migrations,
 * and a deterministic checkpoint event that the screen binds to an async save
 * effect outside simulation.
 */
import { createGameSession, defineGame, defineScene } from 'rn-gamekit';
import { defineGameEvents, gameEvent } from 'rn-gamekit/events';
import { defineGameSave } from 'rn-gamekit/storage';

// ---------------------------------------------------------------------------
// Settings projection (small user preferences, not per tick)
// ---------------------------------------------------------------------------

export type StorageLabSettings = {
  volume: number;
  muted: boolean;
  language: string;
};

function validateSettings(value: unknown): StorageLabSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('settings must be object');
  const v = value as Record<string, unknown>;
  if (typeof v.volume !== 'number' || !Number.isFinite(v.volume) || v.volume < 0 || v.volume > 1) throw new Error('volume must be finite 0..1');
  if (typeof v.muted !== 'boolean') throw new Error('muted must be boolean');
  if (typeof v.language !== 'string' || v.language.length === 0) throw new Error('language must be string');
  return { volume: v.volume, muted: v.muted, language: v.language };
}

export const storageLabSettingsSchema = defineGameSave<StorageLabSettings>({
  id: 'com.oreku.storage-lab.settings',
  version: 1,
  createDefault: () => ({ volume: 1, muted: false, language: 'en' }),
  validate: validateSettings,
  migrations: {},
});

// ---------------------------------------------------------------------------
// Save projection — versioned, with two historical migrations
// V1: { highScore: number, unlockedLevels: string[] }
// V2: { highScore: number, unlockedLevels: string[], coins: number }
// V3: { highScore: number, unlockedLevels: string[], coins: number, checkpointIndex: number }
// ---------------------------------------------------------------------------

export type StorageLabSaveV1 = { highScore: number; unlockedLevels: string[] };
export type StorageLabSaveV2 = StorageLabSaveV1 & { coins: number };
export type StorageLabSave = StorageLabSaveV2 & { checkpointIndex: number };

function validateSave(value: unknown): StorageLabSave {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('save must be object');
  const v = value as Record<string, unknown>;
  if (typeof v.highScore !== 'number' || !Number.isFinite(v.highScore)) throw new Error('highScore must be finite');
  if (!Array.isArray(v.unlockedLevels)) throw new Error('unlockedLevels must be array');
  for (let i = 0; i < (v.unlockedLevels as unknown[]).length; i += 1) if (typeof (v.unlockedLevels as unknown[])[i] !== 'string') throw new Error(`unlockedLevels[${i}] must be string`);
  if (typeof v.coins !== 'number' || !Number.isFinite(v.coins)) throw new Error('coins must be finite');
  if (typeof v.checkpointIndex !== 'number' || !Number.isInteger(v.checkpointIndex) || v.checkpointIndex < -1) throw new Error('checkpointIndex must be integer >= -1');
  return v as StorageLabSave;
}

function migrateV1ToV2(value: unknown): unknown {
  const v1 = value as StorageLabSaveV1;
  return { ...v1, coins: 0 };
}
function migrateV2ToV3(value: unknown): unknown {
  const v2 = value as StorageLabSaveV2;
  return { ...v2, checkpointIndex: -1 };
}

export const storageLabSaveSchema = defineGameSave<StorageLabSave>({
  id: 'com.oreku.storage-lab.save',
  version: 3,
  createDefault: () => ({ highScore: 0, unlockedLevels: ['level-1'], coins: 0, checkpointIndex: -1 }),
  validate: validateSave,
  migrations: { 1: migrateV1ToV2, 2: migrateV2ToV3 },
});

// ---------------------------------------------------------------------------
// Checkpoint event (Task 13) — emitted from fixed-step update
// ---------------------------------------------------------------------------

export const storageLabEvents = defineGameEvents({
  /** Payload carries the complete save projection captured at the committed
   * boundary, so async consumers never depend on later getRenderFrame() calls. */
  checkpoint: gameEvent<{ readonly index: number; readonly x: number; readonly save: StorageLabSave }>(),
  'settings-changed': gameEvent<{ readonly volume: number }>(),
});

// ---------------------------------------------------------------------------
// Minimal headless game — moves a point right, checkpoints at 100, 200, 300
// ---------------------------------------------------------------------------

export type StorageLabSnapshot = {
  x: number;
  checkpointIndex: number;
  checkpointsReached: readonly boolean[];
  ticks: number;
};

const CHECKPOINTS = [100, 200, 300] as const;

function makeStorageLabScene(initial?: StorageLabSave) {
  return defineScene({
    actions: ['right'] as const,
    emits: ['checkpoint'] as const,
    events: storageLabEvents,
    create: (): StorageLabSnapshot => {
      const idx = initial?.checkpointIndex ?? -1;
      return {
        x: idx >= 0 ? CHECKPOINTS[idx] ?? 0 : 0,
        checkpointIndex: idx,
        checkpointsReached: CHECKPOINTS.map((_, i) => i <= idx),
        ticks: 0,
      };
    },
    update: ({ state, events, deltaSeconds }) => {
      const speed = 60;
      const nextX = state.x + speed * deltaSeconds;
      let checkpointIndex = state.checkpointIndex;
      const checkpointsReached = [...state.checkpointsReached] as boolean[];
      const crossed: { index: number; x: number }[] = [];
      CHECKPOINTS.forEach((cx, i) => {
        if (!checkpointsReached[i] && state.x < cx && nextX >= cx) {
          checkpointsReached[i] = true;
          if (i > checkpointIndex) checkpointIndex = i;
          crossed.push({ index: i, x: cx });
        }
      });
      const next: StorageLabSnapshot = { x: nextX, checkpointIndex, checkpointsReached, ticks: state.ticks + 1 };
      // Emit after computing the committed next state so the payload's projection
      // is exactly the resumable save for this boundary.
      for (const c of crossed) {
        events.emit('checkpoint', { index: c.index, x: c.x, save: projectStorageLabSave(next) });
      }
      return next;
    },
    snapshot: ({ state }): StorageLabSnapshot => ({ ...state }),
  });
}

export function createStorageLabDefinition(initial?: StorageLabSave) {
  return defineGame({
    viewport: { logicalSize: { width: 320, height: 480 }, mode: 'fit' },
    input: { right: { type: 'button' } },
    events: storageLabEvents,
    scenes: { lab: makeStorageLabScene(initial) },
    initialScene: 'lab',
  });
}

export const storageLabDefinition = createStorageLabDefinition();

export function createStorageLabSession(initial?: StorageLabSave) {
  return createGameSession(createStorageLabDefinition(initial));
}

export function projectStorageLabSave(snapshot: StorageLabSnapshot, highScore = 0): StorageLabSave {
  return {
    highScore,
    unlockedLevels: snapshot.checkpointIndex >= 2 ? ['level-1', 'level-2', 'level-3'] : snapshot.checkpointIndex >= 1 ? ['level-1', 'level-2'] : ['level-1'],
    coins: Math.max(0, Math.floor(snapshot.x / 10)),
    checkpointIndex: snapshot.checkpointIndex,
  };
}
