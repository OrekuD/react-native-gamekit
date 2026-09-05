# Scene lifecycle and snapshot ownership

## Purpose and verdict

Scenes should be small synchronous state machines. Enter creates state; update returns new state; snapshot extracts renderer data; exit releases resources. **Keep functional scenes and explicit snapshots. Fix terminal ownership before refactoring the lifecycle machinery.**

Sources: [scene contracts](../../packages/gamekit/src/scene/types.ts), [session implementation](../../packages/gamekit/src/core/session/createGameSession.ts), [deep freezer](../../packages/gamekit/src/core/session/deepFreeze.ts), [scene-state documentation](../../apps/docs/content/docs/core-concepts/scene-state.mdx).

## GS-SCENE-01 — P1: disposal can run twice after a transition fails

**Evidence: reproduced.** An outgoing scene whose `dispose` increments a counter and throws is retained as `activeScene` by `commitTransition` (lines 499–511). Calling `session.dispose()` afterward invokes that same disposer again. The probe counted **two calls**, although the comment explicitly says disposal is not retried and the public contract promises exactly once. Retrying a transition can also reuse the partially disposed scene.

**Resolve:** track disposal ownership per scene instance, set the terminal/disposal-attempt flag before invoking user cleanup, and ensure all transition and session-disposal paths use it. Decide what happens to a partially disposed active scene: an honest terminal/fault policy or an explicitly non-resumable state is preferable to pretending it is safe to update. Do not automatically recreate or retry user cleanup. Preserve the prepared target's cleanup on outgoing failure and report both errors if both cleanup operations fail.

**Acceptance:** outgoing disposal throws; later session disposal, restart, and scene transition never call that instance's disposer again. A prepared target is disposed once. Successful transitions still dispose the outgoing final state once, and failed target creation never disposes an uncreated target.

## GS-SCENE-02 — P2: initial snapshot failure can lose the original exception

**Evidence: source-confirmed.** Initial snapshot preparation catches its error, calls `initialDefinition.dispose(initialState)`, then rethrows. If disposal also throws, the cleanup exception replaces the snapshot failure. Other lifecycle paths already have explicit captured-failure/AggregateError handling.

**Resolve:** use the existing lossless error-composition policy for initialization cleanup. Avoid another exception framework. Preserve arbitrary thrown values, including `undefined`.

**Acceptance:** snapshot and disposer both throw distinguishable values; both are recoverable from the final error in a stable order, and disposal still runs once.

## GS-SCENE-03 — P2: state immutability depends on snapshot selection

**Evidence: source-confirmed design gap.** State is only shallow-frozen by `freezeObject`. Snapshot subtrees are deep-frozen in place. If a snapshot reuses a nested state array, that array becomes frozen; if the snapshot omits it, it stays mutable. The state type is `Readonly<TState>`, which also permits nested mutation. The documentation describes a pure update and plain serializable data, but the generic signature permits Maps, functions, accessors, and other unsupported snapshot values. `Object.freeze(new Map())` does not freeze its entries.

**Resolve:** define the supported snapshot domain explicitly and enforce it at the publication boundary. Prefer plain records/arrays/scalars and a documented author obligation for pure state updates. Do not extend the freezer into a serializer for arbitrary JavaScript objects or automatically deep-clone the whole game every tick. Make clear that returning state references transfers them into immutable snapshot ownership. If adding development-only mutation diagnostics for scene state, distinguish that from the all-build public snapshot guarantee.

**Acceptance:** nested aliasing behavior is documented and tested; unsupported snapshots fail with an actionable path before publication; an unsupported value cannot leave a half-published commit. Preserve structural sharing, cycles/extra-key behavior only where intentionally supported, and existing getter-failure recovery tests until a reviewed contract change supersedes them.

## Delete, simplify, then measure

The freezer's trusted `WeakSet` avoids revisiting shared subtrees and should stay. Its array index/digit fast paths are much more complex than a straightforward traversal. **Do not delete them just for aesthetics:** inspect [deepFreeze.bench.ts](../../packages/gamekit/bench/deepFreeze.bench.ts) and existing correctness tests, compare the simpler traversal on representative Hermes snapshots, and remove the specialization only if the measured cost is acceptable. Old Node/V8 timings cannot decide that tradeoff for mobile.

Do not extract a generic scene-resource registry or replace all local mutation with persistent collections. Internal, exclusively owned bookkeeping and public immutable snapshots have different requirements.

Preserve [sceneLifecycle.test.ts](../../packages/gamekit/test/sceneLifecycle.test.ts), [deepFreeze.test.ts](../../packages/gamekit/test/deepFreeze.test.ts), [deepFreezeArrayKeys.test.ts](../../packages/gamekit/test/deepFreezeArrayKeys.test.ts), and the status-disposal tests. Coordinate lifecycle changes with [React presentation](03-react-presentation.md) and [events](13-events.md).
