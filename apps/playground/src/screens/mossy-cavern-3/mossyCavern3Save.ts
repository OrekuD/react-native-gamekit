import { createGameSaveStore, createGameStorageAdapter, defineGameSave } from 'rn-gamekit/storage';

import { MOSSY_CAVERN_3_LEVEL } from './mossyCavern3Level.ts';

export interface MossyCavern3SaveData {
  readonly activeCheckpointId: string | null;
  readonly bestCompletionTicks: number | null;
  readonly collectedCrystalIds: readonly string[];
  readonly deaths: number;
  readonly musicEnabled: boolean;
}

export function createDefaultMossyCavern3Save(): MossyCavern3SaveData {
  return {
    activeCheckpointId: null,
    bestCompletionTicks: null,
    collectedCrystalIds: [],
    deaths: 0,
    musicEnabled: true,
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeMossyCavern3Save(value: unknown): MossyCavern3SaveData {
  const record = recordOf(value);
  const checkpointIds = new Set(MOSSY_CAVERN_3_LEVEL.checkpoints.map((checkpoint) => checkpoint.id));
  const authoredCrystalIds = MOSSY_CAVERN_3_LEVEL.crystals.map((crystal) => crystal.id);
  const requestedCrystals = new Set(
    Array.isArray(record.collectedCrystalIds)
      ? record.collectedCrystalIds.filter((id): id is string => typeof id === 'string')
      : [],
  );
  const activeCheckpointId =
    typeof record.activeCheckpointId === 'string' && checkpointIds.has(record.activeCheckpointId)
      ? record.activeCheckpointId
      : null;
  const bestCompletionTicks =
    typeof record.bestCompletionTicks === 'number' &&
    Number.isSafeInteger(record.bestCompletionTicks) &&
    record.bestCompletionTicks >= 0
      ? record.bestCompletionTicks
      : null;
  const deaths =
    typeof record.deaths === 'number' && Number.isSafeInteger(record.deaths) && record.deaths >= 0
      ? record.deaths
      : 0;

  return {
    activeCheckpointId,
    bestCompletionTicks,
    collectedCrystalIds: authoredCrystalIds.filter((id) => requestedCrystals.has(id)),
    deaths,
    musicEnabled: typeof record.musicEnabled === 'boolean' ? record.musicEnabled : true,
  };
}

/**
 * T20G-R2: narrow the slot's `startupSave` metadata into a validated durable
 * baseline for the content layer. Anything that fails validation (or a
 * missing record) recovers through the content-side load.
 */
export function readStartupMossyCavern3Save(startupSave: unknown): MossyCavern3SaveData | null {
  if (startupSave === undefined || startupSave === null) return null;
  try {
    return normalizeMossyCavern3Save(startupSave);
  } catch {
    return null;
  }
}

/**
 * T20F-R3: load and validate the persisted projection for session hydration.
 * Fail-open by contract: no storage, a missing save, an abort, or an I/O
 * error yields `undefined` and the shell constructs a fresh run.
 */
export async function loadMossyCavern3Save(signal?: AbortSignal): Promise<MossyCavern3SaveData | undefined> {
  if (signal?.aborted) return undefined;
  const store = createGameSaveStore({
    schema: mossyCavern3SaveSchema,
    adapter: createGameStorageAdapter(),
    namespace: 'mossy-cavern-3',
  });
  try {
    const result = await store.load('progress');
    if (signal?.aborted) return undefined;
    return result.status === 'default' ? undefined : result.data;
  } catch {
    return undefined;
  } finally {
    store.dispose();
  }
}

export const mossyCavern3SaveSchema = defineGameSave<MossyCavern3SaveData>({
  createDefault: createDefaultMossyCavern3Save,
  id: 'mossy-cavern-3.progress',
  migrations: {
    1: (value) => ({ ...recordOf(value), bestCompletionTicks: null }),
  },
  validate: normalizeMossyCavern3Save,
  version: 2,
});
