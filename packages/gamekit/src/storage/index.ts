export { GameStorageError } from './errors';
export type { GameStorageErrorCode, GameStorageOperation } from './errors';
export { defineGameSave } from './schema';
export { createGameSaveStore } from './store';
export { createMemoryStorageAdapter } from './adapters/memory';
export { createGameStorageAdapter } from './adapters/asyncStorage';
export { __setAsyncStorageLoader, __getAsyncStorageLoader } from './adapters/asyncStorage';
export type {
  GameSaveSchema,
  GameStorageAdapter,
  StoredGameEnvelope,
  GameSaveLoadResult,
  GameSaveLoadStatus,
  CreateGameSaveStoreOptions,
  GameSaveStore,
} from './types';
export { STORAGE_LIMITS } from './types';
export { STORAGE_ENVELOPE_FORMAT } from './serialization';
