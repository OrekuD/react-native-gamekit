/** Durable, game-owned profile projection for Mossy Cavern 2. */
import { createGameSaveStore, createGameStorageAdapter, defineGameSave } from 'rn-gamekit/storage';

export interface MossyCavern2Profile {
  readonly muted: boolean;
  readonly hapticsMuted: boolean;
  readonly relicsRecovered: number;
  readonly checkpointsReached: number;
  readonly completedRuns: number;
  readonly bestTimeMs: number | null;
}

export const DEFAULT_MOSSY_CAVERN_2_PROFILE: MossyCavern2Profile = {
  muted: false,
  hapticsMuted: false,
  relicsRecovered: 0,
  checkpointsReached: 0,
  completedRuns: 0,
  bestTimeMs: null,
};

function nonnegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
  return value as number;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

export function validateMossyCavern2Profile(value: unknown): MossyCavern2Profile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Mossy Cavern 2 profile must be an object');
  }
  const record = value as Record<string, unknown>;
  const rawBestTime = record.bestTimeMs;
  const bestTimeMs =
    rawBestTime === null
      ? null
      : typeof rawBestTime === 'number' && Number.isFinite(rawBestTime) && rawBestTime >= 0
        ? rawBestTime
        : (() => {
            throw new Error('bestTimeMs must be a finite nonnegative number or null');
          })();
  return {
    muted: boolean(record.muted, 'muted'),
    hapticsMuted: boolean(record.hapticsMuted, 'hapticsMuted'),
    relicsRecovered: nonnegativeInteger(record.relicsRecovered, 'relicsRecovered'),
    checkpointsReached: nonnegativeInteger(record.checkpointsReached, 'checkpointsReached'),
    completedRuns: nonnegativeInteger(record.completedRuns, 'completedRuns'),
    bestTimeMs,
  };
}

/**
 * T20G-R2: narrow the slot's `startupSave` metadata into a validated durable
 * baseline for the content layer. Anything that fails validation (or a
 * missing record) recovers through the content-side load.
 */
export function readStartupMossyCavern2Profile(startupSave: unknown): MossyCavern2Profile | null {
  if (startupSave === undefined || startupSave === null) return null;
  try {
    return validateMossyCavern2Profile(startupSave);
  } catch {
    return null;
  }
}

/**
 * T20F-R3: load and validate the persisted profile projection for session
 * hydration. Fail-open by contract: no storage, a missing save, an abort, or
 * an I/O error yields `undefined` and the shell constructs a fresh run.
 */
export async function loadMossyCavern2Profile(signal?: AbortSignal): Promise<MossyCavern2Profile | undefined> {
  if (signal?.aborted) return undefined;
  const store = createGameSaveStore({
    schema: mossyCavern2ProfileSchema,
    adapter: createGameStorageAdapter(),
    namespace: 'playground',
  });
  try {
    const result = await store.load('profile');
    if (signal?.aborted) return undefined;
    return result.status === 'default' ? undefined : result.data;
  } catch {
    return undefined;
  } finally {
    store.dispose();
  }
}

export const mossyCavern2ProfileSchema = defineGameSave<MossyCavern2Profile>({
  id: 'mossy-cavern-2-profile',
  version: 1,
  createDefault: () => ({ ...DEFAULT_MOSSY_CAVERN_2_PROFILE }),
  validate: validateMossyCavern2Profile,
});
