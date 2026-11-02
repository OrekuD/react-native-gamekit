# Assets and loading implementation review — 2026-11-01

This slice follows [system 09](09-assets.md) on main `15b42f5`, after Collision2D
PR #10 merged. Assets turns authored local-image declarations into borrowed
resources with explicit store and lease ownership. Keep that model and serial
loading; fix cancellation, cleanup, request identity, and declaration ownership.
The next core system is **10 — Sprite animation**.

## Confirmed remaining defects

The original brief's idempotent resource tokens, captured-entry release,
successor-cache protection, direct descriptor lookup, and unconditional hook
ordering were already implemented. This work completes their boundary cases.

| Trigger | Before | After |
| --- | --- | --- |
| A resolver aborts synchronously before returning its promise | The abort listener misses the event; decoding starts and acquisition can remain pending. | The race checks an already-aborted signal, and acquisition rechecks activity before decoding. |
| Disposal while resolving, or abort/disposal in the final progress callback | New decoding could start after disposal, or acquisition could publish an unusable lease. Empty selections also missed the callback race. | Check activity after awaited stages and callbacks and before publishing any lease. |
| A native release throws | Later references are not released, and a zero-reference cached entry can retain a handle whose disposal was attempted. | Unlink and clear ownership before calling native disposal; attempt all releases and retain compound failures. |
| Decoder reports zero/nonfinite dimensions | An invalid ready image can escape. | Validate positive finite dimensions once per decode and share the validated values. |
| Caller changes a cached loaded record | Later `get` calls return the modified values. | Loaded records are shallow-frozen; native handles remain borrowed and unfrozen. |
| Change groups from `['a', 'b']` to `['a\u0000b']` | Both requests have the same delimiter-based key; the old ready assets remain visible. | Serialize the normalized group array unambiguously. |
| Use initial loading `retry`, or a store factory/acquire method throws synchronously | Initial retry is inert; synchronous setup errors escape the hook's loading state machine. | The real stable retry exists on the first render; setup failures enter the structured error state. |
| Null/array definition records, malformed frame lists, inherited or nonenumerable frame references | Some inputs throw incidental TypeErrors or pass validation without an emitted frame. | Validate record/list shapes and require own enumerable frame membership. |
| Declare assets from raw structural descriptors or extension metadata | Caller-owned data can become frozen; mutable spec types still allow writes to frozen outputs. | Copy supported fields, freeze owned declarations, and expose readonly canonical types. |
| Expo module lookup or Skia byte loading throws | Some failures bypass structured error attribution; native messages can include local paths. | Wrap each pipeline stage with the correct asset error code, a safe summary, and the original cause. |

Store disposal rejects new acquisition/lookup. Already-owned lease references
remain alive until their owners release them. In-progress work checks disposal
when its asynchronous stage settles; an `AbortSignal` detaches its caller
immediately. Cancellation does not claim to stop an underlying native download
or decode. A late image is released without touching a successor entry.

Cleanup attempts all tokens. A single failure is rethrown; multiple failures use
`AggregateError`, retaining the acquisition failure first when relevant. Native
pipeline cleanup failures are preserved in `GameAssetError.cause`; encoded data
is released after image creation, and an unpublished image is released if that
data cleanup fails. A rejection already delivered to an aborted caller cannot
be retroactively replaced by a later native cleanup failure.

## API changes and migration

### Typed acquisition groups

```ts
const store = createGameAssetStore(gameAssets);
store.acquire({ groups: ['gameply'] });
// Before: accepted by TypeScript, failed at runtime.
// After: compile-time error; the manifest declares 'gameplay'.

const options: AcquireOptions<'boot' | 'gameplay'> = { groups: ['boot'] };
const typedStore: GameAssetStore<typeof gameAssets> = createGameAssetStore(gameAssets);
```

`AcquireOptions` defaults to `string` for generic adapters. `GameAssetStore`
accepts the manifest type parameter too; migrate explicitly annotated concrete
stores to `GameAssetStore<typeof gameAssets>` so their group restrictions are
retained. Its default remains the broad `AssetGroupMap` type. The store and hook infer
the manifest's actual group names, including numeric object keys represented as
strings at runtime. Runtime `ASSET_UNKNOWN_GROUP` checks remain necessary for
JavaScript callers. Numeric group typing was found during independent review
and gets a compile fixture alongside typo rejection.

### Authored data and descriptor identity

```ts
const raw = { kind: 'image' as const, source: 1 };
const assets = defineAssets({ boot: { logo: raw } });
// Before: raw becomes frozen.
// After: raw remains author-owned; assets.boot.logo is its frozen copy.
loaded.get(assets.boot.logo);
```

Descriptors returned by `image` and `spriteSheet` keep their identity through
`defineAssets`, preserving existing reference membership and deliberate reuse
across manifests. Structural descriptors are copied once per manifest, preserving
aliases within it. Retrieve them through the returned manifest. Reusing the raw
author object itself for lookup is no longer supported after its declaration is
copied.

Only supported descriptor, frame, and clip fields are copied. Extra metadata
stays with author configuration and is absent from both returned values and their
types. Mapped readonly fields preserve group/frame/clip names and supported literal
values; an author variable's mutable type can no longer allow writes such as
`sheet.frames.idle.x = 2` or `sheet.animations.idle.frames.push('idle')`.
This is a deliberate API tightening. Keep game metadata in a separate record
and construct a new declaration when authored geometry changes.

### Request keys and errors

`stableGroupsKey` still deduplicates and sorts selections; its string encoding
changes to serialized arrays. Treat it and hook `requestKey` as opaque comparison
keys, never a persisted or parsed format. Reordered equivalent selections still
reuse the request; manifest/factory identity and retry still distinguish requests.

`GameAssetError` now copies/freezes its path and accepts optional standard error
options: `new GameAssetError(code, path, message, { cause })`. Manifest validation
includes group/asset prefixes. Default native-pipeline summary messages omit
local paths while causes preserve the original diagnostics. Human-readable
message text is not a parsing contract.

The existing store/lease split remains useful. A callback-based helper that
automatically owns a store and lease could simplify short imperative loading
tasks, but would need an explicit rule preventing borrowed images from escaping
the callback. No current consumer needs that extra API; the guide instead shows
nested `try/finally` so the store is disposed even if acquisition or lease release
fails.

## Performance and runtime ownership

The store used to scan every logical asset for each selected group. It now builds
a private group index once, then visits only the selected groups' descriptors.
For 20 selected groups in a 20,000-asset fixture this reduces planning inspections
from 400,000 to 400. Input group order, descriptor order, deduplication, progress,
and unknown-group rejection before I/O are covered by regressions.

Decoded dimensions now cross the native handle interface once per decode instead
of once per descriptor/lease. Lookup already used a direct descriptor table on
main; this PR does not claim to introduce that earlier improvement. Explicit
schema copying also replaces generic deep-freeze traversal for declarations,
avoiding traversal or freezing of arbitrary author extension graphs.

`pnpm --filter rn-gamekit bench:assets` measures the actual store with immediate
fake pipelines. `--module /absolute/path/to/baseline-store.ts` selects a saved
baseline with resolvable imports. It exercises small and large manifests, reused
stores with a held lease, and complete construction/acquisition/disposal. Counts
check resource ownership and native-method calls independently of timing.

The final baseline (`15b42f5`) and current modules ran with the same fixtures on
Node 24.19.0, macOS arm64: 10 warmup acquisitions and 30 batched samples per mode.
Each sample averages 50 acquisitions for the small fixture, 20 for the two
2,000-asset fixtures, and five for the largest fixture. The p95 is therefore a
percentile of batch averages, not individual request tail latency. Times below
are microseconds:

| Manifest / selected assets | Cached before median / p95 | Cached after median / p95 | Cold before median / p95 | Cold after median / p95 |
| --- | ---: | ---: | ---: | ---: |
| 14 / 14 | 10.184 / 27.777 | 8.688 / 14.543 | 22.922 / 43.854 | 21.863 / 24.950 |
| 2,000 / 20 | 23.981 / 38.508 | 12.254 / 19.650 | 106.292 / 144.633 | 97.492 / 116.748 |
| 2,000 / 100 | 87.756 / 96.269 | 54.935 / 62.421 | 221.133 / 232.015 | 193.750 / 200.721 |
| 20,000 / 400 | 1,756.550 / 1,905.783 | 232.158 / 453.442 | 2,965.267 / 3,280.042 | 1,223.708 / 1,505.392 |

Cached acquisition holds another lease throughout, so it reuses decoded handles.
The recorded width/height reads per cached acquisition each drop from the number
of selected descriptors to zero; cold acquisitions read each dimension once per
decode. Ownership assertions check decode/disposal/progress counts, usable leases,
and final resource release. Heap deltas are GC-noisy observations, not allocation
counts. These measurements include all store fixes together. An earlier isolated
index experiment showed roughly neutral results for the reference-sized manifest
and a cold-construction regression for one small selection; the main benefit is
eliminating repeated full-manifest scans as manifests and selections grow.

The RN runtime owns stores, promises, leases, and React loading state. Renderers
borrow decoded handles; these changes add no per-frame React state, worklet
ownership, worker runtime, or global cache. No change is made to decoding
concurrency. Native load latency, memory plateau, or device FPS cannot be inferred
from a Node benchmark or mocked Skia handle.

## Validation

Focused regression suites and compile fixtures were written before implementation
and reproduced the failures above. The optimization's ordering, empty-group,
deduplication, and prototype-name cases passed before and after the refactor.

- `pnpm check` passed: workspace lint/typechecks, **1,306 library tests**, **309
  playground tests** (254 headless and 55 mounted), library/docs builds, and
  the iOS Hermes export. Dependency tooling adds 61 passing tests.
- Built public API fixtures passed. They cover readonly declaration results,
  supported literal inference, omitted metadata, unknown groups, numeric group
  names, named generic stores, and existing manifest branding behavior.
- The expanded coverage gate includes asset errors and native pipeline wiring.
  The six changed asset runtime modules have **96.3–98.9% lines**, **88.5–95.4%
  branches**, and **87.5–100% functions**. The gate enforces 80% lines for its
  listed modules; branch/function figures are reported separately.
- Independent review reproduced the numeric-group and named-store annotation
  gaps, then verified both fixes. It independently passed all 148 asset/hook
  tests and reported no remaining correctness, security, or API blocker.
- Registry audit reports **65 advisories** (6 critical, 40 high, 14 moderate,
  5 low) on the unchanged dependency graph. This is the current registry count,
  not the earlier 52-advisory snapshot. No dependency versions or lock entries
  changed. Installed compatibility validation passes for RN 0.86.3, Expo
  57.0.25, Skia 2.11.0, Reanimated 4.5.3, Worklets 0.10.3, and RNGH 3.1.0.

The combined run initially found one type-only import lint issue in the new
pipeline test; it was corrected before the passing full run. No workflow or
dependency policy changes were needed.

Native acceptance remains: in a release or `debugOptimized` build, repeat enter,
exit, group replacement, retry, and cancellation with real shared images. Check
that active renderers retain valid images, native handles release after their last
lease, decoded memory reaches a plateau, and load transitions preserve frame
pacing on representative 60 Hz Android and 120 Hz iOS devices. Those measurements
have not been performed in this workspace review.
