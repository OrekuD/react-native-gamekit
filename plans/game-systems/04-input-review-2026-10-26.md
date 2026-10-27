# Input implementation review

Reviewed 2026-10-26 against `5ca2f17` on `fix/core-input-review`.
This is system 04 in the [review order](README.md). The branch starts from
merged `main` and is independent of the two system 03 presentation PRs.

The original [input brief](04-input.md) remains historical evidence. Its
basic pending-pointer termination, button reference counts, and pause epoch
guards were already implemented. This review exercises the remaining
ownership boundaries through the core buffer and mounted React adapters.

## Ownership and scope

The RN runtime owns semantic input and fixed-step sampling. UI worklets own
native touch sampling, pointer coalescing, and compact delivery packets.
React owns adapter lifetimes and mounts the trailing pointer sampler only
while needed; it does not store per-frame positions. Pointer coordinates
continue to use the viewport and event-time camera presented by `GameView`.

This change does not redesign the scheduler, camera, or renderer. Native
dependency versions remain RN 0.86.3, Expo 57.0.25, Skia 2.11.0, Reanimated
4.5.3, Worklets 0.10.3, and Gesture Handler 3.1.0. No dependency or GitHub
Actions changes are included.

## Reproduced defects and acceptance

| Trigger / before | Behavior after / regression coverage |
| --- | --- |
| Begin/end pointer 1, then begin/move/end pointer 2 before sampling: pointer 2's entire tap disappears. | Deliver pointer 1's terminal sample first, then pointer 2's `pressed` + `released` sample with its final position and accumulated movement, then neutral input. Keep one bounded pending slot. |
| Begins rejected by an occupied pending slot, invalid button calls, and duplicate pointer ends inflate accepted-input counts. | Keep the first accepted pending owner; count only accepted commands after action validation. |
| Two fingers exchange held button zones in one move event: intermediate refcount changes create false release/press edges. | Compute action edges across the complete native batch; both actions remain held. |
| A touch starts in a gap or loses its zone, ownership is invalidated, and a later move acquires a button without a new down. | Track all physical downs independently of their current zone. Invalidation clears that bounded set; untracked moves cannot acquire. |
| A held `GameButton` unmounts after React clears its native ref, or changes action without another layout event. | Stable registration identity removes the old zone exactly once; rename remeasures and registers the new action. |
| A nested button registers its parent-relative rect before native measurement completes; an older measurement overwrites a newer layout. | Use only validated pad-relative measurements, reject stale completions, and refresh measurements after pad layout or a committed button render. |
| Paused downs, old `allTouches`, queued packets, or stale layout measurements revive ownership. | Require running status and current adapter epoch; use changed touches for downs; invalidate on geometry changes and require a fresh down. |
| The `hitSlop` prop changes, but the controller keeps its initial value. | Validate and apply the new value, preserve measured zones, and retire old touch ownership. |
| An accepted pointer packet and its separately queued sampler callback straddle pause/replacement. | Update sampler ownership at the same accepted RN ingress as the packet. Rejected packets cannot mount a sampler. |
| StrictMode replays an effect after it disposed a memoized pointer binding. | Each effect lifetime owns a fresh binding; cleanup retires that lifetime's queued callbacks. |
| Layout changes keep live/deferred pointer state, or disposal leaves a trailing sampler mounted. | Invalidate both runtimes and release the sampler; fresh input uses the new layout/lifetime. |
| A retired frame callback runs after a replacement pointer starts and consumes its deferred movement. | Check the sampler's UI ownership before touching shared coalescer state. |
| Running scene restart resets the core without changing status; adapter ownership survives and queued callbacks reacquire it. | Compare per-action reset revisions at commit and delivery. Preserve physically held pointers only across compatible update-scoped transitions. |
| Adapter subscription setup or held-input cleanup throws; later cleanup stages never run. A throwing status-count diagnostic can also leave a newly registered listener without a cleanup handle. | Release all acquired subscriptions transactionally, preserve setup/cleanup failures, and roll back a failed core status registration without removing a preexisting owner. |

## API changes and proposals

### Included: observe action resets

Before, a custom adapter could observe pause/dispose status and commit
`hardCut`, but could not distinguish a restart from a scene transition that
deliberately preserved its active pointer. Treating every hard cut as a reset
would break supported drags across scenes.

After:

```ts
const revision = session.input.getResetRevision('drag');
// Later, before delivering a command queued under this ownership:
if (session.status === 'running'
    && session.input.getResetRevision('drag') === revision) {
  session.input.move('drag', pointerId, logicalPosition);
}
```

The read-only revision starts at zero and advances whenever that action's
ownership is reset, including a reset while neutral. A compatible
update-scoped transition keeps the revision of its preserved active pointer.
Unknown action names throw; reading a declared revision after disposal is
safe. Built-in adapters handle this automatically. A custom adapter still
needs its own layout/lifetime guards and status listener.

This adds a required method to the exported `InputController` interface.
Consumers of `createGameSession` receive it automatically; hand-written
controller implementations and test doubles must implement it. The public
declaration fixture checks action-name inference and eventful sessions.

### Included: clarify input semantics

Previously an inter-tick queued tap was silently absent; it now produces one
inactive sample with both `pressed` and `released`. Games should read edge
flags for taps instead of requiring `active` to be true.

Layout changes now terminate an active pointer stream and require a fresh
down. Buttons wait for successful positive-size native measurement instead
of exposing a temporary hit area in the wrong coordinate space. These are
intentional behavior tightenings.

### Existing API used more effectively: typed button names

Before, `<GameButton action="jupm" />` passed TypeScript because React context
cannot infer the pad's input map into the child prop. The existing exported
helper supports a checked application map without a new component factory:

```ts
const buttons = { jump: 'jump' } satisfies
  Record<string, ButtonActionName<typeof definition.input>>;
// <GameButton action={buttons.jump}>Jump</GameButton>
```

The docs and public compile fixture now demonstrate this pattern. Direct
string props remain runtime-validated; the child prop itself has not become
generic.

### Proposals kept separate

| Before → proposed after | Benefit / design work still needed |
| --- | --- |
| `session.input.press('drag')` typechecks when `drag` is a declared pointer → derive button/pointer method parameters from the full input map. | Catch wrong action kinds at compile time. This changes the exported controller/frame generic shapes and must cover scene inference and custom adapters together. Current runtime rejection remains. |
| An ancestor moves without a button render or pad/button layout callback → an explicit pad measurement revision or host layout-refresh hook. | Let a caller invalidate coordinates when native layout notifications cannot describe the change. Arbitrarily transformed/animated ancestors need a coordinate contract and device evidence before choosing the API. No such prop is advertised as implemented. |

## Performance evidence and limits

Pointer edge delivery previously scheduled separate RN callbacks for input
and sampler activity. Combining them removes one crossing per edge and makes
acceptance atomic. Button packets contain only pointer IDs and local `x/y`
coordinates, with generation/epoch metadata, instead of entire native event
objects. Physical touch tracking replaces the accumulating stale-ID set;
state is bounded by currently observed physical downs and declared zones.

Moves remain coalesced at the fixed-step interval; terminal edges remain
immediate. The change does not claim to reduce the configured worst-case
coalescing delay. No per-frame React state or new worker runtime is added.

Worklet closures capture the UI instrumentation callbacks individually;
RN-only diagnostic callbacks stay on RN. The documented pointer conversion
callback is connected to the authoritative binding so the lab can observe
the real viewport/camera conversion. When that callback is absent, the binding
does not construct its diagnostic sample object. Changing instrumentation
does not retire gameplay ownership or re-register the sampler callback.

These are deterministic work/ownership changes, not measured Hermes CPU,
device FPS, or native latency improvements. Device acceptance remains open.

## Native acceptance procedure

Use the existing Performance Lab drag scenario and button-pad reference
games in a release or `debugOptimized` development build. Repeat the same
script before and after on a 60 Hz Android phone, 120 Hz iPhone, and iPad:

1. Record raw/forwarded/accepted/sampled/committed input counts and latency
   distributions during a 60-second drag, with and without RN load. Separate
   120/240 Hz touch sampling from display and fixed-step rates.
2. Pause/resume and restart during a held drag; rotate or resize while a move
   is pending. Confirm no stale motion and zero idle trailing samplers.
3. Transition while held into a scene consuming the same action, then one
   that does not. Only the compatible handoff should retain ownership.
4. Hold two buttons, swap fingers across zones in one movement, cross gaps,
   remove/rename a held button, and change hit slop. Compare visual bounds
   with hit areas inside an offset nested layout.
5. Verify gesture competition, empty-pad pass-through, navigation edges,
   native cancellation, and stylus/trackpad behavior where supported.

Native builds were previously blocked by disk capacity during system 03;
mounted mocks and the playground bundle cannot certify native measurement,
gesture arbitration, or frame pacing. No native E2E pass is claimed here.

## Validation

Test-first evidence: the initial core set had 20 behavioral failures, pointer
adapter set had six, and button adapter set had twelve. Follow-up tests
reproduced stale sampler consumption, button reset/cancellation failures,
transactional cleanup failures, and the status registration leak. The public
API fixture also failed because `getResetRevision` was absent from declarations.

| Check | Result |
| --- | --- |
| `pnpm check` | Passed: dependency policy checks, workspace lint/typecheck, 1,095 library tests, 311 playground tests, 47 tooling tests, library declarations/ESM, docs production build, and playground iOS bundle export. Next.js required permission to create its local build process/port. |
| `pnpm --filter rn-gamekit typecheck:api` | Passed against rebuilt public declarations, including reset revisions, wrong action-name/kind rejection by React props/helpers, and eventful-session adapter compatibility. |
| Full library LCOV run | All 1,095 tests passed. Every changed runtime module exceeds 80% line coverage; see exact results below. |
| Installed Worklets Babel transform | Pointer and button closures inspected: no session or whole instrumentation object captured. UI callbacks and remote RN delivery functions remain distinct. |
| Independent core/adapter review and `git diff --check` | Passed after fixing the identified subscription rollback gap. |
| `pnpm audit --json` | Reports 51 advisories on the unchanged dependency graph: 6 critical, 35 high, 9 moderate, 1 low. No dependency or Action changes included. |
| Native device E2E / performance | Not run. The exported iOS bundle and mounted mocks are not native execution. Follow the device procedure above; no FPS or latency improvement is claimed. |

| Changed runtime module | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| Input buffer | 100.00% | 98.21% | 100.00% |
| Button-pad controller | 97.89% | 97.80% | 100.00% |
| Session (registration rollback) | 96.99% | 94.69% | 95.65% |
| Button adapter | 99.69% | 93.10% | 100.00% |
| Pointer adapter | 96.12% | 72.34% | 97.30% |
| Pointer binding | 97.59% | 91.67% | 96.00% |
