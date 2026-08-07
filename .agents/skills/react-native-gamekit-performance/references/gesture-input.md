# Gesture and game-input guide

## Version gate

This repository currently installs React Native Gesture Handler 2.32.0. Generate game code with the RNGH 2 builder API:

```ts
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const pan = Gesture.Pan()
  .onUpdate((event) => {
    pointerX.set(event.absoluteX);
    pointerY.set(event.absoluteY);
  })
  .onFinalize(() => {
    isDragging.set(false);
  });
```

RNGH 3 replaces this with hooks such as `usePanGesture`, changes lifecycle names such as `onStart` to `onActivate`, and adds virtual detector concepts. Keep those notes as migration knowledge only. Never output RNGH 3 code until the package is deliberately upgraded.

## Root setup

Keep `GestureHandlerRootView` close to the native app root. All related gestures must be under the same topmost root. It defaults to `flex: 1`; preserve that when providing a custom style.

Nested root views are normally ignored in favor of the topmost one. A library may provide a defensive root wrapper, but GameKit should avoid surprising host hierarchy changes and document the app-level requirement.

## RNGH 2 lifecycle

- `onBegin`: recognizer entered `BEGAN`; pair cleanup with `onFinalize`.
- `onStart`: activation criteria succeeded and recognizer entered `ACTIVE`.
- `onUpdate`: high-frequency active updates.
- `onChange`: update plus incremental fields such as `changeX`/`changeY`.
- `onEnd`: an active gesture ended, failed, or was cancelled; inspect success.
- `onFinalize`: cleanup after any begun gesture, whether it activated or not.

Use `onFinalize` to clear pointer/button state so cancellations do not leave controls stuck.

RNGH 3 renames parts of this lifecycle to `onActivate`/`onDeactivate` and exposes `event.canceled`. Do not mix the callback contracts.

## Worklet execution

GestureDetector integrates with Reanimated when callbacks are worklets. Keep high-frequency updates on the UI runtime.

Callbacks directly chained in the gesture builder are recognized for workletization. If a callback is extracted or wrapped in a way the Babel plugin cannot detect, add an explicit `'worklet';` directive and verify execution context.

Do not call the simulation, React state, Zustand, analytics, audio APIs, or haptic APIs from every `onUpdate`. Write compact UI-owned values, then publish semantic commands at a controlled boundary.

## Pointer identity and coordinates

- Track each active touch by its pointer ID; event-array order may change.
- Use `absoluteX`/`absoluteY` when the detector's attached view can move or transform.
- Convert window/view points into the logical viewport once through the GameKit viewport adapter.
- Clamp or reject points in letterbox/pillarbox regions according to game policy.
- Preserve timestamps where deterministic input ordering matters.
- Handle cancel as a first-class termination path.

On Android, multi-touch pan may use a leading pointer while iOS uses a center-of-mass convention. RNGH 2 exposes `averageTouches(true)` to align Android behavior when the design needs it.

For iPad trackpads, consider `enableTrackpadTwoFingerGesture(true)` on compatible pan gestures. Test pointer type, hover, Pencil/stylus, and mouse behavior rather than assuming every pointer behaves like a finger.

## Gesture composition

Use the RNGH 2 composition primitives intentionally:

- `Gesture.Race(...)`: first activation cancels the rest.
- `Gesture.Simultaneous(...)`: gestures can remain active together, useful for pan + pinch + rotation.
- `Gesture.Exclusive(...)`: ordered priority, useful for double tap before single tap.

For different detector trees use external relations such as:

- `requireExternalGestureToFail`
- `blocksExternalGesture`
- `simultaneousWithExternalGesture`

Never reuse one gesture instance in multiple `GestureDetector`s. Memoize stable gesture definitions where possible to avoid repeated native handler updates, but verify closure dependencies and workletization.

## Manual gesture policy

Use `Gesture.Manual()` only when GameKit needs raw multi-pointer tracking or custom activation rules that built-in gestures cannot express. It does not automatically fail when all pointers lift; explicitly drive its state with the event's state manager and always clean up cancel/up paths.

Prefer built-in Pan/Pinch/Rotation recognizers for their platform behavior and velocity calculations. Every continuous RNGH 2 gesture can expose touch events or manual activation when additional control is required.

## Navigation conflict policy

A fullscreen game surface often uses edge swipes as input. The host navigator may also interpret them as interactive back gestures, cancelling game input or leaving state inconsistent.

For the playground, keep game selection in its own shell and transition by app state so no native back gesture owns the game surface.

For consumer apps:

- document that the host screen may need its interactive back gesture disabled while gameplay is active
- offer an explicit game pause/exit action
- never modify a consumer's global navigator from inside GameKit
- test cancellations caused by app/system gestures

This boundary is host configuration, not engine navigation.

## Detector hierarchy

In RNGH 2, `GestureDetector` attaches to the first native view in its subtree. If functional components insert collapsable wrapper views, keep the relevant native child from being collapsed. Use `collapsable={false}` when required.

Do not attach a detector per sprite for general Canvas hit testing. Prefer one surface detector plus GameKit hit testing in logical coordinates. Use native overlay controls when accessibility or platform semantics require individual elements.

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
