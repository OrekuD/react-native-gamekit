/**
 * Compile fixture: preferred imports from `rn-gamekit/storage`.
 */
import {
  defineGameSave,
  createGameSaveStore,
  createMemoryStorageAdapter,
  createGameStorageAdapter,
  GameStorageError,
  STORAGE_LIMITS,
  STORAGE_ENVELOPE_FORMAT,
  type GameSaveSchema,
  type GameStorageAdapter,
  type GameSaveLoadResult,
  type GameSaveStore,
  type StoredGameEnvelope,
} from 'rn-gamekit/storage';

type MySave = { highScore: number; coins: number };

const schema: GameSaveSchema<MySave> = defineGameSave<MySave>({
  id: 'com.example.game.save',
  version: 2,
  createDefault: () => ({ highScore: 0, coins: 0 }),
  validate: (v) => {
    const o = v as Record<string, unknown>;
    if (typeof o.highScore !== 'number') throw new Error('bad');
    if (typeof o.coins !== 'number') throw new Error('bad');
    return { highScore: o.highScore, coins: o.coins };
  },
  migrations: {
    1: (v) => ({ ...(v as object), coins: 0 }),
  },
});

void schema.id;
void schema.version;

const adapter: GameStorageAdapter = createMemoryStorageAdapter();
void adapter.read;
void adapter.write;
void adapter.remove;

const rnAdapter: GameStorageAdapter = createGameStorageAdapter();
void rnAdapter;

const store: GameSaveStore<MySave> = createGameSaveStore({ schema, adapter, namespace: 'test' });
void store.load;
void store.save;
void store.remove;
void store.delete;
void store.flush;
void store.dispose;
void store.disposed;

async function useLoad(): Promise<void> {
  const res: GameSaveLoadResult<MySave> = await store.load('slot1');
  if (res.status === 'default') void res.data.highScore;
  if (res.status === 'stored') void res.data.coins;
  if (res.status === 'migrated') {
    void res.fromVersion;
    void res.toVersion;
  }
}

void useLoad;

const err = new GameStorageError('bad', { code: 'INVALID_SLOT' });
void err.code;
void err.operation;
void err.path;
void err.cause;

void STORAGE_LIMITS.MAX_SERIALIZED_BYTES;
void STORAGE_LIMITS.MAX_DEPTH;
void STORAGE_ENVELOPE_FORMAT;

const envelope: StoredGameEnvelope = {
  format: 'rn-gamekit.save',
  schemaId: 'com.example.game.save',
  schemaVersion: 2,
  savedAtMs: Date.now(),
  payload: { highScore: 1, coins: 2 },
};
void envelope;

// Negative: React/Skia must not leak through storage
// @ts-expect-error — GameView not in storage
import type { GameView } from 'rn-gamekit/storage';
// @ts-expect-error — createGameSession not in storage
import { createGameSession } from 'rn-gamekit/storage';
void null as unknown as GameView;
void createGameSession;
