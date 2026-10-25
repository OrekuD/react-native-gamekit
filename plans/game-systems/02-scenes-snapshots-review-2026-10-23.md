# Scenes and snapshots implementation review

Reviewed 2026-10-23 against `aa773c2` on `fix/core-scenes-snapshots-review`.
This PR is based directly on `main`; it does not require the separate session
or dependency-management PRs. It changes scene ownership and snapshot
publication, with no dependency or GitHub Actions changes.

## Existing findings verified

The original [system 02 brief](02-scenes-and-snapshots.md) remains the historical
audit. Its double-disposal guard, non-resumable faulted-scene policy, initial
snapshot/cleanup error aggregation, and basic snapshot-domain validation were
already implemented on this baseline. Existing regression tests continue to
cover those contracts. This review found the remaining cases below.

## Bugs fixed

| Finding | Before | After / regression evidence |
| --- | --- | --- |
| P1: terminal disposal during a transition | Calling `session.dispose()` from target creation, snapshot preparation, or outgoing cleanup could still install the target afterward, leaving its resources without an owner. | Check terminal status after each user-code boundary; release the target once and abort installation, frame publication, and staged event delivery. Tests exercise idle, paused, running, update-requested, and pause-flushed transitions, including state/snapshot freezing. |
| P1: failed cyclic snapshot poisons trusted cache | A completed child entered the cache before the root finished; a back-reference could lead from that trusted child to a mutable, invalid root. | Promote visited nodes only after the entire traversal succeeds. Retry from either end of the failed cycle revalidates it, including after `Object.freeze` throws. |
| P2: target preparation hides cleanup failure | If target snapshot extraction and target disposal both threw, only the first failure survived. | Preserve both arbitrary thrown values in original-then-cleanup order using the existing `AggregateError` policy. No cleanup retry. |
| P2: ownership starts too late | A returned state whose shallow freeze throws was never disposed, both on initialization and on transition. | Acquire ownership immediately when `create` returns; cleanup also covers freeze failures. A `create` that throws still owns its own partial work. |
| P2: nested transition replaces an unfinished transaction | External `setScene`/`restartScene` from transition callbacks could enter a second transition against the old active scene. | Reject these calls with `GameSessionLifecycleError` until preparation/disposal completes. Commit observers can still request another transition after installation. |
| P2: array traversal skips owned data | Whitespace property names and `1e2` after 100 dense elements could pass an invalid fast discriminator and escape validation/freezing. | Walk each own key once, including non-enumerable and symbol keys; preserve canonical index paths in errors. |
| P2: sparse holes read unrelated prototype data | Iterating every index read inherited numeric getters and froze inherited objects. Work also scaled with array length in JavaScript. | Visit owned values only; holes remain holes. A million-slot sparse array performs only a handful of property reads in the regression test. |
| P2: accessors defeat immutable snapshots | A frozen getter could return a fresh mutable object every time; a setter could still mutate external state. | Reject own getter/setter descriptors before invoking them, with scene/path diagnostics. Project computed values into data properties. |

Freezing still happens in place. Validation failure may leave visited children
frozen; it does not publish a partial frame or make the failed graph trusted.
This remains a data boundary, not a serializer, clone, or sandbox for arbitrary
behavior-changing proxies.

## API changes included

### Catch the documented error through the supported entrypoint

Before, `SnapshotDomainError` was documented but absent from the root export.
Consumers had to inspect the error name or reach through an unsupported private
path. After:

```ts
import { SnapshotDomainError } from 'rn-gamekit';

try {
  session.restartScene();
} catch (error) {
  if (error instanceof SnapshotDomainError) {
    console.error(error.scene, error.path);
  }
  throw error;
}
```

This is an additive export of the same runtime class, verified through the
public testing entrypoint.

### Preserve snapshot tuple information

For `snapshot: () => [10, { label: 'player' }] as const`, the former array
branch of `DeepReadonly` widened positions to a union and length to `number`.
The new type preserves tuple positions, length, optional/rest elements, and
deeply readonly array metadata. Before, using the first entry required
narrowing or a cast; after:

```ts
const x: number = frame.current[0];
const label: string = frame.current[1].label;
const length: 2 = frame.current.length;
```

Compile fixtures check public declarations as well as rejected mutations.
Runtime representation and frame identity do not change.

### Explicit data properties at publication

Before, `snapshot: ({ state }) => ({ get player() { return { x: state.x }; } })`
was accidentally accepted without securing future reads. After, it throws
`SnapshotDomainError`; write
`snapshot: ({ state }) => ({ player: { x: state.x } })` instead.

This is an intentional compatibility tightening. It establishes a stable,
immutable value per snapshot and avoids hidden execution during validation.
External transition reentry from lifecycle callbacks is also newly rejected;
use the update-scoped controller or request the next transition after the
current operation returns.

## API proposals kept separate

| Proposal | Before → proposed after | Benefit and migration cost |
| --- | --- | --- |
| Deeply readonly scene state views | `state: Readonly<TState>` → `state: DeepReadonly<TState>` for update/snapshot consumers. | Catch nested mutations even when a field is omitted from snapshots. This is source-breaking and needs reference-game migration; it should not add whole-state cloning or freezing per tick. |
| Typed transition payloads | Cross-scene results require closure coupling or keeping multiple phases inside one scene → a declared target payload passed by `transition.setScene('results', { score })` and received by target creation. | Fill the cross-scene data gap. Design payload validation/ownership, initial creation, restart behavior, and type inference together before adding the API. No payload method is documented as available. |
| Tick context on snapshot errors | Error exposes scene/path although the internal freeze context already accepts a tick → expose attempted tick/scene tick with clear semantics. | Faster diagnosis of failed updates. Define initialization/transition tick semantics before promising a new public field. |

## Performance evidence

The benchmark now prebuilds independent graphs outside timing, warms up five
batches, and reports the median of nine batches. It compares the actual base
implementation when given its source path. The old benchmark compared against
a weaker historical freezer, included frame allocation, warmed up once, and
used hardware-sensitive pass/fail ratios.

The unchanged-root fast path now avoids traversal allocations. Sparse arrays
no longer loop over missing indices. New dense arrays pay for descriptor
validation on each owned property; this is a correctness cost, not an
across-the-board optimization. Structural sharing of previously validated
subtrees remains supported.

On darwin/arm64, microseconds per snapshot (before → after):

| Workload | Node 22.22.0 | Node 24.19.0 |
| --- | ---: | ---: |
| New dense array, 32 mostly shared entities | 1.892 → 3.325 | 2.104 → 3.658 |
| New dense array, 1,000 mostly shared entities | 36.333 → 75.641 | 42.224 → 91.415 |
| 32 fresh entities | 10.029 → 13.339 | 10.943 → 14.154 |
| 1,000 fresh entities | 293.260 → 385.427 | 320.405 → 407.337 |
| New root, unchanged 1,000-entity array | 0.519 → 0.561 | 0.514 → 0.552 |
| Unchanged root | 0.289 → 0.012 | 0.297 → 0.011 |
| Sparse array, length 1,000,000, two values | 6904.865 → 803.208 | 6921.240 → 820.354 |

Sparse snapshots improve 8.4–8.6×; unchanged-root reuse improves 23–27×.
Validating a new dense array with 1,000 shared entities adds about 39–49µs
per snapshot on these hosts. Whole-array sharing remains cheap. Descriptor
batching and deferred error-path formatting did not provide a consistent
enough win to justify extra runtime complexity.

Reproduce from the repository root (select Node 22 or 24 in the shell):

```sh
git show aa773c2:packages/gamekit/src/core/session/deepFreeze.ts > /tmp/gamekit-deepFreeze-before.ts
pnpm --filter rn-gamekit bench:deepfreeze /tmp/gamekit-deepFreeze-before.ts
```

These are Node CPU measurements, not Hermes/device FPS or memory results.
Native performance acceptance remains unmeasured. The array specialization
was replaced because it skipped data and traversed inherited values; this is
a correctness change with an explicitly measured dense-array cost, not a
claim that a simpler loop is always faster.

## Validation

The initial 16 snapshot ownership regressions all failed before the freezer
change; the initial lifecycle regression set had 28 failures and two passes.
The final sets include additional index-accessor and terminal-disposal cases.
Validation completed 2026-10-25:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; no manifest or lockfile changes. |
| `pnpm check` | Passed: workspace lint and typecheck, 1,021 library tests and 311 playground tests, library declarations/ESM, docs production build, and playground iOS export. |
| `pnpm --filter rn-gamekit typecheck:api` | Passed, including public snapshot/error fixtures. |
| `pnpm --filter rn-gamekit test:coverage:gate` | Passed the repository's targeted 80% line-coverage gate. |
| Full library LCOV run after final source edits | Passed. Session: 97.4% lines, 94.2% branches, 93.7% functions. Freezer: 99.5% lines, 93.5% branches, 100% functions. This is module coverage, not repository-wide coverage. |
| Independent code review and `git diff --check` | No remaining runtime blockers or whitespace errors; corrected the documented session variable. |
| `pnpm audit --json` | Reports 51 advisories on the unchanged dependency graph: 6 critical, 35 high, 9 moderate, 1 low. Dependency remediation remains separate from this system PR. |
| Playground `expo install --check` | Existing dependency drift still fails: `@expo/ui` expects `~57.0.26`, Expo `~57.0.31`, `expo-asset` `~57.0.20`, and `expo-dev-client` `~57.0.20`. Installed versions remain `57.0.20`, `57.0.25`, `57.0.18`, and `57.0.19` respectively. No Action or dependency changes included. |
| Device/Hermes performance or native E2E | Not run. The playground export is a bundle check, not device execution. |
