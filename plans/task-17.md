# Task 17: Versioned storage and persistence

## Status

**Final verification T17-VF1 resolved.** The published request state now stores
the two actual identity fields (`adapter`, `createSession`) and compares them
directly — correctness no longer depends on `useMemo` retaining a wrapper
object (the memo import is gone). Same-props rerenders fail both comparisons
and leave published ready state untouched; the duplicated `hudLastRef`
assignment in the load effect was removed. The mounted VF1 test proves
unrelated same-props rerenders and Strict Mode double-invocation never reset
the ready screen, never start an extra request, and keep created/disposed
session counts balanced (at most one live session).

V1 is complete: versioned `rn-gamekit/storage` with envelope, migrations, per-slot queue, flush/dispose, explicit errors, adapter boundary, checkpoint effect, and reference game (Storage Lab). Future expansion backlog remains documented and non-blocking.

Implementation commit: this commit (see `packages/gamekit/src/storage/*`, `apps/playground/src/screens/storage-lab`, docs `engine-systems/storage` + `guides/save-and-load`).

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

- [x] Define one real settings schema and one versioned checkpoint projection.
- [x] Preserve at least two historical migration fixtures.
- [x] Evaluate current maintained RN/Expo storage adapters from official
      sources and record the selected optional peer/version.
- [x] Write compile fixtures for schema, store, adapter, load results, errors,
      save/delete/flush, checkpoint effects, and cleanup.
- [x] Freeze value grammar, size/depth bounds, key format, queue ordering,
      disposal, and migration error semantics.

### T17.1 — Implement schema and migrations

- [x] Add focused schema, migration, value, and error modules.
- [x] Validate IDs, versions, migration steps, and supported plain values.
- [x] Clone/freeze defaults, migration results, and final data.
- [x] Preserve stored bytes when migration or validation fails.
- [x] Add missing-step and future-version behavior.

### T17.2 — Implement serialization and envelopes

- [x] Implement bounded plain-data serialization and parsing.
- [x] Add the v1 format/schema/version/time envelope.
- [x] Reject malformed, oversized, deep, cyclic, and unsupported data with
      exact paths/codes.
- [x] Keep user payloads out of default logs and diagnostics.
- [x] Test caller mutation before and after save calls.

### T17.3 — Implement the async store and adapters

- [x] Implement namespaced load/save/delete/flush/dispose.
- [x] Serialize same-slot operations and prevent stale completion publication.
- [x] Add in-memory and programmable failure adapters for tests.
- [x] Implement the selected RN adapter behind `rn-gamekit/storage` with an
      optional peer and clear missing-peer error.
- [x] Preserve backend causes and make disposal idempotent.

### T17.4 — Add checkpoint and reference integration

- [x] Bind one Task 13 checkpoint event to an async save effect.
- [x] Keep completion/failure outside deterministic simulation.
- [x] Add settings plus checkpoint/resume to one reference game.
- [x] Create the session only after validated load/default/migration result.
- [x] Prove an old session/store cannot write after replacement.

### T17.5 — Document and verify v1

- [x] Add Storage and persistence engine-system documentation.
- [x] Add guides for settings, save slots, migrations, loading before session
      creation, reset, and failure UI.
- [x] Document optional-peer installation, adapter guarantees, size bounds,
      privacy, and unsupported future capabilities.
- [x] Explicitly warn against serializing sessions or renderer snapshots.
- [x] Compile-check examples.
- [x] Run focused schema, migration, serialization, queue, adapter, stale
      result, and disposal tests.
- [x] Validate restart persistence on named devices when hardware is available
      and leave unavailable rows open.

## V1 definition of done

- [x] Games own explicit versioned settings and save projections.
- [x] No session, renderer, native object, or internal queue is serialized.
- [x] Missing, invalid, migrated, corrupt, future, and backend states are
      explicit.
- [x] Same-slot operation ordering prevents stale overwrite/publication.
- [x] `flush()` and disposal have tested ownership semantics.
- [x] The adapter boundary and durability claims are honest.
- [x] Checkpoint effects never block or control simulation.
- [x] One reference game loads before session creation and resumes saved data.
- [x] `rn-gamekit/storage` remains a subpath of the single package.
- [x] Focused automated gates pass and device evidence is honestly recorded.

## Review feedback

This isolated review covers only the Task 17 implementation in `051052a`. Keep
the package boundary, schema API, per-slot ordering, optional adapter loading,
and documentation work. Address the four correctness gaps below without
expanding the v1 feature set.

### T17-F1 — `dispose()` cancels operations that were already accepted (High)

`enqueue()` captures the store generation and checks it only after the previous
slot tail resolves. `dispose()` increments that generation immediately. Because
even the first operation starts through a Promise continuation, calling
`save()` and then `dispose()` in the same synchronous turn can reject the save
before it reaches the adapter. A second save already queued behind a slow first
save is also rejected after disposal.

That contradicts the frozen policy: disposal rejects new work, while operations
accepted before disposal complete. The current test disposes only after the
adapter write has already started, so it does not exercise the broken path.

Required approach:

- Remove disposal-generation rejection from operations already accepted by
  `enqueue()`. The acceptance boundary is the successful public method call,
  not the moment the adapter begins I/O.
- Keep the synchronous `disposed` check at the public boundary so operations
  requested after disposal reject immediately.
- Do not use store generation to suppress Promise results. A consuming React
  owner must ignore stale completions using its own request/session identity;
  the store has no publication channel to suppress.
- Retain queue/tail ownership until every accepted operation settles. Clean a
  slot's resolved tail only when it is still the current tail.
- Add a RED test for `const pending = store.save(...); store.dispose();` with no
  microtask yield; the accepted save must reach the adapter and settle.
- Add a second RED test with two same-slot saves, disposal while the first is
  blocked, then release the first. Both accepted saves must complete in order,
  while a third save requested after disposal must reject with `DISPOSED`.
- Cover accepted load and remove operations according to the same documented
  policy, or narrow and document the policy explicitly before implementation.

### T17-F2 — Concurrent `flush()` calls can hang and its boundary is not frozen (High)

The store keeps only one `pendingResolve`. A second `flush()` overwrites the
first resolver, so when pending work reaches zero only the newest flush is
resolved and the earlier Promise can remain pending forever.

`flush()` also waits on the global `pendingCount`. Work accepted after a flush
call extends that count, even though the public contract says a flush waits only
for operations accepted before that call. The existing test covers one flush
with one already-running save and misses both failures.

Required approach:

- Give every `flush()` its own immutable acceptance boundary. The simplest v1
  implementation may snapshot the currently tracked operation Promises and
  await that snapshot with `Promise.allSettled()`.
- Do not let operations accepted after the call delay that flush.
- Define and test whether `flush()` only waits or also reports operation
  failures. Preserve that policy consistently without leaving any waiter
  unresolved.
- Remove the single global resolver/pending-count mechanism once snapshot
  ownership exists; do not repair it with another shared mutable resolver.
- Add concurrent-flush coverage: two flush calls made while one write is
  blocked must both resolve after that accepted write settles.
- Add a boundary test where flush A is called, then a later blocked save is
  accepted. Flush A must resolve after its original snapshot while a later
  flush B still waits for the second save.
- Add rejection and disposal cases proving no flush Promise hangs.

### T17-F3 — Untrusted stored bytes reach migrations before bounded validation (High)

`parseEnvelope()` calls `JSON.parse()` before checking raw byte size and only
validates a few envelope fields. It does not apply the depth, node, array,
field, string, unsafe-key, or plain-data limits to the loaded payload.
`loadInternal()` then passes that payload directly into game-authored migration
functions. Final plain-data validation happens only after every migration has
run.

As a result, a corrupted or hostile adapter record can make the engine parse
and migrate data far beyond the published limits. Migration inputs are also
mutable, so the claimed pure-migration contract is not enforced. The test named
"parse rejects ... oversized envelopes" never supplies an oversized envelope,
and the purity test merely uses migrations that choose not to mutate.

Required approach:

- Measure the raw UTF-8 byte length before `JSON.parse()` and reject oversized
  records with a structured `SIZE_EXCEEDED` load error.
- After parsing and shape-checking the envelope, run the payload through the
  bounded plain-data clone before any schema migration or validator sees it.
- Give each migration a deeply frozen, engine-owned input. Bounded-clone and
  freeze every migration output before passing it to the next step.
- Reject oversized/deep/unsupported intermediate migration output at the
  migration step with its exact path and preserve the original cause.
- Ensure migration and parse errors leaving `load()` include `operation`,
  namespace, slot, schema ID/version, and relevant path instead of returning
  context-free errors from `migratePayload()`.
- Add RED tests for an oversized raw record, excessive parsed depth/nodes, an
  unsafe key, a migration that mutates its input, and a migration that returns
  an oversized intermediate value. Assert the adapter bytes remain unchanged.

### T17-F4 — Storage Lab does not demonstrate persistence or prove its integration (Important)

`StorageLabScreen` creates a new `createMemoryStorageAdapter()` for each screen
lifetime. Closing and reopening the game therefore loses settings and
checkpoints, so the reference cannot demonstrate the documented resume flow or
the selected AsyncStorage adapter. There are also no Storage Lab tests: the
suite contains no mounted load-before-session, checkpoint-save, reopen/resume,
or stale-completion coverage.

The screen additionally stores its subscription by mutating the `GameSession`
with `__storageSub`, calls `setSession()` from unmount cleanup, leaves the
Move-right timeout uncancelled, and publishes HUD React state every animation
frame. Those patterns should not become the reference architecture users copy.

Required approach:

- Make the runnable playground path use `createGameStorageAdapter()` so a
  checkpoint and settings change survive closing/reopening the screen and an
  app restart. Declare the native adapter directly where the playground build
  requires it; do not rely accidentally on workspace hoisting.
- Keep an injectable adapter seam for mounted tests. Reuse one injected memory
  adapter across two screen lifetimes to prove load-before-session and actual
  checkpoint resume without needing native hardware.
- Store the event subscription in an owner ref/local cleanup closure rather
  than adding private fields to `GameSession`.
- Do not call React state setters from unmount cleanup. Cancel owned timers and
  ignore stale async completions with an explicit request/cancel token.
- Publish HUD state from the existing committed-frame/listener boundary at a
  bounded diagnostic cadence rather than calling `setHud()` every RAF frame.
- Add focused integration tests for initial default load, session creation
  only after load, checkpoint event to save/flush, close during an in-flight
  save, reopen/resume with the same adapter, settings persistence, and failure
  UI. Prove the old screen/session cannot publish after replacement.
- Update docs and completion checkboxes only after the reference uses durable
  storage and the named integration tests exist. Keep physical restart rows
  open until they run on actual devices.

## Follow-up review feedback

This isolated review covers only `fa0de05`. The queue, flush snapshot, raw-byte
limit, and bounded migration implementation changes address the original core
defects. Keep those changes and close the following evidence and reference
lifecycle gaps.

### T17-RF1 — The claimed F1–F3 RED tests were not committed (Important)

`fa0de05` changes `store.ts` and `schema.ts`, but it does not change
`packages/gamekit/test/storage.test.ts`. The existing disposal test still waits
until the adapter write has started before disposal, the existing flush test
uses only one flush and one operation, and the existing serialization tests do
not load an oversized raw record or exercise a mutating/oversized migration.

The implementations look consistent with the intended fixes, but the exact
regressions remain unguarded despite the execution summary claiming new RED
coverage.

Required approach:

- Add the immediate-disposal test with no microtask yield between accepted
  `save()` and `dispose()`.
- Add two queued same-slot operations, dispose while the first is blocked, and
  prove both complete in order while later work rejects.
- Add two simultaneous `flush()` calls over one blocked operation and prove
  both resolve.
- Add the flush-watermark test: call flush A, accept a later blocked operation,
  prove A resolves independently, and prove flush B waits for the later work.
- Add failed-operation and post-disposal flush cases that prove no flush hangs.
- Add load tests for oversized raw UTF-8 bytes, excessive depth/nodes, unsafe
  keys, a mutation-attempting migration, and an oversized intermediate
  migration output. Assert full error context and unchanged adapter bytes.
- Verify each test fails against `051052a` before accepting the new baseline.

### T17-RF2 — Replacing the injected adapter leaks the old session (High)

The loading effect depends on `injectedAdapter`, but its cleanup disposes only
the stores and subscription. Session disposal lives in a separate
empty-dependency unmount effect. If the adapter prop changes while the screen
remains mounted, the old session is paused later by the HUD effect but is never
disposed. Its scene/resources survive until final screen unmount, while the
new adapter creates another session.

There is also a creation-to-effect window: `setSession(nextSession)` runs
before the later `sessionRef` effect copies it. If the component unmounts before
that effect commits, the newly created session is not owned by either cleanup.

Required approach:

- Give each loading-effect request a local `ownedSession` variable/ref. Assign
  it immediately when the session is created, before publishing React state.
- Dispose that exact owned session in the same effect's cleanup for adapter
  replacement and final unmount. Keep disposal idempotent.
- Remove the split empty-dependency `sessionRef` cleanup once one request owns
  its stores, subscription, timers, and session together.
- Invalidate the request before removing subscriptions/disposing resources so
  in-flight save/status completions cannot publish into the replacement.
- Guard settings, manual-save, reset, and checkpoint status publications after
  every await with the same active request token.
- If a movement timer is cancelled, release the held input before disposing or
  replacing its session.
- Add a mounted rerender test that swaps adapter A to adapter B without
  unmounting. Assert A's session/subscription/stores dispose exactly once, no A
  completion publishes, and only B remains active.
- Add an unmount immediately after load resolution but before passive effects
  settle; the created session must still dispose exactly once.

### T17-RF3 — The “integration” test bypasses StorageLabScreen and its checkpoint event (Important)

`storageLab.integration.test.tsx` does not import or mount
`StorageLabScreen`. It recreates stores and sessions manually, registers a
checkpoint listener that never receives an event, then directly saves a
synthetic checkpoint snapshot inside a loop. Its failure-UI case asserts only
a store rejection, and its stale-screen case asserts only that a disposed store
rejects new work.

Consequently it does not prove load-before-session rendering, the actual event
effect, screen cleanup/request tokens, settings button persistence, failure UI,
or close/reopen behavior of the shipped reference component.

Required approach:

- Mount the real `StorageLabScreen` with an injected adapter and an injectable
  deterministic session/driver seam. Do not reproduce the screen workflow in
  the test.
- Hold the initial adapter reads and assert no gameplay session/content exists
  before both validated loads complete.
- Drive the real scene across a checkpoint with `ManualFrameDriver`; assert the
  actual `checkpoint` listener writes and flushes the projected save. Do not
  call `save()` directly from the test to simulate the effect under test.
- Unmount or replace the screen while a write is blocked, release it, and prove
  no stale status/HUD update is published.
- Remount with the same adapter and prove the rendered session resumes the
  saved checkpoint and settings.
- Mount corrupt/future data and assert the real error UI while stored bytes
  remain unchanged.
- Remove unused fake-driver variables and comments that describe direct saves
  as event integration.

### T17-RF4 — Playground does not directly declare AsyncStorage (Important)

The production Storage Lab now dynamically requests
`@react-native-async-storage/async-storage`, but `fa0de05` does not change
`apps/playground/package.json`. The dependency exists only as Gamekit's
optional peer/development dependency in the workspace. That relies on
workspace resolution/hoisting for a native module the playground directly
uses and does not satisfy the documented ownership rule.

Required approach:

- Add the validated AsyncStorage version as a direct playground dependency
  using the Expo-compatible installation path.
- Keep it an optional peer of the published `rn-gamekit` package; do not make
  importing unrelated Gamekit entry points load the backend.
- Regenerate the native project only if the repository's normal prebuild
  workflow requires it; do not add unrelated native diffs.
- Add a focused dependency/config assertion or Expo resolution check proving
  the playground owns and can autolink the backend without relying on another
  workspace package's development dependencies.

## Second follow-up review feedback

This isolated review covers `eefe5e4` and `9a2e3c2`. T17-RF1–RF4 are materially
addressed: the regression tests are committed, each load request owns and disposes
its exact session, the integration suite mounts the real screen, and the playground
declares AsyncStorage directly. Keep those changes and address only the two
remaining reference-screen defects below.

### T17-SF1 — Screen actions bypass the request-owned queues (High)

`mutateSettings()`, `triggerManualSave()`, and `resetSave()` each create a new
adapter/store instead of using the stores owned by the active load request. The
checkpoint listener therefore writes through one `saveStore`, while Save now and
Reset write through unrelated stores. Their per-slot queues cannot coordinate, so
an older slow checkpoint/manual write can complete after a newer reset or save and
overwrite it. Rapid settings presses have the same ordering defect. A failed
temporary save/flush/remove also skips `tempStore.dispose()`.

Required approach:

- Store one active request owner in a ref containing its request ID, settings
  store, save store, and session. Publish it only after creation and clear it only
  if cleanup still owns that exact request.
- Route checkpoint, settings, manual-save, and reset operations through those same
  request-owned stores. Do not create adapters or temporary stores from button
  handlers.
- Capture the owner/request ID at action acceptance and guard React publications
  after every await. Let accepted work finish under the store's existing dispose
  contract, while replacement cleanup prevents stale UI publication.
- Remove the workaround comments in `mutateSettings()`; they currently describe a
  known non-reference implementation.
- Add mounted tests that use the real buttons: block a checkpoint write, then
  accept Reset/Save now and prove final bytes follow acceptance order; rapidly
  change volume and prove the latest accepted value wins. Include a rejected
  operation and prove cleanup/next actions do not hang.

### T17-SF2 — Request replacement keeps the disposed old UI interactive (High)

When `adapter` or `createSession` changes, the old request cleanup disposes its
session, but the component retains `loadState === 'ready'`, the old `session`, HUD,
and status until the new asynchronous loads finish. During that interval the old
controls remain visible and can dispatch into a disposed session. `hudLastRef` also
retains the old session's tick/cadence record, which can suppress publication from
the replacement session. The current adapter-swap test lets B load immediately, so
it does not exercise this interval or prove the summary's exact-disposal claim.

Required approach:

- At the start of every new request, transition the screen to a blocking loading
  state and clear the published session, HUD, error, and old status before the
  replacement can be interacted with. Reset `hudLastRef` for that generation.
- Keep the exact request-owned cleanup already implemented; do not dispose the old
  session from React state or allow a stale request to clear the new owner.
- Add a mounted A→B replacement test with B's reads deliberately blocked. While
  blocked, assert loading UI is shown, no gameplay controls are mounted, and no
  input can reach disposed A. After release, assert only B is rendered.
- Instrument the injected session seam and subscriptions so the test asserts A and
  B are each disposed/removed exactly once. Also drive a settings button through
  the real screen rather than pre-seeding storage and calling that action covered.

## Third follow-up review feedback

This isolated review covers `04ede7f`. The shared owner/queue implementation and
its real-button tests resolve T17-SF1. The replacement cleanup also owns the exact
session and resets the HUD generation correctly. Keep those changes and fix the
remaining timing boundary below.

### T17-TF1 — Passive-effect state reset does not block the replacement commit (High)

`StorageLabScreen` still renders from the old `loadState` and `session` when new
`adapter`/`createSession` props arrive. The calls that clear them are inside
`useEffect`, which runs after that render commits and may run after paint. Calling
the setters at the top of the effect is synchronous *within the passive effect*,
not synchronous with the prop replacement. The `act()`-wrapped test flushes effects
before inspecting the tree, so it cannot detect this gap. The old controls can
therefore remain visible for one committed frame and route an interaction to the
request being replaced.

Required approach:

- Make replacement gating part of the render/commit boundary rather than a passive
  effect. Prefer storing the exact adapter/session-factory identity alongside the
  published ready/error state and render loading whenever it does not match the
  current props. An equivalent request-keyed child boundary or a layout-effect
  transition that is proven to finish before paint is acceptable.
- Publish the replacement's identity and ready session atomically; do not briefly
  pair B's identity with A's session or clear a newer request from stale cleanup.
- Keep the current request-owned store/session teardown and action routing. Remove
  the five `react-hooks/set-state-in-effect` suppressions once passive-effect state
  clearing is no longer used as the interaction boundary.
- Add a replacement test that observes the first render/commit after changing A to
  blocked B *before passive effects are flushed*. Assert that it already contains
  only loading UI and no controls. Then flush effects, release B, and retain the
  existing exact-once disposal/subscription assertions.

## Final verification feedback

This isolated review covers `e53c669`. The render-phase reset and Text render log
correctly resolve T17-TF1. Keep that behavior and remove the remaining reliance on
memo-cache identity.

### T17-VF1 — Request correctness depends on `useMemo` retaining an object (Important)

`requestKey` is a newly allocated object whose stability comes only from
`useMemo`, and `publishedKey !== requestKey` is treated as a semantic request
change. React may discard memoized values; `useMemo` is an optimization, not an
identity guarantee. If that happens with unchanged props, the render-phase branch
clears the ready session and changes `publishedKey`, but the load effect does not
rerun because its actual dependencies did not change. The screen can then remain
stuck in loading with its still-owned session hidden.

Required approach:

- Store the two actual identity fields in published state and compare
  `published.adapter !== injectedAdapter` or
  `published.createSession !== injectedCreateSession` directly. Do not derive a
  correctness key from a memoized wrapper object.
- Keep the render-phase replacement reset and atomic ready-session publication;
  only the identity comparison needs to change.
- Remove the now-unnecessary `useMemo` import and the duplicated consecutive
  `hudLastRef.current = { at: -Infinity, record: null }` assignment in the load
  effect.
- Retain the current A→B RED test and add an unrelated same-props rerender/Strict
  Mode case proving it neither resets the ready screen nor starts/disposes another
  request. A small pure identity-comparison test is acceptable additional evidence,
  but should not replace the mounted lifecycle assertion.

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
