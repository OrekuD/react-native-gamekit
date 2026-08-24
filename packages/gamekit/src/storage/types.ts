/**
 * V1 storage contracts — game-owned projections, engine envelope, adapter.
 */

export interface GameSaveSchema<TData> {
  readonly id: string;
  readonly version: number;
  readonly createDefault: () => TData;
  readonly validate: (value: unknown) => TData;
  readonly migrations: Readonly<Record<number, (value: unknown) => unknown>>;
}

export interface GameStorageAdapter {
  read(key: string): Promise<string | undefined>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface StoredGameEnvelope {
  readonly format: 'rn-gamekit.save';
  readonly schemaId: string;
  readonly schemaVersion: number;
  readonly savedAtMs: number;
  readonly payload: unknown;
}

export type GameSaveLoadStatus = 'default' | 'stored' | 'migrated';

export interface GameSaveLoadResult<TData> {
  readonly status: GameSaveLoadStatus;
  readonly data: TData;
  /** Present only when status === 'migrated' */
  readonly fromVersion?: number;
  /** Present only when status === 'migrated' */
  readonly toVersion?: number;
}

export interface CreateGameSaveStoreOptions<TData> {
  readonly schema: GameSaveSchema<TData>;
  readonly adapter: GameStorageAdapter;
  readonly namespace: string;
}

export interface GameSaveStore<TData> {
  load(slot: string): Promise<GameSaveLoadResult<TData>>;
  save(slot: string, data: TData): Promise<void>;
  /** Alias for delete — both names are accepted */
  remove(slot: string): Promise<void>;
  delete(slot: string): Promise<void>;
  flush(): Promise<void>;
  dispose(): void;
  readonly disposed: boolean;
}

export const STORAGE_LIMITS = {
  MAX_SERIALIZED_BYTES: 262_144, // 256 KiB per slot
  MAX_DEPTH: 16,
  MAX_NODES: 4096,
  MAX_ARRAY_LENGTH: 1024,
  MAX_OBJECT_FIELDS: 1024,
  MAX_STRING_LENGTH: 16_384,
} as const;
