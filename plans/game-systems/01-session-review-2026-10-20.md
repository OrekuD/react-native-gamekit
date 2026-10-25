# System 01: game definition and fixed-step session

Review and implementation against `aa773c2`, on `fix/core-session-review`.
This is the first slice of the renewed system-by-system review. The September
findings in [01](01-game-definition-and-session.md) are historical; their three
fixes were already present. This document records new findings and proposals.

## Scope and ownership

The RN JavaScript runtime owns simulation, input sampling, scene state, timing
debt, lifecycle and event staging. The platform animation-frame driver supplies
timestamps. React owns session creation/disposal and binds the presentation
sink; UI-runtime callbacks interpolate immutable commits. This slice keeps those
owners and the existing retained renderer unchanged.

Reviewed the definition and session contracts, frame driver, catch-up loop,
transition publication, lifecycle errors, commit subscriptions, diagnostics,
React binding/ownership, and the corresponding docs and game callers. Followed
input reset, scene cleanup and render snapshots at those boundaries; the
separate input, scene/snapshot and renderer audits remain queued.

Installed and lockfile versions: React Native 0.86.3, Expo 57.0.25, Skia 2.11.0,
Reanimated 4.5.3, Worklets 0.10.3 and Gesture Handler 3.1.0. No dependency,
native configuration, public constructor signature or runtime ownership change.

## Confirmed defects fixed

| Finding | Before | After and regression evidence |
| --- | --- | --- |
| Stale target snapshots after external transitions/restarts | With a 10 ms step, baseline at 0, `setScene('b')`, callback at 10: B updates to count 1 but the published frame remains count 0/tick 0. A following zero-step callback still exposes stale data. | A single hard cut publishes the latest completed target snapshot. Tests use the real `bindGameSession` sink for transitions and restarts at 10/25 ms, subsequent zero-step callbacks, and the next ordinary adjacent pair. |
| Frame cancellation failure leaves a broken lifecycle | A throwing injected `cancelFrame()` leaves `pause()` reporting running with an invalidated loop. `dispose()` exits before invalidation, notifications or cleanup; retained callbacks can keep updating. | Detach the handle and invalidate the generation, finish input/timing reset, status delivery and terminal cleanup, then throw. Tests prove stale callbacks are inert, explicit resume works, cleanup runs once and multiple failures retain their order. |
| Inherited scene names enter unintended objects | An undeclared initial scene named `constructor`, `toString` or `__proto__` resolves through the internal dictionary prototype and fails with an unrelated TypeError. | Use a dictionary without a prototype. Undeclared names report `Unknown initial scene`; explicitly declared prototype-like names still work. |
| Transition catch-up work is undercounted | A transition on the second fixed step reports two fixed steps but zero catch-up steps. | Count the transition step consistently. Regression: timestamps 0/25 ms with 10 ms steps report two fixed steps and one catch-up step. |

The transition fix preserves the existing one-publication-per-callback
requirement. Its observable correction is that a commit listener now sees the
completed target state after due updates, rather than the stale initial state.
A listener can pause on that cut; steps already completed in the callback are
not undone. Idle/paused transitions remain synchronous, and zero-step transitions
still publish the initial target. An update failure after target preparation
publishes the target's last successful snapshot before pausing, preserving the
original update error.

The docs now distinguish the RN simulation clock from UI interpolation, start
and baseline the manual-driver example correctly, identify `useGameSession`
as creating an idle session, and remove nonexistent constructor seed options.

## Performance change and limits

Commit subscriptions now use an array replaced only when membership changes.
Previously every publication copied a Set to a new array. This removes one
transient listener-array allocation per commit: approximately 60 per second
at the default simulation rate, whether the display is 60 or 120 Hz.
Registration/removal become O(n) control operations; the intended subscriber
count is small. Snapshot ordering, duplicate registration, repeated removal
and disposal during delivery are covered by behavioral regressions.

[session.bench.ts](../../packages/gamekit/bench/session.bench.ts) exercises the
actual session with a counter scene and a single-slot driver. It validates tick
counts and observed commits, warms 10,000 callbacks, then measures seven runs
of 50,000 callbacks for 0/1/4/16 listeners at 60/120 Hz.

```sh
pnpm --filter rn-gamekit exec node --import tsx bench/session.bench.ts
```

The optional module-path argument selects a baseline implementation whose
relative imports must still resolve. For cross-revision comparison, use the
same benchmark in both checkouts. Local measurements use Node 24.19.0/V8 on
macOS arm64, with diagnostics disabled; these are CPU microbenchmarks, not a
mobile build or a GPU/FPS acceptance test. The final sequential runs produced
these medians in microseconds per driver callback:

| Display Hz | Listeners | Before | After |
| --- | --- | --- | --- |
| 60 | 0 | 1.659 | 1.767 |
| 60 | 1 | 2.039 | 1.965 |
| 60 | 4 | 1.888 | 1.639 |
| 60 | 16 | 1.689 | 1.847 |
| 120 | 0 | 0.816 | 0.987 |
| 120 | 1 | 1.133 | 0.859 |
| 120 | 4 | 0.826 | 0.865 |
| 120 | 16 | 1.115 | 1.083 |

The sample ranges overlap and the direction varies: this does **not** establish
a consistent whole-session speedup. The justified change is the removed
allocation, with unchanged subscription semantics. Do not translate these
numbers into an FPS claim.

Native acceptance remains unmeasured. On physical midrange Android, iPhone and
iPad devices, repeat the existing Performance Lab baseline and drag scenarios
for 60 seconds at supported 60/120 Hz, in release or `debugOptimized` builds.
Use the same assets/seed and thermal conditions; record simulation/publish
p50/p95/p99, allocations/GC, UI frame pacing and input latency. Include a queued
restart, long pause/resume and repeated open/close. Compare commit count and
resource balance as well as FPS. No new asset ownership, coordinate transform,
gesture conflict or GPU behavior is introduced by this slice.

## API proposals — not implemented in this PR

### A. Preserve typed events through the session hook

The hook currently fixes its definition/session event generic to the default
`Record<string, never>`. A compiler probe with a valid event-enabled game
produces TS2345 at `useGameSession(game)` and TS18046 for the inferred event
payload. The imperative constructor already retains those types.

Before:

```tsx
const events = defineGameEvents({ scored: gameEvent<{ points: number }>() });
// game binds this same events object and its scenes declare scored.
const session = useGameSession(game); // TS2345: events incompatible with never
```

Proposed after:

```tsx
const session = useGameSession(game); // typed GameSession | undefined
useEffect(() => {
  if (!session) return;
  return session.addGameEventListener('scored', (event) => {
    updateScore(event.payload.points); // inferred number
  }).remove;
}, [session]);
```

Thread `TEventDefs` through `SessionCreator`, `OwnedSession`, `useGameSession`
and `useOwnedGameSession`. The benefit is using the existing ownership hook for
the same games supported by the imperative constructor, without unsafe casts
or manual effect ownership. This is an additive typing correction, with no
new runtime method. Follow-up acceptance: event names/payloads infer correctly,
unknown names and wrong payload accesses fail compilation, and the mounted
hook still disposes once across replacement/Strict Mode.

### B. Make supported timing configuration available from the normal constructor

The Performance Lab currently imports the testing entry point to configure
session timing and inject its driver. Ordinary consumers only get the default
60 Hz constructor.

Before:

```ts
import { createAnimationFrameDriver, createGameSessionWithDriver } from 'rn-gamekit/testing';

const session = createGameSessionWithDriver(game, {
  frameDriver: createAnimationFrameDriver(),
  fixedStepMs: 1000 / 30,
  maxCatchUpSteps: 3,
  maxFrameDeltaMs: 100,
});
```

Proposed after:

```ts
import { createGameSession } from 'rn-gamekit';

const session = createGameSession(game, {
  timing: {
    fixedStepMs: 1000 / 30,
    maxCatchUpSteps: 3,
    maxFrameDeltaMs: 100,
  },
});
```

This keeps normal configuration independent of test infrastructure and makes
the simulation budget explicit. Preserve the one-argument defaults and
renderer-neutral boundary; leave driver injection and diagnostics in the
testing entry point initially. The `timing` option above is a proposal, not an
implemented signature. Follow-up acceptance must cover validation, 30/60 Hz
tick parity at 60/120 Hz display, bounded stalls, pause/resume, snapshot `stepMs`,
and documentation that changing simulation rate can change authored game rules.
Do not present this argument as a general seed/save-data container.

## Validation and remaining gates

- New regressions were run against the original implementation before fixes:
  stale transition publication, cancellation teardown, inherited initial names,
  and transition catch-up diagnostics failed as expected.
- Workspace lint and typecheck passed. Tests: 976 library and 311 playground
  tests (1,287 total), including mounted React ownership/presentation and the
  reference games.
- Library API fixtures passed (`pnpm --filter rn-gamekit typecheck:api`).
- Coverage gate passed. This PR adds the session and definition modules to its
  enforced 80% line threshold: session 97.8% lines / 94.2% branches; definition
  100% lines / 83.3% branches. This is not a claim of repository-wide coverage.
- Library, docs and iOS playground export builds passed. Turbopack needed a
  rerun outside the sandbox because its local worker port was initially denied.
- Independent correctness and security review found no patch-introduced issue.
- GitHub CI for commit `2ed8411` passed lint, typechecks, API fixtures, tests,
  coverage and the docs build. It failed at Expo dependency validation, also
  reproduced locally: `expo` 57.0.25 expects ~57.0.30, `@expo/ui` 57.0.20
  expects ~57.0.25, `expo-asset` 57.0.18 expects ~57.0.20, and
  `expo-dev-client` 57.0.19 expects ~57.0.20. These pins are unchanged from
  the base branch. CI skipped its later export/prebuild/autolinking steps.
  Dependency alignment is an additional merge blocker; do not disable the
  check to make this system review pass.
- `pnpm audit --audit-level high` failed on the unchanged dependency graph:
  48 advisories (4 critical, 34 high, 9 moderate, 1 low). Critical paths include
  Next.js in the docs app and shell-quote through Expo/React Native tooling.
  Keep this PR draft with the dependency audit as a merge blocker; remediate in
  a separate security change rather than hiding broad dependency upgrades here.
- Physical-device rendering/FPS and native lifecycle smoke tests remain
  unmeasured. The Node tests and export build do not establish those results.

Next system in the existing review order: **02 — scenes and snapshots**.
The API proposals above can each be a separate PR for system 01.
