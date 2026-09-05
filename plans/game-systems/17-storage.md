# Save schemas, serialization, queues, and storage adapters

## Purpose and verdict

Persist small game-owned projections with explicit schema migration and per-slot ordering. **Keep the adapter seam, synchronous save snapshotting, immutable migration inputs, and accepted-work drain on disposal. Fix key isolation before any other storage change.**

Sources: [store](../../packages/gamekit/src/storage/store.ts), [schema](../../packages/gamekit/src/storage/schema.ts), [serialization](../../packages/gamekit/src/storage/serialization.ts), [key validation](../../packages/gamekit/src/storage/validation.ts), [adapters](../../packages/gamekit/src/storage/adapters/memory.ts), [types](../../packages/gamekit/src/storage/types.ts).

## GS-STORAGE-01 — P1: namespace/slot pairs collide on persistent keys

**Evidence: reproduced.** Namespace and slot both permit dots, but `storageKey` joins them with a dot. `('game.a', 'b')` and `('game', 'a.b')` both produce `rn-gamekit.storage.game.a.b`. Independent stores can load, overwrite, or delete each other's save. Their per-store queues do not protect this shared physical key.

**Resolve:** encode namespace and slot as an unambiguous tuple (length prefix or a separator/escaping scheme that cannot appear unescaped). Version the key format. Design migration from existing keys before changing writes: a legacy collision cannot be disambiguated automatically from the key alone. Avoid destructive blanket rewrites or deleting legacy records after an ambiguous read. Document recovery/compatibility policy for this preview release.

**Acceptance:** exhaustive/property tests over permitted separators and representative namespace/slot pairs show unique keys. Two stores sharing an adapter retain independent data and deletion. Legacy reads/migration preserve data and surface ambiguity honestly.

## GS-STORAGE-02 — P2: save validates/transforms the same value twice

**Evidence: reproduced.** `save` calls `validateCurrentData` synchronously to capture input. `saveInternal` calls it again after queueing. A validator returning `{n: input.n + 1}` stores `{n:2}` when saving `{n:0}`. Validators are typed as transformations returning TData; no contract requires idempotence. Each pass also clones/freezes data, and serialization validates/clones it again while discarding that clone.

**Resolve:** validate/normalize and take ownership once at acceptance, then serialize that immutable accepted snapshot in queue order. Delete the second domain validation. Remove redundant deep-freeze passes because `cloneAndValidatePlainData` already freezes outputs. Keep raw loaded bytes and every migration output bounded before trust; do not delete security-relevant validation just because some passes are redundant.

**Acceptance:** a normalizing validator runs exactly once per save acceptance; caller mutation after save cannot change queued bytes; adapter delay/failure does not re-run application normalization. Large accepted payload benchmarks report clone/validation count and wall time.

## GS-STORAGE-03 — P2: tighten validation without widening the data model

**Evidence: source-confirmed.** Like event payloads, storage validation can read an inherited `then` getter before rejecting the prototype. `validateMigrations` accepts noncanonical numeric keys such as `'01'` using `Number(rawKey)`, but migration lookup later uses `migrations[1]`, so an accepted migration is never found. UTF-8 byte length is implemented twice and falls back to `str.length * 2`, which is neither exact nor always conservative for UTF-8 limits.

**Resolve:** perform prototype/descriptor rejection without invoking inherited properties; remove redundant thenable probing. Require canonical migration keys or normalize them once with duplicate detection. Use one exact byte-length routine supported by the installed RN runtime, with a tested scalar fallback if necessary. Keep the JSON-only storage domain; do not add Maps, Date revival, or class serialization.

**Acceptance:** getters are not invoked; `'01'`/`'1e0'`/duplicate normalized migration keys are rejected or normalized consistently; UTF-8 ASCII, BMP characters, surrogate pairs, and unpaired surrogates are measured consistently with serialized bytes near the limit.

## GS-STORAGE-04 — P3: clarify flush and ownership boundaries

**Evidence: source-confirmed API ambiguity.** `flush()` awaits `Promise.allSettled`, so it reports completion even when writes fail. Per-slot serialization is per store instance, not global per adapter/key. `remove` and `delete` are public aliases. These choices are defensible but should not be mistaken for guaranteed durable success or cross-store locking.

**Resolve:** document flush as draining already accepted operations, with each operation's returned promise carrying success/failure, or explicitly change it to report failures with a migration plan. Keep one owner per logical store/namespace in examples. Prefer one delete verb for new code and deprecate an alias only if preview compatibility permits. Do not add global locks, automatic retries, autosave, or cloud sync.

**Acceptance:** a flush snapshots work accepted before the call, waits through failure, excludes later work, and matches the documented error policy. Disposal rejects new work while accepted work still resolves/rejects normally.

## Verification

Preserve [storage.test.ts](../../packages/gamekit/test/storage.test.ts), storage compile fixtures, Storage Lab integration tests, and reference-game hydration tests. Test native AsyncStorage on both platforms, including interrupted app lifecycle and same-namespace reuse. A resolved adapter promise is the library's persistence boundary; power-loss guarantees belong to the backend and must not be invented here.
