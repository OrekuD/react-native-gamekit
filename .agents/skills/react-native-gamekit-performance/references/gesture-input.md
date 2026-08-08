# Gesture and game-input guide

## Version gate

This repository installs React Native Gesture Handler **3.1.0** (upgraded from
2.32.0 on 2026-08-08). Generate game code with the RNGH 3 hook API and the
global `GestureStateManager`:

```ts
import { GestureDetector, useManualGesture } from 'react-native-gesture-handler';

const gesture = useManualGesture({
  onTouchesDown: () => {
    'worklet';
    GestureStateManager.activate();
    for (const touch of event.changedTouches) {
      runOnJS(beginOnJS)(touch.id, touch.x, touch.y);
    }
  },
});
```

RNGH 2 builder code (`Gesture.Pan().onUpdate(...)`, `Gesture.Manual()`,
`stateManager` arguments) is legacy in 3.x; its types are exported with a
`Legacy` prefix. Never output RNGH 2 builder code in this repository.

## Root setup

Keep `GestureHandlerRootView` close to the native app root. All related
gestures must be under the same topmost root. It defaults to `flex: 1`;
preserve that when providing a custom style.

Nested root views are normally ignored in favor of the topmost one. A library
may provide a defensive root wrapper, but GameKit should avoid surprising host
hierarchy changes and document the app-level requirement.

## RNGH 3 lifecycle

- `onBegin`: recognizer entered `BEGAN`; pair cleanup with `onFinalize`.
- `onActivate` (was `onStart`): activation criteria succeeded, recognizer
  `ACTIVE`.
- `onUpdate`: high-frequency active updates; carries `change*` fields (the old
  `onChange` was merged into it).
- `onDeactivate` (was `onEnd`): the active gesture ended, failed, or was
  cancelled.
- `onFinalize`: cleanup after any begun gesture, whether it activated or not.
  The event carries `canceled` (replaces the old `success` boolean; the logic
  is inverted — `canceled: true` == old `success: false`).

`state`/`oldState` are no longer on events; track state through callbacks.
Use `onFinalize` to clear pointer/button state so cancellations do not leave
controls stuck.

## Touch callbacks

Low-level touch events use `onTouchesDown`, `onTouchesMove`, `onTouchesUp`,
and `onTouchesCancel` (**note the renamed `onTouchesCancelled` → `onTouchesCancel`**).
Each receives a `GestureTouchEvent` with `changedTouches`, `allTouches`, and
`numberOfTouches`. Track touches by `touch.id` — array order is not stable.

**State management changed:** `stateManager` is no longer passed to touch
callbacks. Use the global `GestureStateManager` (`activate()`, `end()`,
`fail()`, `cancel()`) instead.

## Worklet execution

RNGH 3 callbacks passed inline in the hook's configuration object are
**automatically workletized** by the Worklets Babel plugin. If a callback is
extracted or wrapped in `useCallback`/`useMemo` (which breaks auto-detection),
add an explicit `'worklet';` directive and verify execution context — GameKit's
`GamePointerInput` does exactly this and must keep the directives.

SharedValues may be passed into gesture configuration and react without
re-renders. Thread control is explicit per gesture: `disableReanimated: true`
turns Reanimated integration off entirely; `runOnJS: true` routes callbacks to
the JS thread. Keep high-frequency updates on the UI runtime.

Do not call the simulation, React state, Zustand, analytics, audio APIs, or
haptic APIs from every `onUpdate`. Write compact UI-owned values, then publish
semantic commands at a controlled boundary.

## Pointer identity and coordinates

- Track each active touch by its pointer ID; event-array order may change.
- Use `absoluteX`/`absoluteY` when the detector's attached view can move or transform.
- Convert window/view points into the logical viewport once through the GameKit viewport adapter.
- Clamp or reject points in letterbox/pillarbox regions according to game policy.
- Preserve timestamps where deterministic input ordering matters.
- Handle cancel as a first-class termination path.

On Android, multi-touch pan may use a leading pointer while iOS uses a
center-of-mass convention. Consider `averageTouches` where the design needs
Android/iOS parity. For iPad trackpads, consider two-finger pan support. Test
pointer type, hover, Pencil/stylus, and mouse behavior rather than assuming
every pointer behaves like a finger.

## Gesture composition (RNGH 3)

- `useCompetingGestures(...)` (was `Gesture.Race(...)`): first activation cancels the rest.
- `useSimultaneousGestures(...)` (was `Gesture.Simultaneous(...)`): gestures stay active together, useful for pan + pinch + rotation.
- `useExclusiveGestures(...)` (was `Gesture.Exclusive(...)`): ordered priority, useful for double tap before single tap.

Cross-detector relations were renamed: `simultaneousWithExternalGesture` →
`simultaneousWith`, `requireExternalGestureToFail` → `requireToFail`,
`blocksExternalGesture` → `block`.

Never reuse one gesture instance in multiple `GestureDetector`s. Memoize stable
gesture definitions where possible to avoid repeated native handler updates,
but verify closure dependencies and workletization (hooks return stable
instances; keep wrapped callbacks explicitly workletized).

## Manual gesture policy

Use `useManualGesture()` only when GameKit needs raw multi-pointer tracking or
custom activation rules that built-in gestures cannot express. It does not
automatically fail when all pointers lift; drive its state explicitly with the
global `GestureStateManager` and always clean up cancel/up paths.

GameKit's `GamePointerInput` pattern (manual gesture, activate on touch-down,
`runOnJS` forwarding, explicit end on last lift) is the canonical example.
`ForceTouch` is not available in the hook API.

## Navigation conflict policy

A fullscreen game surface often uses edge swipes as input. The host navigator
may also interpret them as interactive back gestures, cancelling game input or
leaving state inconsistent.

For the playground, keep game selection in its own shell and transition by app
state so no native back gesture owns the game surface.

For consumer apps:

- document that the host screen may need its interactive back gesture disabled while gameplay is active
- offer an explicit game pause/exit action
- never modify a consumer's global navigator from inside GameKit
- test cancellations caused by app/system gestures

This boundary is host configuration, not engine navigation.

## Detector hierarchy

In RNGH 3, `GestureDetector` disrupts native view hierarchies. Components that
rely on the view hierarchy (notably SVG) must use the two new detectors:
`InterceptingGestureDetector` with a `VirtualGestureDetector` **descendant**
(the virtual detector has to be a descendant of the intercepting one).

Keep `collapsable={false}` on the native child the detector attaches to when
functional wrappers might collapse it. Do not attach a detector per sprite for
general Canvas hit testing. Prefer one surface detector plus GameKit hit
testing in logical coordinates. Use native overlay controls when accessibility
or platform semantics require individual elements.

## RNGH 2 → 3 quick reference

| RNGH 2 | RNGH 3 |
| --- | --- |
| `Gesture.Pan()` / `Gesture.Manual()` / `Gesture.Tap()` … | `usePanGesture()` / `useManualGesture()` / `useTapGesture()` … (config object) |
| `onStart` / `onEnd` | `onActivate` / `onDeactivate` |
| `onTouchesCancelled` | `onTouchesCancel` |
| `onEnd(event, success)` | `event.canceled` (inverted) |
| `onChange` | merged into `onUpdate` (`change*` fields) |
| `event.state` / `event.oldState` | removed — use callbacks |
| callback `stateManager` argument | global `GestureStateManager` |
| `Gesture.Race` / `Simultaneous` / `Exclusive` | `useCompetingGestures` / `useSimultaneousGestures` / `useExclusiveGestures` |
| `*ExternalGesture` relations | `simultaneousWith` / `requireToFail` / `block` |
| `GestureDetector` on SVG | `InterceptingGestureDetector` + descendant `VirtualGestureDetector` |
| `RectButton` / `BorderlessButton` | `Touchable` (underlayColor / activeOpacity / androidRipple); legacy buttons are `Legacy*`-prefixed |
| `PureNativeButton` | removed |

## Input performance checklist

- one or a small number of surface detectors
- no RN-runtime crossing for every move
- no object-graph capture in worklets
- no logs in move/update callbacks
- pointer samples coalesced only when semantics permit
- cancel/up always clears active state
- coordinate transform tested under scaling, rotation, safe areas, and tablet letterboxing
- simultaneous multi-touch tested on iOS and Android hardware
- navigation/system gesture conflicts tested at screen edges
