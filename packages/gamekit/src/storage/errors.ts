/**
 * V1 storage errors — stable codes, operation, namespace/slot, schema context,
 * exact path where relevant, and original cause.
 */
export type GameStorageErrorCode =
  | 'INVALID_NAMESPACE'
  | 'INVALID_SLOT'
  | 'INVALID_SCHEMA_ID'
  | 'INVALID_SCHEMA_VERSION'
  | 'INVALID_MIGRATION'
  | 'UNSUPPORTED_VALUE'
  | 'SERIALIZATION_FAILED'
  | 'SIZE_EXCEEDED'
  | 'DEPTH_EXCEEDED'
  | 'BACKEND_READ_FAILED'
  | 'BACKEND_WRITE_FAILED'
  | 'BACKEND_REMOVE_FAILED'
  | 'CORRUPT_ENVELOPE'
  | 'SCHEMA_ID_MISMATCH'
  | 'FUTURE_VERSION'
  | 'MISSING_MIGRATION'
  | 'MIGRATION_FAILED'
  | 'VALIDATION_FAILED'
  | 'DISPOSED';

export type GameStorageOperation = 'load' | 'save' | 'remove' | 'delete' | 'flush' | 'dispose' | 'validate' | 'migrate' | 'serialize' | 'parse';

export class GameStorageError extends Error {
  override readonly name = 'GameStorageError';

  readonly code: GameStorageErrorCode;
  readonly operation: GameStorageOperation | undefined;
  readonly namespace: string | undefined;
  readonly slot: string | undefined;
  readonly schemaId: string | undefined;
  readonly schemaVersion: number | undefined;
  readonly path: string | undefined;
  override readonly cause: unknown | undefined;

  constructor(
    message: string,
    options: {
      code: GameStorageErrorCode;
      operation?: GameStorageOperation | undefined;
      namespace?: string | undefined;
      slot?: string | undefined;
      schemaId?: string | undefined;
      schemaVersion?: number | undefined;
      path?: string | undefined;
      cause?: unknown | undefined;
    },
  ) {
    super(message);
    this.code = options.code;
    this.operation = options.operation;
    this.namespace = options.namespace;
    this.slot = options.slot;
    this.schemaId = options.schemaId;
    this.schemaVersion = options.schemaVersion;
    this.path = options.path;
    this.cause = options.cause;
  }
}

export function storageError(
  message: string,
  code: GameStorageErrorCode,
  opts: {
    operation?: GameStorageOperation | undefined;
    namespace?: string | undefined;
    slot?: string | undefined;
    schemaId?: string | undefined;
    schemaVersion?: number | undefined;
    path?: string | undefined;
    cause?: unknown | undefined;
  } = {},
): GameStorageError {
  return new GameStorageError(message, {
    code,
    operation: opts.operation,
    namespace: opts.namespace,
    slot: opts.slot,
    schemaId: opts.schemaId,
    schemaVersion: opts.schemaVersion,
    path: opts.path,
    cause: opts.cause,
  });
}
