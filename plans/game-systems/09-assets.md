# Asset definitions, decoding, stores, and React loading

## Purpose and verdict

Turn static descriptors into complete borrowed image leases with explicit native ownership. **Keep manifest/loader/lease separation. Repair identity and cleanup before optimizing loading.** The strongest issues found in this review are here.

Sources: [definitions](../../packages/gamekit/src/assets/defineAssets.ts), [validation](../../packages/gamekit/src/assets/validation.ts), [store](../../packages/gamekit/src/react/assets/createGameAssetStore.ts), [hook](../../packages/gamekit/src/react/assets/useGameAssets.ts), [Expo/Skia pipelines](../../packages/gamekit/src/react/assets/decodeSkiaImage.ts).

## GS-ASSET-01 — P1: resource tokens are not idempotent and validation releases twice

**Evidence: reproduced.** `beginResourceRef` returns `release: () => dropResourceRef(uri)` with no released flag. `acquireOne` pushes the ref into `attempt.acquired` before validating sheet frame dimensions. If validation fails, its catch releases the ref, and `acquire`'s catch releases it again. With a good image lease and an invalid sheet sharing the same URI, the bad acquisition disposes the good lease's native image. The probe observed one native disposal before the good lease released and its next lookup returned no image.

**Resolve:** make each reference token release exactly once and bind it to the exact resource entry, not just a URI lookup. Give each acquisition stage one clear cleanup owner. Either transfer the token to the attempt only after successful validation or rely on a proven idempotent token without duplicate ownership ambiguity. Never return a ready loaded value with `image: undefined` or dimensions zero when its lease should be valid.

**Acceptance:** good and bad descriptors sharing a decode; multiple successful leases; failure after N assets; repeated cleanup; onProgress failure. Surviving leases retain their handle, and the handle disposes exactly once after the last real owner releases.

## GS-ASSET-02 — P1: late completion can delete a newer entry for the same URI

**Evidence: reproduced.** Start decode A, abort its only waiter, acquire the same URI again to start B, then resolve A before B. A's late-result branch calls `resources.delete(uri)` without verifying that the current entry is A. It deletes B. B's acquisition resolves, but the resulting lease lookup has no image. URI-based release can similarly affect the wrong generation.

**Resolve:** compare entry identity before deleting/replacing cache membership; tokens decrement their captured entry. An abandoned entry can dispose its own late handle without touching a successor. Check abort/disposed state after each awaited resolution/decode and before publishing the lease. Preserve cancellation listener cleanup and error attribution.

**Acceptance:** both A-before-B and B-before-A completion orders, abort during resolve, abort during shared decode, dispose during acquisition, and reacquire after failure. Every returned lease is complete; no successor cache entry is deleted by predecessor work.

## GS-ASSET-03 — P1: changing groups can violate React hook ordering

**Evidence: source-confirmed; execute mounted regression before fixing.** `useGameAssets` returns a loading value when a ready state's group key differs, **before its `useEffect` call**. On that render it calls fewer hooks than the previous render. Existing tests do not exercise a ready → different-groups update sufficiently to catch the hook-order failure.

**Resolve:** always execute all hooks, then select the externally visible state. Track request identity using manifest identity, normalized groups, factory identity where applicable, and retry attempt. The current key contains only groups, so a new manifest with identical group names can expose the previous manifest's ready lease until effects run. Clear stale ready/error/progress views consistently, without mutating refs as a substitute for ownership.

**Acceptance:** ready → different groups → ready, same group names with a different manifest, retry during pending acquisition, equivalent reordered groups, and Strict Mode. No stale/disposed lease is ever visible for a new request and no hook-order warning/error occurs.

## GS-ASSET-04 — P2: simplify lookup ownership and remove unused generation scaffolding

**Evidence: source-confirmed maintenance/performance cost.** Each `assets.get` scans loaded descriptors, then all resources and their accumulated logical-key sets, and allocates another wrapper. The attempt `token` is allocated but never used to reject stale work. A token counter and comments are not a generation guard. Definitions also freeze caller-owned frame/animation/group records in place.

**Resolve:** after the two ownership fixes, let a lease hold a direct descriptor→validated loaded-value table backed by captured resource tokens. Delete `Attempt.token`, `nextAttemptToken`, `logicalKeys`, and scans if the new table makes them unnecessary. Preserve descriptor-reference membership. Decide whether declaration helpers consume ownership or clone author records; document the choice and avoid surprising mutation of reusable author configuration. Do not add another global asset cache.

**Acceptance:** repeated lookup has stable valid resources, wrong descriptors/groups still fail, and definition helpers follow the documented ownership contract. Add the ready-request identity test before changing hook state.

## Performance and native acceptance

Acquisition is serial per logical asset, though shared decodes are deduplicated. Parallel decoding is not automatically better on mobile: measure load latency and peak memory before introducing bounded concurrency. Prefer eliminating repeated lookups and unnecessary retained metadata first. Test repeated enter/exit/retry cycles with real images, decoded memory plateau, and native disposal after the last renderer releases its lease. Preserve all existing asset-store, hook, manifest, and API fixtures.
