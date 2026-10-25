# React and presentation implementation review

Base: merged `main` at `5ca2f17`. Branch: `fix/core-react-presentation-review`.
This is the lifecycle/presentation PR for system 03. Native buffer publication
is tracked separately below; this report does not declare that investigation
complete.

## Ownership and scope

React owns session creation/disposal, subscriptions, and the mounted tree.
The headless session owns simulation. `GameView` borrows a session and owns
its presentation subscription, start/pause binding, UI interpolation clock,
and camera presentation binding. The renderer receives compact commits;
React never stores per-frame simulation values.

The historical [system 03 brief](03-react-presentation.md) predates fixes
already on the base branch. Disabled instrumentation already avoided timing
reads and RN scheduling, and setup already used a reverse-order cleanup
list. This patch addresses the remaining behavior rather than repeating
those earlier changes.

## Bugs and performance changes

| Finding | Before | After |
| --- | --- | --- |
| Session replacement with a reused presentation key | An explicit key replaced automatic session identity, so the replacement renderer could execute with the old session's frame. | Session identity always participates in the key; the optional key only adds a reset boundary for that session. |
| Queued observations outlive their owner | A scheduled UI report read the newest observer ref on RN and could deliver an old session/revision to a replacement observer or after unmount. | Observer generations reject stale queued reports. The ref belongs to the presentation lifetime, not the outer view. |
| Setup exception lost during unwind | `releaseAll()` could throw and replace the original setup failure. | `releaseAfterFailure(error)` attempts every release and preserves the original thrown value first, including `undefined`. |
| Cleanup can run twice through reentry | The release list remained populated while invoking callbacks. | Detach the pending list before invoking callbacks, so reentrant release does not run the same disposer twice. |
| Subscription removal failure skips pause | A throwing removal stopped `bindGameSession` cleanup before pausing. | Listener removal and pause are both cleanup stages. Stale commit callbacks are disabled before either runs. |
| App lifecycle callbacks survive cleanup | A queued foreground event could resume an unmounted game, especially if removal threw before the resume flag cleared. | Retire the binding and clear ownership before releasing listeners; both status and AppState callbacks check retirement. |
| Background pause commits, then an observer throws | The session became paused but the binding never recorded ownership, so foreground did not resume it. | Record whether pause actually committed in `finally`, without claiming a disposed or reentrantly retired session. |
| Camera cleanup registered too late | Failure in session/AppState binding could bypass camera release. | Register camera release before setup starts and attempt it even if other releases throw. |
| Disabled diagnostics still write UI state | Every newly observed revision wrote two diagnostic shared values even without an observer. | Branch before diagnostic observation bookkeeping. Required interpolation writes remain. |
| Frame callback changes with ordinary React renders | Inline callback identity caused avoidable registration churn. | A memoized worklet keeps identity stable while its owned shared values remain stable. |
| Hook drops declared event types | `useGameSession` constrained the definition to an event-free map and rejected valid eventful games. | Carry the inferred event map through the hook's owner and return type; renderer/status/lifecycle consumers need no changes. |

Tests execute the actual registered frame callback with stable shared-value
mocks and a queued RN scheduler. With instrumentation disabled, a newly
observed revision changes from five shared-value writes to three: the two
diagnostic writes disappear while the required clock writes remain. There
are zero diagnostic timing reads or RN callbacks. Callback identity stays
stable on an instrumentation-prop change. These are deterministic work-count
measurements, not a device FPS or latency benchmark.

The installed Worklets Babel transform also confirms the frame callback
captures only the camera's `present` worklet instead of the whole binding,
which contains RN-side commit logic and refs. No new clock or runtime was
introduced.

## API before and after

`presentationKey` is clarified without adding another lifecycle API:

```tsx
<GameView game={session} presentationKey="play" renderer={Renderer} />
```

Before, replacing `session` while keeping `"play"` reused its presentation
state until the effect ran. After, the new session initializes its own frame
and clock before its renderer runs. Changing the key on the same session
still resets presentation, without recreating scene state. Callers no longer
need to manufacture globally unique keys just to replace sessions safely.

The docs now also match `useGameSession`'s implemented ownership: it creates
an **idle** session; `GameView` starts it. `useGameSessionStatus` accepts the
hook's initial `undefined` value, so both hooks can be called unconditionally.

Typed game events now work through the React owner:

```tsx
const session = useGameSession(gameWithScoredEvent);
session?.addGameEventListener('scored', (event) => {
  const points: number = event.payload.points;
});
```

Before, the definition failed assignment to `Record<string, never>` and
event payload information was lost. After, event names and readonly payloads
retain their declared types without casts. The new event-map generic has a
default, preserving existing two-generic calls. A public compile fixture
checks positive inference and rejected unknown names/payload mutations.
The separate event-free-session policy remains part of system 13.

Separate proposals requiring a fuller consumer review:

- **Presentation lifecycle policy.** Today mounting any `GameView` starts
  the borrowed session, and unmount pauses it. An explicit observe-only mode
  could support externally managed or multiple surfaces without competing
  start/pause ownership. Specify background behavior and a single default
  owner before adding a prop; do not add a global coordinator speculatively.
- **Structured diagnostic observations.** Today an observation callback
  receives `(revision, atMs)`. A payload with session/presentation identity
  could make multi-surface measurement easier. Generation rejection fixes
  stale delivery now; a new public payload needs a compatibility decision.

## Native buffer publication: separate follow-up

Installed versions: RN 0.86.3, Expo 57.0.25, Skia 2.11.0, Reanimated 4.5.3,
Worklets 0.10.3, and Gesture Handler 3.1.0. No versions change in this PR.

The three batch renderers still mutate host objects outside Skia's buffer
modifier. Installed Skia calls its internal notifier after its own modifier;
the independent GameKit writers do not provide that publication. This is
source evidence of a notification risk, not proof of a native failure.

The existing Buffer Probe cannot settle it: a changing `GameWorld2D`
transform can trigger redraw independently, all systems share a canvas, and
the particle source passes the loaded-image wrapper instead of its native
image. A separate PR must isolate canvases, hold transforms/React stable,
repair the source, and compare native output before/after publication fixes.

The proposed public-API correction separates reaction inputs from output
buffers, writes all rect/transform/color slots in one UI callback, then
forces buffer notifications with `SharedValue.modify`. Appending notifications
to the current derived-value writer would self-invalidate because its
captured buffers are also mapper inputs. No private `_value`/`notifyChange`
imports are proposed. See the official
[shared-value API](https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/)
and [reaction contract](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useAnimatedReaction/);
installed source is the version-specific authority.

Local iOS simulators and an Android AVD are available, but no device run has
been completed for this PR. Native redraw and physical 60/120 Hz performance
remain unverified.

## Validation

Initial cleanup regressions: 13 failures before the patch. Initial mounted
presentation regressions: six failures before the patch. Existing ownership,
pause, binding, interpolation, and lifecycle-source tests remain in scope.
The Strict Mode mounted test also verifies two subscription setups, one
rehearsal release before unmount, and two releases after unmount.

| Check | Result |
| --- | --- |
| Frozen workspace install | Passed; manifests, catalog, and lockfile unchanged. |
| `pnpm check` | Passed: dependency-policy checks, lint, typecheck, 47 tooling tests, 1,057 library tests, 311 playground tests, library build, docs production build, and playground iOS export. |
| `pnpm --filter rn-gamekit typecheck:api` | Passed against rebuilt declarations, including the eventful React owner fixture. |
| Full library LCOV run, five modified runtime modules gated at 80% lines | Passed: GameView 98.6%, session binder 94.5%, app lifecycle binder 100%, cleanup list 98.4%, session hook 100%. Respective branch coverage: 88.1%, 90.9%, 94.7%, 90.9%, 88.9%. This is module coverage, not repository-wide coverage. |
| Independent review and whitespace check | Passed after fixing numeric reset-key collisions and making Strict Mode replay observable. |
| `pnpm audit --json` | Existing unchanged graph: 51 advisories (6 critical, 35 high, 9 moderate, 1 low). No dependency or GitHub Actions changes in this PR. |
| Native redraw / physical-device performance | Not executed in this PR; separate buffer-publication follow-up required. |

The existing online Expo compatibility check still has version drift on the
unchanged native set. Passing the workspace checks is not a claim that this
unrelated check or the dependency audit is clear.
