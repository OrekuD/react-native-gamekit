# Task 17: Versioned storage and persistence

## Status

**Planned — Task 13 is recommended for checkpoint requests.** The storage
system remains async application I/O outside the fixed-step loop.

Task 17 is complete when the v1 definition of done is satisfied. The future
expansion backlog remains documented but does not block completion and must not
be implemented without a separate approved task.

## Objective

Give each game explicit ownership of versioned settings and save projections
without serializing internal sessions.

```ts
import {
  createGameSaveStore,
  defineGameSave,
} from 'rn-gamekit/storage';

const saveSchema = defineGameSave({
  id: 'com.oreku.brick-breaker.save',
  version: 3,
  createDefault: () => ({
    highScore: 0,
    unlockedLevels: ['level-1'],
  }),
  validate: validateBrickBreakerSave,
  migrations: {
    1: migrateV1ToV2,
    2: migrateV2ToV3,
  },
});

const saves = createGameSaveStore({
  schema: saveSchema,
  adapter: createGameStorageAdapter(),
  namespace: 'brick-breaker',
});

const loaded = await saves.load('profile-1');
const session = createBrickBreakerSession(loaded.data);

await saves.save('profile-1', projectBrickBreakerSave(gameState));
await saves.flush();
saves.dispose();
```

Names remain provisional through T17.0. The v1 contract is fixed:

- Save data is a game-authored plain projection with a stable schema ID and
  integer version.
- Loading validates and migrates before session creation.
- Saving never introspects or serializes `GameSession`, scene closures,
  renderer snapshots, native resources, refs, or internal queues.
- Writes are serialized per slot so an older slow write cannot overwrite a
  newer request.
- Missing, corrupt, future-version, migration, size, and backend failures are
  explicit.
- Storage is adapter-backed and never runs inside a fixed simulation tick.

## Package and dependency boundary

Storage ships as `rn-gamekit/storage`, a subpath of the single `rn-gamekit` npm
package.

- Do not publish a separate storage package.
- Importing `rn-gamekit` must not initialize or import a native storage backend.
- Keep schema, migration, serialization, store, and in-memory adapter logic
  native-free inside the storage subpath.
- Select one maintained React Native adapter in T17.0 and keep it behind an
  optional peer dependency.
- Pin the validated adapter version in monorepo development dependencies and
  publish a compatible peer range.
- Allow an injected adapter so tests and applications with existing storage
  ownership do not require a second backend.
- Do not add a database or backend registry to the core package.

## Data ownership

V1 supports two explicit workflows that may share one adapter.

### Settings

Settings are small user preferences such as audio volume, mute, haptics,
controls, accessibility, graphics quality, and language.

- Load settings before a game session when needed.
- Save settings on user changes, not every fixed tick or display frame.
- Use a game/app-owned projection and schema.
- Do not store secrets in the v1 adapter.

### Save slots and checkpoints

Save slots contain the game-owned state required to resume play.

- Use explicit profile/slot keys.
- Capture one complete projection from a committed gameplay boundary.
- A Task 13 effect may request an async save after the tick commits.
- Save completion is an application result, not a deterministic game event.
- Pause does not automatically serialize a session.

Downloaded assets, thumbnails, and derived caches remain outside this task.

## V1 scope

### Included in v1

- Versioned schema definitions and immutable current values.
- Default creation for genuine absence or explicit reset.
- Sequential synchronous migrations.
- Namespaced settings and save slots.
- A bounded plain-data serialization contract.
- A small stored envelope with schema ID/version and payload.
- Per-slot serialized load/save/delete operations.
- `flush()` and idempotent disposal.
- Injected adapter, in-memory test adapter, and one selected optional RN
  adapter.
- Explicit load results for default, stored, and migrated data.
- Explicit corruption, future-version, migration, size, and backend errors.
- One reference-game settings/checkpoint integration.
- Task 13 checkpoint-effect example, docs, and focused tests.

### Deferred from v1

- Dual-record journals, checksums, automatic recovery, and repair tooling.
- Cloud saves, accounts, sync, conflict resolution, and server APIs.
- Encryption, Keychain/Keystore secrets, DRM, anti-cheat, and tamper proofing.
- Databases and query APIs over large worlds.
- Asset/DLC cache management and eviction.
- Save rewind, replay archives, and rollback snapshots.
- Background tasks that depend on unlimited OS execution.
- Automatic autosave schedulers and broad coalescing frameworks.
- A generic React data-fetching/store framework.

## V1 schema and data contract

The schema shape must remain focused:

```ts
interface GameSaveSchema<TData> {
  readonly id: string;
  readonly version: number;
  readonly createDefault: () => TData;
  readonly validate: (value: unknown) => TData;
  readonly migrations: Readonly<
    Record<number, (value: unknown) => unknown>
  >;
}
```

- Schema IDs are stable, non-empty, and namespaced to the game.
- Versions are positive safe integers and only increase.
- `createDefault()` applies only to missing data or explicit reset.
- `validate()` returns a newly owned complete current value or throws a
  structured path-aware error.
- Migrations run sequentially from `vN` to `vN+1`, are synchronous and pure,
  and do not mutate their input.
- Missing migration steps and newer stored versions fail clearly.
- Final data is validated, cloned, and frozen before publication.
- Failed migration never overwrites the stored record.

Do not require a specific validation library. Games may adapt schema libraries
as long as they preserve the Gamekit value/error contract.

## V1 stored envelope and validation

Use a small engine-owned envelope separate from game data:

```ts
interface StoredGameEnvelope {
  readonly format: 'rn-gamekit.save';
  readonly schemaId: string;
  readonly schemaVersion: number;
  readonly savedAtMs: number;
  readonly payload: unknown;
}
```

- `savedAtMs` is metadata and never enters deterministic state automatically.
- Reject cycles, functions, symbols, unsupported BigInt values, unsafe
  prototypes, sparse arrays, and non-finite numbers before writing.
- Bound serialized bytes, depth, array length, and object-field count.
- Validate loaded bytes as untrusted input before migration.
- Never log full save payloads by default.
- Do not claim corruption recovery beyond what the selected backend and v1
  envelope actually provide.

## V1 adapter, ordering, and lifecycle

The injected adapter remains intentionally small:

```ts
interface GameStorageAdapter {
  read(key: string): Promise<string | undefined>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
```

- Missing data and read failure are different outcomes.
- Preserve real backend `Error` causes.
- Namespace keys to prevent cross-game collisions.
- Serialize accepted writes for the same slot in request order.
- Allow different slots to proceed independently only with a simple bounded
  policy.
- A save Promise resolves when that specific accepted write completes.
- `flush()` waits for operations accepted before the call.
- `dispose()` rejects new work and has an explicit policy for accepted writes.
- Stale results from replaced store/schema/slot generations cannot publish.
- Do not use timers to repair ordering.

V1 relies on the selected adapter's documented write guarantees. Stronger
journaling and recovery are future capabilities and must not be implied by the
public result type.

## Errors and privacy

Use a real `GameStorageError` with stable codes, operation, namespace/slot,
schema context, exact data path where relevant, and original cause.

Cover at least:

- invalid namespace or slot;
- invalid projection or unsupported value;
- serialization or size/depth failure;
- backend read/write/remove failure;
- parse/corrupt envelope failure;
- schema ID mismatch;
- unsupported future version;
- missing or throwing migration;
- final validation failure;
- disposed store.

V1 persistence is not secure storage. Documentation must prohibit auth tokens,
passwords, payment data, health data, and secrets in the normal adapter.

## Forward-compatibility constraints

V1 must preserve later storage capabilities without exposing false promises.

- Keep game projections separate from engine envelopes and backend keys.
- Keep adapters capability-neutral rather than pretending every backend is
  transactional.
- Keep per-slot operation ownership explicit for future recovery/journaling.
- Keep migrations independent from backend I/O.
- Keep checkpoint effects outside simulation.
- Do not publish checksum, journal, cloud, encryption, repair, or autosave
  placeholders.

## V1 implementation tasks

### T17.0 — Freeze workflows, adapter, and API

- [ ] Define one real settings schema and one versioned checkpoint projection.
- [ ] Preserve at least two historical migration fixtures.
- [ ] Evaluate current maintained RN/Expo storage adapters from official
      sources and record the selected optional peer/version.
- [ ] Write compile fixtures for schema, store, adapter, load results, errors,
      save/delete/flush, checkpoint effects, and cleanup.
- [ ] Freeze value grammar, size/depth bounds, key format, queue ordering,
      disposal, and migration error semantics.

### T17.1 — Implement schema and migrations

- [ ] Add focused schema, migration, value, and error modules.
- [ ] Validate IDs, versions, migration steps, and supported plain values.
- [ ] Clone/freeze defaults, migration results, and final data.
- [ ] Preserve stored bytes when migration or validation fails.
- [ ] Add missing-step and future-version behavior.

### T17.2 — Implement serialization and envelopes

- [ ] Implement bounded plain-data serialization and parsing.
- [ ] Add the v1 format/schema/version/time envelope.
- [ ] Reject malformed, oversized, deep, cyclic, and unsupported data with
      exact paths/codes.
- [ ] Keep user payloads out of default logs and diagnostics.
- [ ] Test caller mutation before and after save calls.

### T17.3 — Implement the async store and adapters

- [ ] Implement namespaced load/save/delete/flush/dispose.
- [ ] Serialize same-slot operations and prevent stale completion publication.
- [ ] Add in-memory and programmable failure adapters for tests.
- [ ] Implement the selected RN adapter behind `rn-gamekit/storage` with an
      optional peer and clear missing-peer error.
- [ ] Preserve backend causes and make disposal idempotent.

### T17.4 — Add checkpoint and reference integration

- [ ] Bind one Task 13 checkpoint event to an async save effect.
- [ ] Keep completion/failure outside deterministic simulation.
- [ ] Add settings plus checkpoint/resume to one reference game.
- [ ] Create the session only after validated load/default/migration result.
- [ ] Prove an old session/store cannot write after replacement.

### T17.5 — Document and verify v1

- [ ] Add Storage and persistence engine-system documentation.
- [ ] Add guides for settings, save slots, migrations, loading before session
      creation, reset, and failure UI.
- [ ] Document optional-peer installation, adapter guarantees, size bounds,
      privacy, and unsupported future capabilities.
- [ ] Explicitly warn against serializing sessions or renderer snapshots.
- [ ] Compile-check examples.
- [ ] Run focused schema, migration, serialization, queue, adapter, stale
      result, and disposal tests.
- [ ] Validate restart persistence on named devices when hardware is available
      and leave unavailable rows open.

## V1 definition of done

- [ ] Games own explicit versioned settings and save projections.
- [ ] No session, renderer, native object, or internal queue is serialized.
- [ ] Missing, invalid, migrated, corrupt, future, and backend states are
      explicit.
- [ ] Same-slot operation ordering prevents stale overwrite/publication.
- [ ] `flush()` and disposal have tested ownership semantics.
- [ ] The adapter boundary and durability claims are honest.
- [ ] Checkpoint effects never block or control simulation.
- [ ] One reference game loads before session creation and resumes saved data.
- [ ] `rn-gamekit/storage` remains a subpath of the single package.
- [ ] Focused automated gates pass and device evidence is honestly recorded.

## Future expansion backlog

These roadmap items remain preserved and non-blocking.

| ID | Future capability | Implementation trigger |
| --- | --- | --- |
| STORAGE-F1 | Dual-record journal, generations, checksums, and recovery | Real corruption/power-loss requirements exceed backend guarantees |
| STORAGE-F2 | Repair tooling and recovered-result UI | Journal recovery is implemented and needs user-facing control |
| STORAGE-F3 | Cloud saves and account sync | Identity, server, conflict, and privacy contracts are approved |
| STORAGE-F4 | Encryption and secure storage | A secrets/privacy workflow selects platform security backends |
| STORAGE-F5 | Autosave coalescing and rate policies | Several games repeat checkpoint scheduling logic |
| STORAGE-F6 | React loading/save hooks | Multiple apps repeat the same external-store ownership pattern |
| STORAGE-F7 | Database/query APIs | A game needs structured large-world data beyond slot values |
| STORAGE-F8 | Asset/DLC cache management | Downloaded content needs separate eviction and version semantics |
| STORAGE-F9 | Replay, rewind, or rollback archives | A deterministic replay/network milestone defines the format |
| STORAGE-F10 | Background task integration | A product accepts the platform constraints and failure model |

## Implementation order

Implement Task 17 in this order:

1. T17.0 real projections, adapter selection, and contract freeze.
2. T17.1 schemas and migrations.
3. T17.2 serialization and envelope.
4. T17.3 store and adapters.
5. T17.4 checkpoint/reference integration.
6. T17.5 docs and focused verification.

Do not serialize `GameSession` or renderer snapshots. Freeze the game-owned
projection, migration, and same-slot ordering contracts first.
