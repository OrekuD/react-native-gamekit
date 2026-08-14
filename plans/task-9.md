# Task 9: React-owned game sessions and lifecycle-safe examples

## Status

**Not started.** This task introduces the first public React ownership hook for
`GameSession`, removes manual disposal effects from the normal authoring path,
and rewrites the package documentation and compile-tested examples around the
new lifecycle contract.

Task 9 is intentionally narrower than the upcoming world/systems milestone. It
must make the existing session API safe and pleasant in React before more
engine systems depend on it.

## Objective

A typical React Native game screen must be able to create and own a session
without manually combining `useState`, `useEffect`, and `session.dispose()`.
The recommended call site should be approximately:

```tsx
import { GamePointerInput, GameView, useGameSession } from 'rn-gamekit/react';
import { paddleGame } from './game';

export function PaddleScreen() {
  const session = useGameSession(paddleGame);

  if (session === undefined) {
    return null;
  }

  return (
    <GameView game={session} renderer={PaddleRenderer}>
      <GamePointerInput game={session} action="steer" />
    </GameView>
  );
}
```

The hook owns creation and terminal disposal. `GameView` continues to borrow
the session, start it while mounted, pause it during unmount/backgrounding, and
never assume that it owns terminal disposal.

The imperative API remains supported:

```ts
const session = createGameSession(game);

try {
  session.start();
  // Run or inspect the session.
} finally {
  session.dispose();
}
```

This remains the correct path for headless tests, non-React programs, custom
surface controllers, and advanced owners such as the persistent playground
shell.

## Why this task is required

The current beginner example teaches this pattern:

```tsx
const [session] = useState(() => createPaddleSession());

useEffect(() => () => session.dispose(), [session]);
```

That example exposes resource ownership boilerplate to every user and makes it
easy to forget cleanup. Moving the same lines unchanged into a custom hook is
not sufficient. React Strict Mode performs an additional development-only
effect setup and cleanup cycle. An irreversible `dispose()` during that
rehearsal can leave a component holding a disposed session when effects are
set up again.

The current division of responsibility is otherwise correct:

- `createGameSession()` creates an imperatively owned headless resource.
- `GameView` binds, starts, presents, pauses, and unbinds a borrowed resource.
- the creator performs terminal disposal.

Task 9 adds a React owner without weakening or confusing those boundaries.

## Scope

### Included

- A public `useGameSession()` hook exported from `rn-gamekit/react`.
- Exact scene and input generic inference from a `GameDefinition`.
- Effect-owned creation that is compatible with React Strict Mode.
- An explicit initial `undefined` state while no committed session exists.
- Stable session identity when the same definition is rendered again.
- Safe disposal and replacement when definition identity changes.
- Exactly-once terminal disposal when the owner unmounts.
- Clear propagation of session-creation errors.
- Type fixtures, lifecycle tests, Strict Mode tests, and mounted integration
  tests with `GameView` and `GamePointerInput`.
- Package exports, source maps, declarations, tarball inspection, and headless
  root verification.
- Migration of normal documentation and examples away from manual React
  disposal effects.
- Explicit documentation of when imperative ownership is still correct.

### Explicitly deferred

- A high-level `<Game>` or `<GameProvider>` component.
- Reading the active session from context inside `GamePointerInput`.
- Removing the required `game={session}` prop from `GamePointerInput`.
- Automatic asset loading or starting an asset-backed game before its lease is
  ready.
- Async game or scene construction.
- Suspense integration.
- Session pooling or sharing one hook-owned session between separate React
  roots.
- Moving the playground's persistent surface controller onto the hook.
- Changing `GameSession.dispose()` into a reversible operation.
- Hiding lifecycle defects with timers, delayed disposal, or status guards.

These ideas may build on the ownership seam later, but they must not inflate
this hook into a general application shell.

## Locked public contract

### 1. The hook accepts a definition, not a pre-created session

The primary API is:

```ts
const session = useGameSession(gameDefinition);
```

Do not require users to write or memoize a session factory for the common
path. A `GameDefinition` is immutable configuration, already carries the
scene/input types, and is the single source of truth from which a session is
created.

The implementation may use internal factories as test seams, but no factory
or dependency-array overload should be public in this task.

### 2. The return value is `GameSession | undefined`

`undefined` has one documented meaning: React has not committed a live session
for the current definition yet. This occurs on the initial render and during a
definition replacement boundary.

Never return the previous definition's session while a replacement is being
created. Never return a session whose status is `disposed`.

Do not use `null`; there is no separate “explicitly empty” meaning. Do not add
a loading boolean that can disagree with the session value.

### 3. Definition identity controls session identity

- Re-rendering with the same definition object returns the same live session.
- Rendering a different definition object unpublishes the old session, then
  creates and publishes a fresh session.
- Returning to a previous definition creates a new session; disposed sessions
  are never cached or revived.
- Definitions should normally be declared at module scope. Documentation must
  warn against calling `defineGame()` inside a component render.

### 4. The hook owns terminal disposal

The hook must dispose every session it creates exactly once. Consumers must
not call `dispose()` on a hook-owned session.

`GameView` must retain its existing borrowed-resource semantics:

- bind and start while mounted;
- pause and unsubscribe on cleanup;
- respond to app foreground/background lifecycle;
- never call terminal `dispose()` merely because the view unmounted.

This distinction must be stated in JSDoc and user documentation.

### 5. The hook does not start the session

Creation, presentation binding, and simulation execution remain separate.
`useGameSession()` creates an idle session. `GameView` starts the session when
it binds. A hook-owned session that is never passed to a presenter stays idle.

Do not introduce a hidden frame loop or timer in the hook.

### 6. Asset readiness remains an outer boundary

`useGameSession()` does not load `GameDefinition.assets`. For an asset-backed
game, mount the component that calls `useGameSession()` only after
`useGameAssets()` reports `ready`, following the existing ready-child
ownership pattern.

The hook must not create an asset-backed gameplay session merely because a
manifest exists. Automatic definition-to-asset orchestration belongs to a
future high-level `<Game>` component.

### 7. Strict Mode is an acceptance requirement

Do not implement the hook as a lazy `useState` initializer plus an irreversible
effect cleanup. Do not use `setTimeout`, `queueMicrotask`, animation frames, or
elapsed time to guess whether an unmount is real.

Create the owned resource inside a commit-phase lifecycle and publish only the
currently owned generation. The exact React primitive must be selected after
verifying the installed React version and official lifecycle guidance, then
proved through executable Strict Mode tests.

## Proposed source organization

Keep public exports as barrels and implementation in focused files:

```text
packages/gamekit/src/
├── react.ts
└── react/
    ├── useGameSession.ts
    ├── GameView.tsx
    └── bindGameSession.ts

packages/gamekit/test/
├── useGameSession.test.tsx
├── useGameSession.types.tsx
└── gameSessionOwnership.test.tsx
```

Use the repository's established test layout if the exact filenames need to
change. Do not put implementation logic directly in `src/react.ts`.

## Execution plan

### T9.0 — Verify React lifecycle behavior and freeze the contract

This step prevents a convenience hook from hiding a broken lifecycle model.

- [ ] Verify the installed React and `react-test-renderer` versions.
- [ ] Read the current official React documentation for Strict Mode, effect
      cleanup, resource ownership, and effect-driven state.
- [ ] Record whether `useEffect` or `useLayoutEffect` is appropriate for the
      native ownership boundary and why.
- [ ] Write compile-only call-site fixtures for the desired API before adding
      the implementation.
- [ ] Prove scene names, snapshots, and input action names remain exactly
      inferred from the supplied definition.
- [ ] Add expected type failures for non-definitions and incompatible
      `GameView`/renderer/input combinations.
- [ ] Record the accepted API and rejected factory/dependency-array overloads
      in this task under an implementation note.

The contract fixture must include a shape-only game and an asset-backed game.
The asset-backed fixture must show the hook inside a child that mounts only
after asset readiness; it must not imply that the hook loads assets.

> **Implementation note (T9.0).** Verified: React `19.2.3`,
> `react-test-renderer` `19.2.3` (the repository's mounted-test infra is
> `create`/`act` from react-test-renderer, per `useGameAssets.test.tsx`);
> official React guidance (react.dev StrictMode + useEffect, fetched
> 2026-08-14) designates effects as the synchronization primitive for
> external systems and Strict Mode as a setup → cleanup → setup rehearsal.
>
> **Lifecycle primitive: `useEffect` (passive), not `useLayoutEffect`.**
> Creating a `GameSession` connects the component to an external headless
> system; nothing is measured or laid out, so the passive effect is the
> documented default and keeps creation off the critical path. Strict Mode's
> rehearsal is exactly the safety property the hook exploits: create in the
> effect setup, publish via `setState`, dispose in the effect cleanup.
>
> **State machine (accepted).** One `useState<{definition, session}>` record.
> The render phase selects a session only while the record's definition is
> the current prop and the session's `status !== 'disposed'` — so a
> definition-replacement render unpublishes the old session *before* any
> effect runs (contract 3), and `undefined` is the only other value
> (contract 2). The per-definition effect creates the session, publishes it,
> and its cleanup disposes that exact session. Definition changes run
> cleanup-before-setup, so the old session is disposed before the fresh one
> is created; creation is synchronous, so no stale result can race a newer
> generation.
>
> **Rejected (per plan).** Lazy `useState` creation (render-phase side
> effect; Strict Mode's double render leaks the rehearsal session),
> timer/delayed disposal, `GameView` terminating disposal, reviving disposed
> sessions, session creation on every render, implicit asset loading.
>
> **Testing seam.** `useOwnedGameSession(definition, create)` is exported
> from `src/react/useGameSession.ts` only (never from the `rn-gamekit/react`
> barrel). Node has no `requestAnimationFrame`, so `createGameSession`'s
> default driver throws in the test runner; tests inject
> `createGameSessionWithDriver` + the local `ManualFrameDriver` and require a
> stable factory identity across renders.

### T9.1 — Create the RED ownership and Strict Mode tests

Write behavioral tests against the public React entry before implementing the
hook.

- [x] Initial render exposes `undefined` and never exposes a half-created
      session.
- [x] The committed owner publishes one idle live session for the definition.
- [x] Passing that session to `GameView` starts it through the existing binding
      rather than through the hook.
- [x] Re-rendering with the same definition preserves strict session identity
      and creates no second session.
- [x] Re-rendering with a different definition first removes the old session
      from the rendered `GameView`, then disposes it exactly once, then
      publishes a fresh session.
- [x] Returning to the first definition creates a new session rather than
      reviving the disposed one.
- [x] Owner unmount disposes the current session exactly once.
- [x] Repeated cleanup remains idempotent.
- [x] React Strict Mode's development setup/cleanup rehearsal never publishes
      a disposed session and never causes `GameView` to start one.
- [x] Every Strict Mode-created session is either the current published owner
      or is disposed exactly once.
- [x] A creation error reaches a React error boundary or another explicitly
      documented error path; it is never swallowed or logged as success.
- [x] A stale creation result cannot replace a newer definition generation.
- [x] Hook use introduces no recurring timer, frame callback, commit listener,
      or native asset handle by itself.

Use an internal injectable creator only if required to count lifecycle events.
Do not expose that testing seam from `rn-gamekit/react`.

### T9.2 — Implement the owned-session state machine

Implement the smallest internal owner that satisfies T9.1.

- [x] Create the session during the selected commit-phase lifecycle, never as
      an irreversible render side effect.
- [x] Track the definition identity and an internal monotonically increasing
      generation.
- [x] Publish state immutably; do not mutate a React state record in place.
- [x] Return a session only when its definition and generation match the
      current request and its status is not `disposed`.
- [x] Invalidate stale ownership before releasing the old resource.
- [x] Dispose each created session exactly once across normal replacement,
      Strict Mode rehearsal, error, and unmount paths.
- [x] Prevent a late state update after unmount.
- [x] Preserve the original thrown `Error` and its cause when session creation
      fails.
- [x] Keep the hook independent from React Native, Skia, Gesture Handler,
      Reanimated, and asset decoding except for its public React entrypoint.
- [x] Add complete JSDoc describing ownership, initial `undefined`, definition
      identity, Strict Mode behavior, asset readiness, and imperative
      alternatives.

Do not make `GameSession.dispose()` tolerant of invalid use to make these tests
pass. The hook must honor the existing terminal lifecycle contract.

### T9.3 — Verify integration with `GameView` and pointer input

The hook and the presentation binding must compose without duplicating
lifecycle work.

- [x] Mount `useGameSession()` with `GameView` and prove the session starts once
      after binding.
- [x] Unmount the tree and prove pointer ownership is cancelled, presentation
      unsubscribes, the session pauses if still live, and the owner eventually
      disposes it once.
- [x] Replace the definition during an active pointer and prove the old pointer
      cannot dispatch into the replacement session.
- [x] Replace the definition while running and prove no old frame, renderer,
      action name, or viewport reaches the new generation.
- [x] Background and foreground the mounted owner; retain the existing
      pause/resume policy without reviving a disposed session (covered by the
      existing bindAppLifecycle suite plus the pause-not-dispose ownership
      tests here; no device run in this task).
- [x] Confirm the hook creates no additional Skia Canvas, Reanimated mapper,
      pointer sampler, or React render at simulation frequency.
- [x] Confirm `GameView` still accepts an imperatively created session and
      still does not dispose it.

Do not reuse the playground's `SurfaceController` as the hook implementation.
It solves multi-game persistent-surface retirement and is deliberately more
complex than a conventional screen owner.

### T9.4 — Export and package the public hook

Make the new API available without changing the native-free root contract.

- [x] Export `useGameSession` and its intentionally public types from
      `packages/gamekit/src/react.ts`.
- [x] Do not export it from the headless `rn-gamekit` root.
- [x] Confirm `import 'rn-gamekit'` still evaluates no React, React Native,
      Skia, Gesture Handler, Reanimated, or Worklets module.
- [x] Confirm `import { useGameSession } from 'rn-gamekit/react'` resolves in
      source, built module, TypeScript declaration, Metro, and package tarball
      paths.
- [x] Inspect source maps and declarations for accidental internal test types
      or absolute machine paths.
- [x] Add the hook to the package changelog under the next unreleased version;
      do not rewrite the published `0.1.0` entry.

### T9.5 — Rewrite the canonical paddle tutorial fixture

The documentation source fixture is the primary proof that the beginner path
is real.

- [ ] Export the immutable `paddleGame` definition directly from
      `apps/playground/src/docs-examples/paddle-tutorial/game.ts`.
- [ ] Remove the tutorial-only `createPaddleSession()` factory if no other
      supported example needs it.
- [ ] Add a compile-tested React example that calls
      `useGameSession(paddleGame)` and handles the initial `undefined` state.
- [ ] Remove `useState`, the manual disposal `useEffect`, and unused imports
      from that conventional example.
- [ ] Keep the deterministic headless tutorial test on
      `createGameSessionWithDriver`; tests remain imperative owners and must
      dispose their sessions explicitly.
- [ ] Add a lifecycle test proving the rendered tutorial uses the hook-owned
      session rather than a second manually created session.
- [ ] Ensure the example contains no per-frame React state or renderer-side
      gameplay mutation.

### T9.6 — Update playground and reference examples selectively

Audit every session creation call site rather than applying a blind search and
replace.

- [ ] Migrate ordinary standalone React examples to `useGameSession()`.
- [ ] Keep headless tests and benchmarks on imperative session creation and
      explicit disposal.
- [ ] Keep the persistent `PlaygroundShell`, neutral session,
      `SurfaceController`, asset-ready session construction, and Performance
      Lab attachment on their explicit ownership model.
- [ ] Add or update comments explaining why those advanced owners do not use
      the convenience hook.
- [ ] Confirm Sprite Field still creates no gameplay session before its asset
      lease is ready.
- [ ] Confirm Brick Breaker and Bootstrap reopen through fresh shell-owned
      sessions and retain Task 8's generation/retirement guarantees.
- [ ] Confirm no example ends up with both the hook and a manual owner disposing
      the same session.

The goal is one clear ownership model per call site, not universal use of the
hook.

### T9.7 — Rewrite user documentation

Update documentation only after the implementation and examples pass their
tests. Follow the approved structure and naming in `doc-structure.md`: the
brand is “React Native Gamekit” or “Gamekit,” while code imports use
`rn-gamekit`.

- [ ] Rewrite the mount step in
      `apps/docs/content/docs/getting-started/create-your-first-game.mdx` to use
      the exact compile-tested hook fixture.
- [ ] Remove the tutorial's manual `useState`/`useEffect` ownership boilerplate
      and remove its session-factory appendix.
- [ ] Explain the initial `undefined` state in one concise sentence and show a
      deliberate fallback rather than hiding it.
- [ ] Update `apps/docs/content/docs/concepts/game-definition.mdx` with the
      three ownership layers: imperative owner, hook owner, and borrowed
      `GameView`.
- [ ] Update `apps/docs/content/docs/reference/brick-breaker.mdx` so its normal
      standalone snippet uses the hook while the playground-shell section
      accurately describes explicit controller ownership.
- [ ] Update `packages/gamekit/README.md` so its shortest React example uses
      `useGameSession` and imports from `rn-gamekit/react`.
- [ ] Update the root `README.md` React surface description and package name
      references where needed.
- [ ] Add `useGameSession` to the planned React Hooks documentation page, or
      create that page only if the corresponding `doc-structure.md` navigation
      milestone is being executed in this task.
- [ ] Document that definitions normally live at module scope.
- [ ] Document that callers must not dispose hook-owned sessions.
- [ ] Document that `GameView` pauses but does not dispose borrowed sessions.
- [ ] Document that asset-backed games mount their session-owning child only
      after `useGameAssets()` is ready.
- [ ] Preserve an imperative ownership example for headless/custom use.
- [ ] Audit the public docs for stale `react-native-gamekit` imports and use the
      published package name `rn-gamekit` everywhere in code.
- [ ] Verify all relative links and navigation entries touched by the rewrite.

Every changed page must keep its page-action block, omit a duplicate body H1,
use active reader-focused language, and wrap prose at 80 characters where the
format permits.

### T9.8 — Update agent workflows and API guidance

Agents must choose ownership from context rather than copying cleanup code
into every component.

- [ ] Update the project-local game-authoring skill or canonical workflow that
      creates React game screens.
- [ ] Prescribe `useGameSession(definition)` for conventional mounted screens.
- [ ] Prescribe `createGameSession()` plus `try/finally` disposal for headless
      scripts, tests, and non-React owners.
- [ ] Prescribe explicit controller ownership for persistent surfaces, session
      swapping, or asset-readiness orchestration.
- [ ] Add a rejection rule for combining hook ownership with manual
      `session.dispose()`.
- [ ] Add a rejection rule for creating `defineGame()` or sessions during every
      component render.
- [ ] Add a rejection rule for delayed disposal using timers or animation
      frames.
- [ ] Include one small copyable hook example and one imperative test example.

Do not duplicate the same guidance across unrelated skills. Update the
canonical game-development workflow and link to it where appropriate.

### T9.9 — Verification and release gate

Run focused checks throughout implementation, then the complete release gate.

- [ ] Hook unit and Strict Mode tests pass.
- [ ] Mounted `GameView`/pointer/lifecycle integration tests pass.
- [ ] Type fixtures pass, including expected failures.
- [ ] Package and playground lint pass.
- [ ] Package, playground, and docs typechecks pass.
- [ ] Package and playground test suites pass.
- [ ] Coverage remains at or above the repository threshold for every new
      executable hook/ownership module.
- [ ] Package build passes.
- [ ] `pnpm pack:inspect` includes the hook module and declarations under the
      `rn-gamekit/react` entry.
- [ ] A normal Node import of `rn-gamekit` remains native-free.
- [ ] The Expo playground exports successfully.
- [ ] The Fumadocs production build succeeds and all changed links resolve.
- [ ] `git diff --check` passes.
- [ ] A development build under React Strict Mode mounts, runs, backgrounds,
      foregrounds, and unmounts the tutorial without a disposed-session error.
- [ ] A physical-device smoke check confirms the paddle still receives pointer
      input after the ownership rewrite.

## Rejected implementations

The execution agent must reject the following shortcuts:

1. **Hide the existing two lines in a hook unchanged.** A lazy state-created
   resource plus irreversible effect cleanup is not a proven Strict Mode
   lifecycle.
2. **Make `GameView` always dispose its `game` prop.** The view borrows sessions
   and is used by persistent and imperative owners.
3. **Use a timer to distinguish Strict Mode cleanup from a real unmount.** Time
   does not establish ownership.
4. **Return the previous session while creating a replacement.** That publishes
   stale definition, renderer, input, and viewport types together.
5. **Revive a disposed session.** `dispose()` remains terminal.
6. **Create the session on every render.** Session identity must be stable.
7. **Make the hook load assets implicitly.** Asset readiness remains explicit
   in this task.
8. **Migrate the persistent playground shell to the simple hook.** Its
   acknowledged retirement and atomic surface-slot responsibilities are
   intentionally different.
9. **Remove imperative session creation from tests.** Headless deterministic
   ownership remains a first-class API.
10. **Document behavior that has only a type fixture.** Lifecycle claims require
    executable mounted tests.

## Recommended execution order

1. T9.0: verify React behavior and freeze the call-site/type contract.
2. T9.1: establish RED ownership and Strict Mode tests.
3. T9.2: implement the minimal owned-session state machine.
4. T9.3: verify `GameView`, pointer, replacement, and app lifecycle composition.
5. T9.4: export and inspect the package surface.
6. T9.5–T9.6: migrate the canonical fixture and selected examples.
7. T9.7–T9.8: rewrite user and agent documentation from verified examples.
8. T9.9: run the complete automated and native acceptance gate.

Keep commits attributable. A useful sequence is:

```text
test: define react-owned game session lifecycle
feat: add strict-mode-safe useGameSession hook
test: cover GameView and pointer ownership integration
refactor: migrate canonical game session examples
docs: teach react-owned and imperative session lifecycles
test: complete game session ownership release gate
```

## Completion criteria

Task 9 is complete only when all of the following are true:

- [ ] A conventional React game screen creates and disposes its session through
      `useGameSession()` without a manual cleanup effect.
- [ ] The hook never returns a disposed or definition-mismatched session.
- [ ] Strict Mode setup/cleanup rehearsal is executable and green.
- [ ] Same-definition rerenders preserve session identity.
- [ ] Definition replacement and owner unmount dispose every created session
      exactly once.
- [ ] `GameView` remains a borrowed presenter and never terminally disposes an
      imperative session.
- [ ] Asset-backed examples preserve the ready-before-session boundary.
- [ ] The paddle tutorial source, tests, Fumadocs page, package README, and API
      guidance all show the same verified contract.
- [ ] Headless and advanced persistent-surface ownership remain documented and
      functional.
- [ ] The hook is present in the built `rn-gamekit/react` entry and absent from
      the native-free root entry.
- [ ] Automated gates pass, and remaining device-only evidence is marked
      honestly rather than inferred from type or simulator tests.

Do not mark the task complete because the manual `useEffect` disappeared from
one snippet. Completion requires a coherent ownership contract across React,
the runtime, examples, package exports, documentation, and Strict Mode.
