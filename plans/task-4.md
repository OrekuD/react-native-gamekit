# Task 4: Stack-free playground shell and Zustand app state

## Objective

Remove the playground's native stack navigator so full-screen game gestures
cannot trigger iOS interactive-pop navigation. Replace it with one small
Zustand-owned shell state that conditionally mounts the home catalog or the
selected game:

```text
PlaygroundShell
  -> currentGameId === null
     -> HomeScreen
  -> currentGameId !== null
     -> fade-in wrapper
        -> selected game screen
```

This is a playground-only refactor. It must not add Zustand, navigation state,
or screen concepts to the public GameKit package.

## Problem being fixed

The current `createNativeStackNavigator()` gives every pushed game screen an
iOS interactive back gesture. A gameplay swipe beginning near the left edge
can therefore start a native pop transition instead of remaining game input.
Disabling the gesture per screen would leave the playground coupled to a stack
whose history model it does not need.

Task 4 removes the stack and its gesture recognizer altogether. The playground
has only one shell-level choice: show the catalog or show one game. Navigation
inside an individual game can be designed separately in a later task.

## Locked decisions

- Remove `NavigationContainer`, `createNativeStackNavigator`, route parameter
  types, `useFocusEffect`, and all React Navigation props from the playground.
- Remove the direct playground dependencies on `@react-navigation/native`,
  `@react-navigation/native-stack`, and `react-native-screens` when no remaining
  import requires them.
- Add `zustand` to `apps/playground` only. Do not add it to
  `packages/gamekit`, its peer dependencies, or the workspace root.
- Keep `GestureHandlerRootView`; GameKit pointer input still depends on Gesture
  Handler even though shell navigation no longer does.
- Store only low-frequency shell state in Zustand. Never store a `GameSession`,
  render frame, pointer position, animation shared value, Skia value, or other
  live gameplay data there.
- Keep exactly one selected game id or `null`. Do not recreate a history stack,
  route objects, route parameters, nested routes, or generic navigation API.
- Selecting a game unmounts the home screen and mounts the game screen. The
  game fades in over the shell background; the home screen must not remain
  interactive or accessible behind it.
- Closing a game unmounts it immediately, disposes its owned session, and
  returns to a fresh home screen. Do not preserve a hidden live game.
- Run the fade on the UI thread with the already installed Reanimated package.
  Respect the system Reduce Motion setting and do not drive opacity through
  per-frame React state.
- A visible back link remains part of each playground game screen. Android's
  hardware back button and iOS VoiceOver's accessibility escape action must
  perform the same `closeGame()` operation.
- Internal menus, settings, pause screens, or navigation owned by a game are
  explicitly deferred. This shell refactor must not invent that API.

## State and catalog contract

Use one canonical game id union shared by the catalog, store, and screen
registry:

```ts
type PlaygroundGameId = 'brick-breaker' | 'bootstrap'

interface PlaygroundState {
  readonly currentGameId: PlaygroundGameId | null
  readonly openGame: (id: PlaygroundGameId) => void
  readonly closeGame: () => void
}
```

The exact names may follow the repository's naming conventions, but preserve
these semantics:

- initial state is the home catalog (`currentGameId: null`);
- `openGame(id)` selects one known game;
- selecting the current game is idempotent;
- `closeGame()` is idempotent and returns to `null`;
- state actions create new state objects and never mutate existing state;
- invalid ids are impossible from TypeScript call sites and fail clearly if an
  untyped JavaScript caller reaches the boundary.

Keep catalog metadata in one module instead of duplicating ids in
`HomeScreen`, the store, and the shell. Derive `PlaygroundGameId` from an
immutable id list or typed registry. Keep component selection in the shell so
the state store remains plain, serializable data and has no React component
references.

For isolated tests, export a store factory in addition to the app's singleton
hook/store. Every test must create a fresh store rather than resetting shared
module state.

## Shell and transition contract

`App.tsx` remains responsible only for global providers and the status bar:

```text
GestureHandlerRootView
  -> SafeAreaProvider
     -> PlaygroundShell
     -> StatusBar
```

`PlaygroundShell` reads `currentGameId` with a narrow Zustand selector and
chooses the active surface. It must:

- render a full-size, opaque shell background so switching surfaces cannot
  flash white;
- render `HomeScreen` only when no game is selected;
- resolve the selected id through an exhaustive typed screen registry;
- wrap only the newly mounted game in an absolute/full-size
  `Animated.View` using a short opacity-only `FadeIn`;
- configure the animation to follow the system Reduce Motion preference;
- avoid JS timers, delayed store writes, animation state in Zustand, and
  cross-thread callbacks merely to complete navigation;
- expose the game surface as an accessibility modal and support
  `onAccessibilityEscape={closeGame}`;
- register one Android `BackHandler` listener while a game is selected, return
  `true` after closing the game, and return `false` on the home screen so the OS
  can exit normally;
- mount exactly one game screen at a time and use a stable key derived from its
  game id.

The initial target is an opacity-only transition of roughly 150–200 ms. Avoid
translation, scale, spring, or swipe-driven shell transitions: gameplay should
feel stationary and should not suggest that an interactive back gesture still
exists.

## Game-screen lifecycle contract

Game screens become ordinary components with a small playground prop:

```ts
interface PlaygroundGameScreenProps {
  readonly onExit: () => void
}
```

The shell supplies `closeGame` as `onExit`. Screens must not import the Zustand
store directly unless a later requirement genuinely needs shell state. This
keeps example games portable and makes their exit behavior easy to test.

- Replace `navigation.goBack()` with `onExit()`.
- Remove `NativeStackScreenProps`, `PlaygroundStackParamList`, and navigation
  imports.
- Remove the Brick Breaker `useFocusEffect`. Conditional mounting is now the
  visibility boundary: `GameView` starts/pauses while mounted and its existing
  `AppState` binding handles app backgrounding.
- Keep each game session outside Zustand and scoped to its screen lifetime.
- Brick Breaker creates one session when its screen mounts and disposes it once
  when the screen finally unmounts.
- Replace the module-level Bootstrap session with a session factory and give
  `BootstrapGameScreen` the same create-on-mount/dispose-on-unmount ownership.
  Controls must address that owned session rather than a module singleton.
- Closing and reopening a game must create a fresh session with initial game
  state. No paused session or render listener may survive beneath the catalog.
- Retain `GameView` edge-to-edge. Apply safe-area insets only to React overlay
  controls, consistent with the Task 3 viewport policy.

## TDD execution

### 1. Store contract tests

- [x] Add failing tests for the isolated Zustand store factory before the app
  singleton is wired.
- [x] Test the home initial state, opening each declared game, idempotent
  repeated selection, switching a selected id, idempotent close, and fresh
  isolation between store instances.
- [x] Add compile-time coverage proving `openGame()` accepts only canonical
  `PlaygroundGameId` values.
- [x] Add a runtime test for an invalid id reaching the untyped boundary.
- [x] Confirm store snapshots contain only serializable shell data and action
  functions—never a game session, component, frame, or animation object.

### 2. Dependencies and obsolete navigation surface

- [x] Add `zustand` to `apps/playground/package.json` with pnpm and update the
  shared lockfile.
- [x] Remove the three unused navigation dependencies after all navigation
  imports are gone.
- [x] Delete `apps/playground/src/navigation/types.ts` and the empty navigation
  directory.
- [x] Verify no `NavigationContainer`, stack navigator, navigation prop,
  `useFocusEffect`, `navigate`, or `goBack` reference remains in the playground.
- [x] Regenerate/update the Expo prebuild output through the normal non-clean
  prebuild path so native autolinking no longer includes removed packages.

### 3. Catalog and Zustand shell state

- [x] Extract immutable game ids and home-list metadata into one typed catalog
  module.
- [x] Add the isolated store factory, app singleton, selectors, `openGame`, and
  `closeGame` under a focused playground state module.
- [x] Keep selectors narrow: `HomeScreen` needs only `openGame`, while the shell
  needs only `currentGameId` and `closeGame`.
- [x] Make the active screen registry exhaustive so adding a catalog id without
  a corresponding game screen fails typecheck.
- [x] Keep gameplay state and screen components out of the store.

### 4. Stack-free `PlaygroundShell`

- [x] Reduce `App.tsx` to providers, `PlaygroundShell`, and `StatusBar`.
- [x] Implement conditional home/game mounting from `currentGameId` with an
  opaque full-screen background.
- [x] Fade a newly selected game from opacity `0` to `1` on the Reanimated UI
  thread without updating React on animation frames.
- [x] Respect Reduce Motion and verify the screen appears without an artificial
  delay when motion is disabled.
- [x] Add Android hardware-back handling and iOS accessibility escape behavior.
- [x] Ensure only the currently selected surface can receive pointer and
  accessibility events.

### 5. Screen and session ownership refactor

- [x] Change `HomeScreen` to call the typed `openGame(id)` action rather than a
  navigation prop.
- [x] Change both game screens to receive `onExit` and remove every React
  Navigation type/hook.
- [x] Remove navigation-focus start/pause logic from Brick Breaker; do not
  replace it with another visibility effect.
- [x] Refactor Bootstrap to create, use, and dispose a screen-owned session.
- [x] Verify Brick Breaker still disposes its screen-owned session exactly once.
- [x] Ensure rapid open/close/reopen cycles cannot keep stale frame callbacks,
  input ownership, HUD subscriptions, or AppState listeners alive.
- [x] Keep game surfaces independent from safe-area padding and apply insets to
  overlays only.

### 6. Gesture regression verification

- [x] On an iPhone simulator and a physical iPhone if available, start a drag
  at the extreme left edge and continue horizontally through Brick Breaker.
  The paddle must receive the gesture and the home screen must never appear.
- [x] Repeat left-edge drags slowly and quickly, including an active pointer
  followed by cancellation, without a native pop transition or frozen input.
- [x] Verify the same edge gestures in portrait and landscape.
- [x] Verify the visible back link returns home exactly once and the next game
  opens with a fresh session.
- [x] Verify Android hardware back closes an active game, while hardware back
  from home retains the platform's normal app-exit behavior.
- [ ] Verify VoiceOver's two-finger scrub/accessibility escape closes the game
  and returns focus to a sensible home element.

### 7. Verification and documentation

- [x] Update playground comments/readmes that still describe stack routes,
  pushed screens, or navigation focus.
- [x] Run `pnpm lint`, `pnpm typecheck`, playground tests, and full workspace
  tests.
- [x] Run `pnpm build:playground` and confirm the Expo iOS export succeeds.
- [x] Run `pnpm pack:inspect` to confirm this playground-only dependency change
  does not alter the published GameKit tarball or root/react entry points.
- [x] Run `git diff --check`.
- [x] Smoke-test Home -> Bootstrap -> Home -> Brick Breaker -> Home repeatedly
  on iPhone and iPad, including rotation while a game is active.
- [x] Inspect native logs for stale callback, disposed-session, Gesture Handler,
  Reanimated, or AppState errors.

## Acceptance criteria

1. The playground contains no navigation container, stack navigator, route
   types, navigation props, or React Navigation runtime dependency.
2. A full-screen or left-edge gameplay swipe cannot trigger an iOS back/pop
   gesture because no external native navigation gesture is mounted.
3. Zustand contains one typed `currentGameId` and low-frequency shell actions;
   all gameplay and presentation state remains outside it.
4. Selecting a catalog item unmounts Home, mounts exactly one game, and fades
   the game in without per-frame React work.
5. Closing a game unmounts and disposes its session before returning home;
   reopening creates clean initial state with no stale listeners or input.
6. The visible exit link, Android hardware back, and iOS accessibility escape
   all return to the catalog through the same store action.
7. Gesture Handler remains correctly initialized for GameKit input, while
   removed navigation packages are absent from playground imports and direct
   dependencies.
8. Phone/iPad portrait, landscape, resize, and repeated entry/exit checks pass
   without a flash, native pop animation, hidden running game, or runtime
   error.
9. The published `react-native-gamekit` package API and tarball are unchanged by
   this playground-only refactor.

## Explicitly out of scope

- a replacement router, navigation history, URLs, deep links, or route params;
- swipe-to-dismiss, interactive transitions, shared-element transitions, or a
  custom back gesture;
- persistence of the selected game across launches or development reloads;
- storing or inspecting game-session state in Zustand;
- pause menus, settings screens, overlays, or navigation internal to a game;
- changes to GameKit's future game-owned navigation API;
- unrelated Task 3 engine feedback, except where removing focus navigation and
  fixing game-screen ownership are directly required by this refactor.

## Completion handoff

When implementation is complete:

1. mark only directly verified checkboxes as complete;
2. record the chosen Zustand version and the removed direct dependencies;
3. record the fade duration and Reduce Motion behavior;
4. include exact simulator/device configurations used for left-edge gesture,
   Android back, accessibility escape, rotation, and repeated-entry testing;
5. do not claim the iOS gesture regression fixed until an edge-origin gameplay
   drag has been exercised on a native build.

## Completion handoff — Task 4 (implemented 2026-08-07)

### Dependencies
- Added `zustand@5.0.14` to `apps/playground` only (peer-compatible with
  React 19). Not added to `packages/gamekit`, its peers, or the workspace root.
- Removed `@react-navigation/native`, `@react-navigation/native-stack`, and
  `react-native-screens` from `apps/playground` dependencies after deleting the
  navigation module. `pnpm expo:prebuild` (non-clean) regenerated native
  projects; `react-native-screens` is absent from `ios/Podfile.lock`.
- The published `react-native-gamekit` package, root/react entry points, and
  tarball are unchanged (verified via `pnpm pack:inspect`).

### Shell behavior
- `App.tsx` is providers only: `GestureHandlerRootView` -> `SafeAreaProvider`
  -> `PlaygroundShell` -> `StatusBar`.
- `PlaygroundShell` reads only `currentGameId` (and `closeGame`); the catalog
  and game screens mount behind an opaque `#080b12` background.
- Fade-in is opacity-only, 180 ms (`FADE_DURATION_MS`), driven by a Reanimated
  shared value on the UI thread; no JS timers, no per-frame React work, no
  Zustand animation state. `useReducedMotion()` disables the fade entirely
  (opacity jumps to 1 with no artificial delay).
- The game surface is `accessibilityViewIsModal` with
  `onAccessibilityEscape={closeGame}`. Android `BackHandler` closes an active
  game (returns `true`) and is absent on the home screen so the OS exits
  normally.
- A stable `key={currentGameId}` remounts the game surface on direct game
  switches, giving a fresh fade and a fresh session.

### Simulator/device verification
- iOS edge-gesture regression (iPhone 17 Pro Max, iOS 26.5, native dev build):
  slow (1.5 s) and quick (200 ms) drags starting at the extreme left edge
  through Brick Breaker in portrait and landscape — the paddle receives the
  gesture, the home catalog never appears, zero client errors. Maestro flow:
  `t4-edge-gesture.yaml`.
- Repeated entry/exit smoke (iPhone): Home -> Bootstrap -> Home -> Brick
  Breaker -> play -> landscape -> back -> Home -> Bootstrap -> landscape ->
  back -> Home, plus rotation while games are active. Maestro flow:
  `t4-repeat.yaml`.
- iPad Pro 11-inch (M5): same entry flow plus left-edge drags in portrait and
  landscape and back-link return. Zero client errors.
- Android (emulator `React_Native_Showcase_API_35`, pixel_6, API 35, debug
  build): hardware back closes an active game and returns to the catalog;
  reopening starts a fresh ready scene; hardware back from home exits to the
  launcher (OS default). Maestro flow: `t4-android-back.yaml`.
- Native logs on both platforms show no stale-callback, disposed-session,
  Gesture Handler, Reanimated, or AppState errors (only the benign Reanimated
  `LayoutMetrics` warning during the mount fade).

### Not live-verified
- VoiceOver two-finger scrub/accessibility escape: `onAccessibilityEscape`
  and `accessibilityViewIsModal` are wired and typechecked, but driving
  VoiceOver is not scriptable with the available tooling. The checkbox is left
  unchecked per the "mark only directly verified" rule.
- Active-pointer cancellation mid-gesture is covered by the unit-level
  `PointerBinding`/input-buffer cancellation tests rather than a live gesture
  driver.
- Physical iPhone/Android hardware was not available; simulators/emulator were
  used for all gesture testing.
