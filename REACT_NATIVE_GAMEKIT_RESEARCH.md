# React Native GameKit: research, lessons, and architectural direction

**Status:** architecture research and recommendation<br>
**Research date:** August 5, 2026<br>
**Working product name:** React Native GameKit<br>
**Scope:** a modern, approachable toolkit for building primarily 2D games for phones and tablets with React Native and Expo, with an explicit investigation into supporting 3D from the beginning.

## Executive decision

React Native GameKit should be an **Expo-first, TypeScript-first 2D game toolkit**, not a rewrite of `react-native-game-engine` and not a miniature Unity.

The recommended foundation is:

- A headless `GameSession` that owns simulation, scenes, input snapshots, commands, events, and lifecycle outside React state.
- A fixed simulation step, normally 60 Hz, with rendering interpolated independently at the device refresh rate. A 120 Hz iPad must not make a game run twice as fast.
- React Native Skia as the official 2D renderer. React mounts the game surface and renders menus/HUD; React does not reconcile every moving entity on every frame.
- Action-based input on top of React Native Gesture Handler, with touch, virtual controls, keyboard, mouse/trackpad, and future controller adapters normalized into the same game-facing vocabulary.
- First-class viewport policies for phone, iPad, Android tablet, rotation, safe areas, split view, and resizable windows.
- Expo-native asset, audio, and haptic services, wrapped behind narrow GameKit modules.
- A small public interface, deterministic headless tests, project validation, structured diagnostics, reference games, and agent skills that make correct games easier to generate than incorrect ones.
- An early **experimental React Three Fiber adapter** to prove that the core seams survive 3D. Do not promise first-class 3D in v1.

Adding official 3D from day one is feasible, but it is not merely a renderer swap. It adds a second scene model, transform model, asset pipeline, physics story, interaction model, GPU resource lifecycle, device-quality system, documentation surface, and physical-device test matrix. The planning estimate from this research is:

| Product boundary | Relative v1 scope | Recommendation |
| --- | ---: | --- |
| Excellent 2D product, 3D-compatible core seams | `1.0x` | Build this |
| 2D product plus explicitly experimental R3F adapter | roughly `1.3–1.5x` | Run as an early parallel spike; ship only if honest about support |
| 2D and 3D both official, supported v1 features | roughly `1.8–2.5x` | Do not make this the v1 promise |

These ratios are qualitative planning estimates based on added subsystems and validation work. They are not measured delivery data.

## What was researched

This document is based on four evidence sets:

1. A file-by-file read of the local legacy checkout at [`react-native-game-engine`](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine).
2. The complete upstream history available through GitHub at the research date: 66 issues and 15 pull requests, of which 17 issues and 2 pull requests were open. The repository still has substantial interest, but its last published npm version is `1.2.0` and the executable source has not seen a meaningful modernization in years. See the [upstream repository](https://github.com/bberak/react-native-game-engine), [issue tracker](https://github.com/bberak/react-native-game-engine/issues), and [npm package](https://www.npmjs.com/package/react-native-game-engine).
3. Current official React Native, Expo, React Native Skia, React Native Gesture Handler, React Three Fiber, Expo GL, and React Native Filament documentation.
4. A feasibility comparison between a Skia 2D runtime, React Three Fiber over Expo GL, and a native Filament 3D path.

No new engine implementation or device benchmark exists yet. Performance conclusions below distinguish observed legacy behavior from recommendations that still need to be proven in release builds on physical devices.

## Product north star

The product promise should be:

> Build polished 2D games for phone and tablet with the React Native and Expo tools you already know, without making React render the game loop.

The target developer should be able to:

- create a game and see a controllable player in minutes;
- understand the important concepts without first learning a full industrial ECS;
- keep normal React Native navigation, menus, forms, purchases, and platform integrations;
- build Breakout, a platformer, a top-down shooter, a card/puzzle game, or a twin-stick arena game without leaving the supported path;
- run game logic headlessly in tests;
- ask an agent to add a scene, enemy, control scheme, or gameplay rule and receive code that follows a stable project grammar;
- adapt the same game to iPhone, iPad, Android phones, and Android tablets deliberately rather than by accidental scaling.

### Non-goals for v1

- Replacing Unity, Godot, Unreal, or a native AAA engine.
- Shipping a visual level editor before the runtime and file formats have stabilized.
- A general-purpose, maximum-throughput ECS with archetype storage exposed to beginners.
- Mandatory rigid-body physics.
- Networking, rollback multiplayer, or cross-device bit-perfect determinism.
- First-class 3D, PBR, skeletal animation, and native 3D physics in the stable package.
- Full web or TV parity in v1. Skia supports those surfaces, but the product and test matrix should stay focused on iOS/iPadOS and Android phones/tablets first.
- Hiding all rendering and performance tradeoffs behind a universal abstraction.

The word “Kit” is useful here. The goal is a deep, coherent set of primitives and workflows for a bounded class of games, not every engine feature ever invented.

## The legacy engine at a glance

The old package is exceptionally small: two React components, a default renderer, a timer, a touch processor, an entrypoint, and a handwritten declaration file. Its small size is part of why it was approachable.

The public surface is centered on `GameEngine`, `GameLoop`, systems, entities, a renderer, a touch processor, a timer, `running`, `onEvent`, and React children. It exposes imperative `start`, `stop`, `swap`, and `dispatch` methods. These are documented in the [legacy README](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/README.md:189).

The execution path is:

1. `GameEngine` stores the entity map in React component state ([GameEngine.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/GameEngine.js:28)).
2. `DefaultTimer` publishes every `requestAnimationFrame` callback ([DefaultTimer.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultTimer.js:17)).
3. Each frame reduces the system list over the entity object, clears touch/event arrays, and calls `setState({ entities: newState })` ([GameEngine.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/GameEngine.js:116)).
4. `DefaultRenderer` enumerates entity keys and creates React elements for every entity with a renderer ([DefaultRenderer.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultRenderer.js:3)).
5. Raw `View` touch events feed an RxJS processor that produces `start`, `move`, `end`, `press`, and `long-press` records ([DefaultTouchProcessor.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultTouchProcessor.js:14)).

The README accurately describes the central tradeoff: it uses `setState()` about every 16 ms so React Native will diff and render the scene ([README.md](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/README.md:357)). It also honestly warns that entity-heavy games such as bullet hell will struggle ([README.md](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/README.md:218)).

### What it got right

| Legacy idea | Decision | Why |
| --- | --- | --- |
| Tiny update/draw mental model | Preserve | It is easy to teach, document, and generate with agents. |
| Entities plus reusable systems | Preserve at the product level | Composition is a strong grammar for simple games. It does not need to expose a sophisticated ECS implementation. |
| Renderer, timer, and input replaceability | Preserve as narrow module seams | The instinct was right even though the default implementations are now inadequate. |
| No mandatory physics dependency | Preserve | Many puzzle, card, board, rhythm, and arcade games do not need rigid-body physics. |
| React children over the game | Preserve | React is excellent for HUD, menus, dialogs, accessibility, navigation, and app integrations. |
| `GameLoop` as a minimal escape hatch | Preserve in spirit | A low-level session/scheduler mode is useful for custom workflows and tests. |
| Plain JavaScript object examples | Evolve | Keep authoring simple, but make contracts typed and validated. |

### What must not carry forward

| Legacy choice | Why it fails as the new foundation | Replacement |
| --- | --- | --- |
| React state is the authoritative frame store | Forces reconciliation and React element creation at frame cadence; couples simulation identity to render identity. | Headless session state plus render snapshots consumed directly by Skia. |
| Variable delta is the only time model | Device refresh, stalls, backgrounding, and 120 Hz can change gameplay and physics. | Fixed-step simulation, clamped catch-up, render interpolation, explicit background policy. |
| Entities are mutable `any` bags | Weak state ownership, invalidation surprises, poor tooling, difficult replay and tests. | Typed components/resources and immutable commands at the public boundary. |
| Arbitrary events are delivered through `setTimeout(..., 0)` | Ordering depends on macrotask/RAF scheduling and callbacks may outlive lifecycle. | Tick-scoped ordered command/event queues with explicit external notifications. |
| Scene replacement is a ref method named `swap()` | Ownership and lifecycle are unclear. | Named scenes and explicit `setScene`, `restart`, `exit`, and `dispose` operations. |
| Raw touch events are the game interface | No action mapping, cancel semantics, virtual-control composition, keyboard, mouse, or controller model. | Capability-aware input adapters producing tick snapshots of named actions. |
| RxJS is the only runtime dependency just to process touches | Large conceptual/dependency cost for a narrow default use case. | Gesture Handler adapter plus a small internal input state machine. |
| Window dimensions are cached as “screen” | Does not model safe areas, view-local coordinates, split view, orientation, resizing, camera, or logical world size. | Viewport service with explicit policies and transforms. |
| Handwritten declarations trail runtime behavior | The types create false confidence rather than safety. | TypeScript source generates declarations and contract tests compile usage examples. |
| No tests | Makes timing, lifecycle, input ordering, and compatibility regressions inevitable. | Headless unit/integration suite, reference-game E2E tests, and release-device performance gates. |

## Concrete technical problems in the old implementation

### 1. React is in the hot path

The core problem is not that the old engine uses React. It is that it asks React to be the world renderer on every frame.

`updateHandler` computes a new entity state and calls `setState` on every timer notification ([GameEngine.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/GameEngine.js:116)). The default renderer then performs `Object.keys`, filtering, object spreading, and React element creation ([DefaultRenderer.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultRenderer.js:3)).

This makes several concepts share the same identity boundary:

- simulation state;
- entity storage;
- renderer discovery;
- React props;
- React reconciliation keys;
- visual invalidation.

That is why shallow identity and mutable nested data became user-facing game-engine concerns. In [issue #65](https://github.com/bberak/react-native-game-engine/issues/65), changing a nested body property did not rerender as expected. In [issue #79](https://github.com/bberak/react-native-game-engine/issues/79), changing the incoming entities prop did not produce the expected display update. [Issue #53](https://github.com/bberak/react-native-game-engine/issues/53) was titled as a Matter compatibility problem, but the conversation is principally about physics state changing while a PureComponent-backed renderer did not observe the shallow identity change.

GameKit should keep React as the composition shell and make the frame path a separate, explicit implementation.

### 2. Timing is frame-driven rather than simulation-driven

The timer sends raw RAF timestamps. `GameEngine` derives `delta` from the previous callback and forwards it directly to systems ([GameEngine.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/GameEngine.js:123)). There is no fixed tick, catch-up accumulator, maximum frame gap, or interpolation.

Consequences include:

- physics behavior depends on frame delivery;
- a dropped frame produces a large simulation jump;
- long background gaps can leak into the next update because `AppState` is not modeled;
- code written as “move N pixels per frame” runs twice as fast on 120 Hz displays;
- deterministic replay and headless tests require replacing too many moving parts.

[Issue #64](https://github.com/bberak/react-native-game-engine/issues/64) includes both a timer stop race and a report that a 120 Hz device caused per-frame game logic to run at double speed. This is directly relevant to iPad Pro support.

The new scheduler should use RAF only as a presentation clock:

```text
real delta = clamp(now - previous, 0, maxFrameDelta)
accumulator += real delta

while accumulator >= fixedStep and catchUpSteps < maxCatchUpSteps:
    sample one InputFrame
    run one deterministic simulation tick
    accumulator -= fixedStep

alpha = accumulator / fixedStep
render(interpolate(previousSnapshot, currentSnapshot, alpha))
```

When the app backgrounds, the session should pause or enter a scene-selected background mode, discard suspended wall time, and resume from a clean clock. React Native exposes the required foreground/background signals through [`AppState`](https://reactnative.dev/docs/appstate).

### 3. The default timer has a stop race

`DefaultTimer.loop` schedules the next RAF after invoking subscribers ([DefaultTimer.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultTimer.js:23)). If a subscriber calls `stop()`, `stop` can clear the currently stored id, after which the loop schedules and stores another callback. The public report is [issue #64](https://github.com/bberak/react-native-game-engine/issues/64).

The replacement scheduler needs an explicit generation/token or running-state check before and after update work, idempotent `start`/`pause`/`dispose`, and scheduler unit tests with a fake clock.

### 4. Event ordering is underspecified

`dispatch` always schedules a zero-delay timer, then appends the event and calls the external callback ([GameEngine.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/GameEngine.js:105)). Systems clear the event array on every frame. A dispatched event therefore does not necessarily belong to the current simulation tick, and the same asynchronous mechanism is used while stopping/unmounting.

GameKit should distinguish:

- **commands:** requested world changes applied at a defined point in the current or next tick;
- **game events:** ordered, typed, tick-stamped facts produced by the simulation;
- **UI notifications:** selected external events delivered to React outside the simulation contract;
- **telemetry:** diagnostics that must never alter simulation behavior.

### 5. Input is clever but too low-level and incomplete

The RxJS touch processor was a thoughtful attempt to normalize touches. It is also now an avoidable dependency and exposes the wrong level of abstraction.

Specific problems include:

- `moveThreshold` defaults to zero, so tiny physical-device jitter can cancel a long press; this matches [issue #37](https://github.com/bberak/react-native-game-engine/issues/37);
- only touch start/move/end are wired, with no touch-cancel path;
- the game sees platform-coordinate records rather than named intentions;
- touch ownership across the game surface and adjacent React views is difficult, as shown in [issue #55](https://github.com/bberak/react-native-game-engine/issues/55);
- multitouch delivery was too slow or incomplete for a rhythm-game use case in [issue #73](https://github.com/bberak/react-native-game-engine/issues/73);
- there is no keyboard, mouse, trackpad, virtual-stick, or controller-facing contract;
- cleanup likely calls `unsubscribe()` on piped Observables rather than only on owned Subjects/Subscriptions ([DefaultTouchProcessor.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultTouchProcessor.js:103)). This deserves a regression test in any migration adapter.

React Native Gesture Handler should be the default input implementation because it uses platform gesture/touch facilities and composes with Reanimated/worklets. Game code should see actions such as `move`, `jump`, `fire`, `pause`, and `pointerPrimary`, not Gesture Handler types. See the official [Gesture Handler fundamentals](https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/getting-started/).

### 6. Lifecycle and scenes are not first-class

The old engine exposes `running` and imperative `start`, `stop`, and `swap`, but no scene lifecycle. This made pause menus and level changes leak through React state and refs:

- [issue #3](https://github.com/bberak/react-native-game-engine/issues/3) shows pause/restart state being threaded into entities;
- [issue #8](https://github.com/bberak/react-native-game-engine/issues/8) asks how to destroy previous entities and reload;
- [issue #32](https://github.com/bberak/react-native-game-engine/issues/32) shows confusion about who owns `swap()` and when renderers update.

A scene should have explicit `load`, `enter`, `pause`, `resume`, `exit`, and `dispose` boundaries. Scene transitions must cancel pending work, release scene-owned assets/resources, clear or deliberately carry input state, and produce predictable events.

### 7. The type surface does not match the runtime

The package is JavaScript-first with a handwritten declaration file. `systems`, entities, renderer, touch processor, timer, and events are substantially `any` ([react-native-game-engine.d.ts](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/react-native-game-engine.d.ts:40)). Documented instance methods are absent from the `GameEngine` class declaration, matching [issue #60](https://github.com/bberak/react-native-game-engine/issues/60). `DefaultRenderer` is declared as one options object but implemented as three positional arguments ([react-native-game-engine.d.ts](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/react-native-game-engine.d.ts:8), [DefaultRenderer.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultRenderer.js:3)).

Type repair has remained a recurring maintenance theme: [PR #61](https://github.com/bberak/react-native-game-engine/pull/61), [issue #80](https://github.com/bberak/react-native-game-engine/issues/80), [PR #81](https://github.com/bberak/react-native-game-engine/pull/81), and the still-open [PR #82](https://github.com/bberak/react-native-game-engine/pull/82).

The new library should be authored in TypeScript, emit declarations from source, compile its documentation examples in CI, and use contract tests for every public adapter.

### 8. There is no real verification surface

The npm test script deliberately exits with “no test specified” ([package.json](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/package.json:6)). The engine is a React component, timing and events depend on the host event loop, and game systems directly mutate untyped state. That makes reliable agent changes especially difficult.

A modern toolkit must treat headless execution, fake time, input replay, state inspection, and project validation as product features rather than internal conveniences.

## What the upstream issue history actually says

The issue tracker contains a mix of architectural defects, React Native platform limitations, stale examples, incomplete documentation, and ordinary user mistakes. The most useful patterns are recurring clusters, not raw issue count.

| Cluster | Evidence | Product implication |
| --- | --- | --- |
| Android and entity-heavy performance | [#18](https://github.com/bberak/react-native-game-engine/issues/18), [#11](https://github.com/bberak/react-native-game-engine/issues/11), [#24](https://github.com/bberak/react-native-game-engine/issues/24), [#68](https://github.com/bberak/react-native-game-engine/issues/68) | Remove React reconciliation from the world render path; benchmark release builds on lower-end real Android hardware. |
| Render invalidation and mutation | [#5](https://github.com/bberak/react-native-game-engine/issues/5), [#53](https://github.com/bberak/react-native-game-engine/issues/53), [#65](https://github.com/bberak/react-native-game-engine/issues/65), [#79](https://github.com/bberak/react-native-game-engine/issues/79) | Simulation state and render extraction need explicit ownership and stable snapshot semantics. |
| Timer and high-refresh behavior | [#64](https://github.com/bberak/react-native-game-engine/issues/64) | Fixed-step simulation and a tested lifecycle-safe scheduler are foundational. |
| Touch ownership and reliability | [#37](https://github.com/bberak/react-native-game-engine/issues/37), [#55](https://github.com/bberak/react-native-game-engine/issues/55), [#59](https://github.com/bberak/react-native-game-engine/issues/59), [#73](https://github.com/bberak/react-native-game-engine/issues/73) | Gesture-backed action input, cancel semantics, regions, and latency benchmarks must be built in. |
| Pause, reset, and scene replacement | [#3](https://github.com/bberak/react-native-game-engine/issues/3), [#8](https://github.com/bberak/react-native-game-engine/issues/8), [#32](https://github.com/bberak/react-native-game-engine/issues/32) | `GameSession` and scenes need an explicit state machine and resource ownership. |
| Camera, world, and viewport | [#21](https://github.com/bberak/react-native-game-engine/issues/21), [#38](https://github.com/bberak/react-native-game-engine/issues/38), [#74](https://github.com/bberak/react-native-game-engine/issues/74), [#75](https://github.com/bberak/react-native-game-engine/issues/75) | Camera2D, coordinate conversion, tilemaps, safe area, and viewport policies should be supported primitives. |
| Missing higher-level game primitives | [#49](https://github.com/bberak/react-native-game-engine/issues/49), [#57](https://github.com/bberak/react-native-game-engine/issues/57), [#58](https://github.com/bberak/react-native-game-engine/issues/58), [#71](https://github.com/bberak/react-native-game-engine/issues/71) | Reference implementations should cover rotation, collision shapes, tilemaps, level generation, and virtual controls. |
| TypeScript and maintenance | [#60](https://github.com/bberak/react-native-game-engine/issues/60), [#78](https://github.com/bberak/react-native-game-engine/issues/78), [#80](https://github.com/bberak/react-native-game-engine/issues/80), [#82](https://github.com/bberak/react-native-game-engine/pull/82) | Generated declarations, compatibility policy, tests, ownership, and release automation are part of the engine design. |

Two examples should not be overread:

- [Issue #72](https://github.com/bberak/react-native-game-engine/issues/72) is framed as Expo SDK support, but much of the problem is the separate handbook/example app aging. The core engine itself is mostly JavaScript. The lesson is to maintain templates and compatibility examples as tested products.
- [Issue #53](https://github.com/bberak/react-native-game-engine/issues/53) is not strong evidence that Matter.js itself was incompatible. It is strong evidence that mutable physics bodies and PureComponent/shallow React invalidation were an unsafe default combination.

## 2026 React Native and Expo baseline

The architecture should target the current supported Expo line rather than carrying compatibility back to old React Native versions. At the research date, Expo’s latest reference maps SDK 57 to React Native 0.86, React 19.2.3, and Node 22.13.x. This should be expressed in releases as a tested compatibility matrix rather than permanent hardcoded prose because Expo and React Native move regularly. See the [Expo SDK version table](https://docs.expo.dev/versions/latest/).

Important platform assumptions:

- Hermes is the normal React Native JavaScript engine, but JavaScript is still a budgeted thread. Heavy synchronous work can block input and React work.
- The New Architecture is the baseline. Any future native module should use the Expo Modules API or an equivalent modern JSI/New Architecture path, not a legacy bridge-first design.
- A synchronous native call still blocks the calling JavaScript runtime. “Native” is not automatically “off-thread.” Heavy work needs an explicit background design and lifecycle cancellation.
- Native resources, event listeners, timers, worklets, textures, images, and audio handles require deterministic disposal. Scene exit and session disposal are the ownership boundaries.
- Dependency cost includes JavaScript bundle size, native binary size, build complexity, memory, and update compatibility—not just npm package size.

### Recommended default libraries

| Concern | Default | Rationale and boundary |
| --- | --- | --- |
| 2D drawing | `@shopify/react-native-skia` | Expo supports it on Android, iOS, tvOS, and web and includes it in Expo Go. It avoids one React Native View per entity and provides canvas primitives, images, text, paths, shaders, and atlas drawing. [Expo Skia docs](https://docs.expo.dev/versions/latest/sdk/skia/) |
| Sprite/tile batching | Skia `Atlas` and buffers | `Atlas` is explicitly intended for efficiently drawing many instances of the same texture, including sprites and tiles. [Skia Atlas docs](https://shopify.github.io/react-native-skia/docs/shapes/atlas/) |
| Input implementation | `react-native-gesture-handler` | Native gesture recognition and strong integration with Reanimated/worklets. It remains an adapter; GameKit code consumes actions. [Gesture Handler docs](https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/getting-started/) |
| Assets | `expo-asset` | Aligns static and downloaded asset resolution with Expo/Metro. GameKit adds manifests, validation, groups, preload, and ownership. [Expo Asset docs](https://docs.expo.dev/versions/latest/sdk/asset/) |
| Audio | `expo-audio` | Current Expo playback/recording surface. GameKit should expose music/SFX buses, concurrency, volume, mute, preload, and cleanup rather than leaking raw player handles. [Expo Audio docs](https://docs.expo.dev/versions/latest/sdk/audio/) |
| Haptics | `expo-haptics` | Straightforward optional feedback with platform limitations. Haptics must never be required for gameplay correctness. [Expo Haptics docs](https://docs.expo.dev/versions/latest/sdk/haptics/) |
| App lifecycle | React Native `AppState` | Required to pause, suppress giant deltas, release/restore services, and define interruption behavior. [AppState docs](https://reactnative.dev/docs/appstate) |
| Window changes | `useWindowDimensions` plus actual view layout | Window dimensions update with resizing, but the game must ultimately use the mounted view’s bounds and safe area to calculate its viewport. [useWindowDimensions docs](https://reactnative.dev/docs/usewindowdimensions) |
| Native escape hatch | Expo Modules API, only after profiling | Integrates Swift/Kotlin and modern React Native architecture. Custom native code moves users to development builds. [Expo Modules overview](https://docs.expo.dev/modules/overview/), [development builds](https://docs.expo.dev/develop/development-builds/introduction/) |

React Native Skia is not free: current installation docs estimate an app-size increase of about 6 MB on iOS and 4 MB on Android, and current versions require modern React/RN. That is a reasonable cost for the core value proposition, but it should be measured and documented. See [Skia installation and bundle-size guidance](https://shopify.github.io/react-native-skia/docs/getting-started/installation/).

Reanimated/worklets should be used selectively for input responsiveness and render-side values. They should not become the only source of truth for the game world. A game whose rules exist partly in the main JS runtime, partly in a UI worklet, and partly in React state becomes difficult to replay, test, and reason about.

## Proposed architecture

The architecture should be deep internally and small externally. Most users should install one package and meet a handful of concepts. Internally, modules must have crisp ownership so rendering, physics, input, and platform integrations can evolve independently.

```text
React Native / Expo application
└── GameView (mount, layout, HUD overlay, accessibility, app lifecycle)
    ├── GameSession (headless authoritative runtime)
    │   ├── Scheduler and fixed clock
    │   ├── Scene lifecycle
    │   ├── World, resources, commands, and events
    │   ├── InputFrame snapshots
    │   └── Inspector / diagnostics
    ├── Renderer implementation
    │   └── Skia 2D renderer in v1
    └── Platform adapters
        ├── Gesture input
        ├── Expo assets
        ├── Expo audio
        └── Expo haptics
```

### Module boundaries

The exact repository layout can change, but these responsibilities should remain separate:

| Module | Owns | Must not own |
| --- | --- | --- |
| `core` | Clock, session state machine, scenes, world interface, systems, commands/events, input snapshots, deterministic stepping, serialization hooks, diagnostics | React components, Skia objects, gesture objects, audio players, platform globals |
| `react` | `GameView`, session mounting/disposal, selected subscriptions for HUD, error boundary, app/window/safe-area plumbing | Per-frame entity reconciliation, authoritative world state |
| `skia` | Sprite/text/shape/tile/particle extraction, camera2D, render ordering, atlases, culling, debug drawing, interpolation | Gameplay decisions and scene lifecycle |
| `input` | Gesture/pointer/keyboard/virtual-control adapters, coordinate conversion, action mapping, input capability detection | Direct world mutation |
| `services` | Asset groups, audio buses, haptics, lifecycle cleanup, platform errors | Simulation timing and renderer internals |
| `physics-2d` | Optional fixed-step collision/physics implementation and debug shapes | React rendering, scene transitions, mandatory core dependency |
| `testing` | Fake clock, input scripts, headless runner, state matchers, replay tools, render-contract fixtures | Production platform globals |
| `tooling` | Project creation, schema validation, doctor/inspect/benchmark commands, templates, agent workflows | Hidden code generation that users cannot understand or edit |
| `r3f` (experimental) | R3F canvas adapter, 3D input normalization, 3D asset helpers, physical-device sample | Pretending 2D and 3D cameras/transforms/materials are one interface |

One main package can re-export the stable 2D experience so users are not forced to understand the internal package graph. Optional physics, testing, and experimental 3D can remain separate entrypoints/packages.

### Public experience: provisional shape

This is a design sketch, not a frozen interface:

```ts
const game = defineGame({
  viewport: {
    logicalSize: { width: 390, height: 844 },
    scale: 'fit',
    overflow: 'letterbox',
  },
  assets,
  input,
  scenes: {
    menu: createMenuScene(),
    level1: createLevelOne(),
  },
  initialScene: 'menu',
})
```

```tsx
<GameView game={game}>
  <ScoreHud score={useGameValue(game, selectScore)} />
</GameView>
```

Inside a system, input is semantic and time is simulation time:

```ts
function movementSystem(world: World, frame: Frame) {
  const direction = frame.input.axis2D('move')
  const player = world.player()

  return world.commands.setVelocity(player, {
    x: direction.x * 240,
    y: direction.y * 240,
  })
}
```

The important rules are more durable than these names:

- React props configure or observe a session; they do not become the frame store.
- A system sees one immutable input/time snapshot for one simulation tick.
- World changes are requested through a defined command boundary.
- Rendering consumes a compact snapshot/projection of renderable state, not arbitrary entity objects.
- UI subscriptions are selector-based and only notify React when the selected value changes.
- Session methods are idempotent and explicit: `start`, `pause`, `resume`, `restart`, `setScene`, and `dispose`.

### World and ECS depth

The authoring model should feel like a small component/entity/system toolkit. The implementation does not need to expose its storage strategy.

Recommended public principles:

- `EntityId` is distinct from array indexes, object keys, and renderer keys.
- Components are typed data with runtime validation at load/system boundaries where useful.
- Systems declare or document what they read and write.
- Scene/resource objects hold singleton data such as score, camera intent, level bounds, and RNG state.
- Commands add/remove entities and components at a stable point between system phases.
- Iteration order is defined when it can affect gameplay.
- Public snapshots and commands are immutable. Internal representation can be optimized later behind the module interface without changing game semantics.
- The beginner path should not require archetypes, sparse sets, query planners, or code generation.

Start with the simplest storage that meets measured reference-game budgets. A future packed implementation should be an internal optimization, not a breaking rewrite of game code.

### System phases

A predictable default phase order is more valuable than arbitrary middleware:

1. input sampling;
2. pre-update commands and scene tasks;
3. player/gameplay systems;
4. physics/collision;
5. post-physics gameplay and event production;
6. command commit;
7. render snapshot extraction;
8. external UI notifications and diagnostics.

Advanced users can configure phase membership, but phase ordering should remain inspectable. An agent should be able to answer “why did this collision happen before damage?” from structured information.

### Rendering model

Skia is the official Implementation of the v1 renderer Interface.

The renderer should consume purpose-built render data such as:

- transforms and previous transforms for interpolation;
- sprite/atlas region, tint, anchor, flip, and layer;
- primitive shapes and paths;
- text/font references;
- tile chunks;
- particle batches;
- clip/mask/effect records;
- camera2D and viewport transform;
- visibility, z/layer ordering, and culling bounds.

It should not receive the entire gameplay world or execute arbitrary gameplay callbacks during drawing.

Important renderer primitives for the initial product:

- sprite and sprite-sheet animation;
- atlas/instanced batch drawing;
- Camera2D with follow, bounds, shake, and coordinate conversion;
- tiled/chunked maps and parallax layers;
- particles with bounded pools;
- text and bitmap-font path;
- shapes, debug collision outlines, and a performance overlay;
- render layers and deterministic order;
- offscreen/snapshot support where Skia makes it practical;
- visual fallback/error markers for missing assets in development.

Skia can receive Reanimated shared values directly for some UI-thread effects, and Atlas can draw repeated textures efficiently. The renderer should use these capabilities behind GameKit primitives rather than making every game author design worklet ownership themselves. See [Skia animation integration](https://shopify.github.io/react-native-skia/docs/animations/animations/) and [Atlas](https://shopify.github.io/react-native-skia/docs/shapes/atlas/).

## iPad and tablet support

Tablet support is an architectural requirement, not a later responsive-design ticket.

The engine must distinguish:

- physical pixels;
- React Native layout points;
- mounted game-view bounds;
- safe-area insets;
- logical game coordinates;
- world coordinates;
- camera coordinates;
- pointer/touch coordinates.

Every conversion should be available through one viewport service and testable in isolation.

### Required viewport policies

| Policy | Behavior | Good for |
| --- | --- | --- |
| `letterbox` / `fit` | Preserve the designed logical world and show bars/unused space where aspect ratios differ. | Competitive/fair games, pixel art, tightly composed arcade games |
| `crop` / `fill` | Fill the surface and crop excess logical area. | Cinematic backgrounds and experiences where edges are nonessential |
| `extend-world` | Preserve scale but reveal more world on larger/wider surfaces. | Exploration and some action games; must consider gameplay fairness |
| `adaptive` | Let the scene select layout/bounds from breakpoint or capability rules. | Board, card, strategy, puzzle, and UI-heavy games |

The chosen policy must affect both drawing and input hit-testing through the same transform.

### iPad-specific requirements

- Support portrait and landscape unless the game explicitly declares one orientation.
- Recompute from actual game-view layout when Split View, Stage Manager, rotation, or navigation changes the available surface.
- Never assume `Dimensions.get('window')` is the game view.
- Expose safe area separately from the logical world. A game may keep play inside it while drawing backgrounds beneath it.
- Define fairness behavior for `extend-world`: seeing more of the world can be an advantage.
- Treat 120 Hz as a render capability, not a simulation rate requirement.
- Scale virtual controls by physical comfort and reachable zones, not merely by multiplying phone coordinates.
- Support mouse/trackpad hover and click capabilities where the platform provides them, while keeping touch primary.
- Define a minimum playable size for split view and a clear fallback when the window is smaller.

React Native recommends dimension hooks that update as the window changes, while Apple’s multitasking model delivers window-bound changes dynamically. See [`useWindowDimensions`](https://reactnative.dev/docs/usewindowdimensions), [Expo screen orientation guidance](https://docs.expo.dev/versions/latest/sdk/screen-orientation/), and [Apple’s iPad multitasking layout guidance](https://developer.apple.com/library/archive/documentation/WindowsViews/Conceptual/AdoptingMultitaskingOniPad/QuickStartForSlideOverAndSplitView.html).

## Input design

Input should be configured around game actions:

```ts
const input = defineInput({
  move: axis2D({
    touch: virtualStick('left-zone'),
    keyboard: arrowsOrWASD(),
    controller: leftStick(),
  }),
  jump: button({
    touch: region('jump-button'),
    keyboard: ['Space'],
    controller: 'south',
  }),
  pause: button({
    touch: region('pause-button'),
    keyboard: ['Escape'],
    controller: 'menu',
  }),
})
```

The exact helpers can evolve. The core requirements are:

- `pressed`, `released`, `held`, scalar axis, 2D axis, pointer position, delta, and gesture state;
- one `InputFrame` sampled per simulation tick;
- stable pointer identifiers and explicit cancel/lost-ownership handling;
- configurable dead zones, thresholds, hysteresis, long-press slop, and repeat behavior;
- input regions expressed in logical/viewport coordinates;
- simultaneous virtual controls without responder conflicts;
- capability detection and graceful fallback;
- recorded input frames for replay and tests;
- accessibility hooks for menu/UI actions, while recognizing that fast canvas gameplay may need game-specific accommodations.

Gesture Handler/Reanimated may update visual control feedback at presentation speed. The simulation still consumes a stable tick snapshot so game rules do not depend on how many native move events happened between ticks.

## Assets, audio, haptics, and resource ownership

The old engine lets `entities` be a Promise as a convenient loading shortcut ([README.md](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/README.md:194)). That mixes asset readiness, world construction, and render validity.

GameKit should use an explicit manifest and asset groups:

```ts
const assets = defineAssets({
  boot: {
    ui: image(require('./assets/ui.png')),
    font: font(require('./assets/game.ttf')),
  },
  level1: {
    world: atlas(require('./assets/world.png'), worldAtlas),
    music: audio(require('./assets/level-1.mp3')),
  },
})
```

Required behavior:

- validate duplicate keys, missing atlas frames, unsupported formats, and case-sensitive path mistakes;
- preload by group and expose progress/errors;
- provide placeholders in development, but fail clearly when an asset is required for correctness;
- retain shared assets while any owning scene/session uses them;
- release scene-owned image, texture, audio, and native handles on exit/dispose;
- support local Expo assets first and downloaded/cached assets through a deliberate extension;
- keep asset identity independent from the underlying Skia/Expo/GL object.

Audio should expose simple buses—at least `music`, `sfx`, and optionally `ui`—with master/bus volume, mute, pause policy, concurrency limits, and lifecycle cleanup. Haptics should be best-effort feedback because the platform can suppress them; gameplay must never wait on or depend on a haptic result.

## Physics direction

Do not make a full physics engine mandatory.

The stable v1 should include enough deterministic collision support for common 2D games:

- AABB and circle overlap;
- swept or conservative movement helpers for fast arcade objects;
- spatial query/broad-phase appropriate for tilemaps and modest entity counts;
- triggers/sensors;
- layers/masks;
- ray/segment queries if reference games need them;
- debug rendering;
- fixed-step integration.

Full rigid-body physics should be an optional Implementation behind a narrow adapter. Matter.js can be supported as a migration/community adapter, but should not define the new world model. Planck or another 2D implementation can be evaluated with real Expo/Hermes benchmarks and maintenance criteria before selection. The core contract must not promise bit-perfect determinism across JavaScript engines or devices unless that is separately proven.

## React integration

React remains valuable for everything outside the world hot path:

- navigation and app shell;
- menus, pause screens, inventory, shops, authentication, and settings;
- accessible labels and controls;
- score/lives/status HUD where update frequency is modest;
- loading and error states;
- platform services and business UI.

`GameView` should subscribe to the minimum lifecycle/layout information needed to mount the renderer. Hooks such as `useGameValue(session, selector)` should use external-store semantics: React rerenders only when the selected UI value changes. A position updated every simulation tick should not normally be exposed through a React hook.

React children should render as an overlay, preserving one of the legacy engine’s best affordances. Input ownership between overlay and game must be explicit: HUD controls can declare pass-through, capture, or mapped game actions.

## Agent-friendly game authoring

Agent support should influence the project grammar from the start. It should not be a pile of prompts added after the interface is unstable.

### What agents need from the engine

- One obvious location for game definition, scene definitions, components, systems, assets, and tests.
- Schemas and types that turn common mistakes into local, actionable failures.
- Deterministic commands and inspectable phase order.
- Small example files rather than a giant mutable entity object.
- A headless way to step the game without launching a simulator.
- Structured diagnostic codes with fixes, not only free-form logs.
- Reference patterns for phone/tablet viewport behavior and controls.
- Golden reference games whose tests demonstrate supported composition.
- A compatibility document that says which Expo/RN/Skia versions are actually tested.

### Proposed project workflow surface

The canonical workflow should live in `skills/`, with templates and instructions versioned alongside the runtime. Useful initial skills:

- create a new game from a supported template;
- add a scene and scene transition;
- add an entity/component/system;
- add sprite animation or a tilemap;
- add virtual controls and alternate input mappings;
- make a scene tablet-adaptive;
- add collision/physics safely;
- write a deterministic gameplay test;
- diagnose dropped frames and allocation spikes;
- validate asset/resource cleanup;
- migrate a small RNGE game.

Useful commands, whether exposed by a small CLI or scripts:

```text
gamekit create
gamekit add scene
gamekit validate
gamekit test
gamekit inspect
gamekit benchmark
gamekit doctor
```

`validate` should check project schemas, asset references, scene registration, action mappings, forbidden per-frame React patterns in generated templates, and package compatibility. `inspect` should print scene/world/system/resource state in a machine-readable form. `benchmark` should run named, reproducible scenarios rather than report one flattering FPS number.

## Testing and performance contract

### Test layers

1. **Core unit tests:** fake clock, scheduler catch-up, phase order, command/event order, scene lifecycle, seeded RNG, input snapshots, viewport transforms, serialization, and disposal.
2. **Adapter integration tests:** Skia extraction, gesture normalization, asset groups, audio policies, React selector subscriptions, AppState transitions, and error paths.
3. **Reference-game integration tests:** scripted input produces expected state checkpoints for Breakout, platformer, top-down shooter, puzzle/card, and twin-stick arena.
4. **E2E device tests:** launch, background/resume, rotate/resize, scene transition, pause/restart, asset failure, multitouch, and app teardown.
5. **Performance tests:** release builds on a physical lower/mid Android device, representative iPhone, standard iPad, and a 120 Hz iPad Pro where available.

Core modules should maintain at least 80% meaningful coverage, with higher coverage for scheduler, lifecycle, input, and viewport math. Coverage is not a substitute for device performance and lifecycle testing.

### Performance principles

- Benchmark release builds; development mode is not representative.
- Track JavaScript and UI/render frame behavior separately.
- Measure p50/p95/p99 frame time, dropped frames, startup time, memory, asset load time, and sustained thermal behavior—not just average FPS.
- Keep fixed simulation work within a 16.67 ms budget for 60 Hz, while understanding that a 120 Hz presentation frame has only 8.33 ms.
- Avoid allocations in known frame-critical loops after profiling confirms them.
- Batch sprites/tiles/particles, cull offscreen work, reuse render data, and define bounded pools where appropriate.
- Prohibit per-frame React `setState` in official renderer/gameplay templates.
- Test background/resume for giant-delta suppression and resource leaks.
- Run repeated scene enter/exit loops and verify memory returns to a stable range.

Initial performance targets should be set only after the first benchmark harness runs. The engine should publish supported scenario budgets, device tiers, and exact benchmark scenes rather than promise an arbitrary universal entity count.

## 3D from day one: feasibility and cost

### Short answer

3D can be added from the beginning, particularly through React Three Fiber’s native renderer over `expo-gl`. The cost is substantially more than adding a package. First-class 3D would force v1 to settle decisions that 2D does not need and that differ sharply between R3F and a native renderer such as Filament.

The best balance is:

1. keep the session/scheduler/scenes/events/input-frame/testing core dimension-neutral;
2. make all spatial rendering and physics types dimension-specific;
3. ship excellent official 2D;
4. build a physical-device R3F proof early;
5. expose it as experimental only if the proof meets documented limits;
6. evaluate a separate Filament package later if serious native 3D becomes a product requirement.

### What can genuinely be shared

- `GameSession` and its lifecycle;
- fixed-step scheduler and seeded random source;
- scene loading/enter/exit ownership;
- entity identity and high-level world/system concepts;
- ordered commands and events;
- input action snapshots;
- non-spatial asset references and loading groups;
- audio/haptics services;
- diagnostics, replay, and headless gameplay tests;
- React shell/HUD overlay and app lifecycle.

### What should not be forced into one universal core type

| 2D concern | 3D concern | Why the shared abstraction becomes harmful |
| --- | --- | --- |
| `Transform2D`: position, scalar rotation, scale, anchor | `Transform3D`: hierarchy, Vec3, quaternion/Euler, matrices | A 3D transform bloats every simple 2D entity; a 2D transform cannot represent real 3D hierarchy. |
| Camera2D and logical viewport | Perspective/orthographic camera, near/far planes, projection | Only the lifecycle is shared; the actual camera contract is different. |
| Sprites, paths, text, tilemaps | Meshes, geometry, materials, lights, shadows | A universal “renderable” either leaks backend details or becomes too weak to be useful. |
| Atlas images and fonts | GLB/glTF, texture maps, environment maps, compression | Loading, validation, conversion, memory, and failure modes differ. |
| 2D overlap and rigid bodies | 3D broad phase, shapes, rigid bodies, joints | Library availability and performance paths differ, especially with WASM/native code. |
| Point/region hit tests | Raycasting, picking, depth/occlusion | The input action layer can be shared; spatial interpretation cannot. |
| Quadtree/grid culling | Frustum, octree/BVH, LOD | Exposing one spatial index makes both implementations worse. |

Keep `RendererAdapter` as a lifecycle/output seam. Do not put `Camera`, `Transform`, `Material`, `Mesh`, `Sprite`, `Collider`, or `Light` into `core` as supposedly dimension-neutral types.

### React Three Fiber over Expo GL

Official React Three Fiber documentation supports React Native through `@react-three/fiber/native`. It uses `expo-gl` and `expo-asset` underneath, and Metro needs to understand 3D/image asset extensions. R3F warns that iOS simulators can have incomplete/unreliable OpenGL ES support and recommends physical-device testing. See the [R3F installation guide](https://r3f.docs.pmnd.rs/getting-started/installation).

Expo’s `GLView` is an OpenGL ES target for 2D and 3D and is included in Expo Go. It can expose a GL context to an experimental worklet integration, but third-party libraries such as Three.js cannot simply run inside that worklet; asset loading and the render loop have constraints. Remote debugging also does not work as expected because GLView needs synchronous native calls. See the official [Expo GLView documentation](https://docs.expo.dev/versions/latest/sdk/gl-view/).

R3F advantages:

- fastest route to a declarative 3D prototype;
- works with Expo Go through Expo GL for the basic path;
- large Three/R3F knowledge and content ecosystem;
- familiar React scene composition;
- good fit for simple 3D games, educational scenes, and model-viewer-like experiences.

R3F costs/risks:

- reliable iOS validation requires physical devices;
- GL/driver/asset-loader problems expand the support surface;
- some Three ecosystem packages assume browser APIs and need native-specific entrypoints or workarounds;
- continuous 3D rendering has real battery and thermal cost;
- geometry/material reuse, instancing, LOD, draw-call discipline, and disposal become first-class author responsibilities;
- the JS runtime remains involved in scene updates, so complex gameplay plus rendering needs careful measurement;
- a stable React Native 3D physics choice is not yet proven by this research. [Rapier’s JavaScript distribution](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) uses WASM, which adds Metro/Hermes validation work; [cannon-es](https://github.com/pmndrs/cannon-es) is JavaScript-only but represents a different capability/performance tradeoff.

### React Native Filament

React Native Filament is the more serious mobile-native 3D option. Its project uses Google Filament for PBR rendering and targets Metal on iOS and OpenGL/Vulkan on Android. It also exposes Bullet-based physics features. See the [project repository](https://github.com/margelo/react-native-filament) and [documentation](https://margelo.github.io/react-native-filament/).

Filament advantages:

- rendering designed for mobile and moved away from the normal JS/React frame path;
- native PBR renderer with lights, materials, cameras, model animation, and platform GPU backends;
- app download impact documented around 4 MB;
- a better long-term fit than Expo GL for demanding, genuinely mobile-native 3D.

Filament costs/risks:

- requires native libraries, CocoaPods/Gradle integration, Babel/worklet configuration, and `react-native-worklets-core`;
- therefore requires an Expo development build rather than stock Expo Go (an inference from Expo’s custom-native-code rules);
- npm install footprint is documented around 400 MB because it ships static libraries for several architectures, even though final app impact is much smaller;
- current docs support only `.glb` model loading, creating an explicit conversion pipeline;
- regular React Native children inside `FilamentView` are not supported; HUD should be an absolute overlay;
- per-frame transforms should use its shared/worklet values rather than React state;
- Reanimated values must be synchronized into the separate worklets-core value system;
- native build failures and platform compatibility become GameKit support responsibilities.

See the [Filament getting-started guide](https://margelo.github.io/react-native-filament/docs/guides), [transform guidance](https://margelo.github.io/react-native-filament/docs/guides/transformation), and [Reanimated integration](https://margelo.github.io/react-native-filament/docs/guides/reanimated).

### Option matrix

| Choice | Expo Go | Performance ceiling | Authoring simplicity | Maintenance burden | Product fit |
| --- | --- | --- | --- | --- | --- |
| Skia 2D only in stable v1 | Yes | Strong for intended 2D scope when batching/culling is sound | Highest | Lowest | Best default |
| Skia stable + experimental R3F | Yes for both basic paths | Adequate for bounded/simple 3D; must prove on devices | Moderate | Moderate | Recommended research boundary |
| Official R3F 3D in v1 | Yes for base dependencies | More JS/GL and device-specific constraints | Deceptively simple at hello-world, much deeper in production | High | Too broad for the simple v1 promise |
| Official Filament 3D in v1 | No; development build | Highest serious-native potential | Lower once set up, but native/resource complexity is real | Very high | Future separate product/package if demand proves it |

### Minimum 3D proof before any promise

The R3F spike must run on physical iPhone/iPad and Android hardware and demonstrate:

- local `.glb` with textures through Metro/Expo assets;
- fixed-step GameSession driving a 3D presentation loop without double-scheduling;
- action input, camera gesture, raycast picking, and React HUD overlay;
- scene enter/exit with GPU resource cleanup;
- background/resume and context/resource recovery behavior;
- measured startup, memory, frame time, battery/thermal trend, and app-size impact;
- a documented device/quality limit.

A later Filament spike should demonstrate the same plus animation, lighting/material quality, native development-build setup, collision/physics, and worklet interoperability.

If these two proofs require radically different core compromises, keep them separate. The stable 2D interface should not absorb the compromise.

## Prioritized architectural deepening opportunities

These are the highest-leverage places where the new architecture should be deeper than the old one while keeping the user interface smaller.

### 1. Simulation/React separation

**Legacy evidence:** per-frame `setState` in [GameEngine.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/GameEngine.js:116) and per-frame React element mapping in [DefaultRenderer.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultRenderer.js:3).

**Proposed seam:** `core/GameSession` produces snapshots; `react/GameView` mounts; `skia` draws.

**Depth gained:** one authoritative runtime, no renderer-specific mutation rules, selector-only UI observation, headless execution.

**Leverage:** fixes the root performance/invalidation failure while preserving the friendly React composition story.

### 2. Scheduler and lifecycle state machine

**Legacy evidence:** variable delta and timer race in [DefaultTimer.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultTimer.js:23), no AppState handling, scene swap through refs.

**Proposed seam:** a fixed-step `Scheduler` plus explicit `GameSession`/`SceneLifecycle` states.

**Depth gained:** deterministic stepping, bounded catch-up, clean background policy, idempotent disposal, reliable tests.

**Leverage:** benefits physics, replays, tests, 120 Hz iPad support, scenes, and both 2D/3D renderers.

### 3. Render extraction and batching

**Legacy evidence:** arbitrary entities carry React renderers, making rendering depend on gameplay object identity.

**Proposed seam:** render components are extracted into compact, typed Skia snapshots/buffers.

**Depth gained:** batching, culling, interpolation, atlas use, stable layers, render diagnostics, backend isolation.

**Leverage:** a single implementation improvement accelerates every sprite/tile/particle consumer.

### 4. Action input and coordinate authority

**Legacy evidence:** raw touch arrays and responder conflicts in [DefaultTouchProcessor.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultTouchProcessor.js:14), plus issues #37, #55, and #73.

**Proposed seam:** platform input adapters feed named actions through one viewport-coordinate converter into immutable `InputFrame`s.

**Depth gained:** multi-device mappings, virtual controls, recorded input, cancellation, split-view correctness.

**Leverage:** the same gameplay code works across phone, iPad, keyboard, and future controllers.

### 5. Tablet-aware viewport module

**Legacy evidence:** cached `Dimensions.get('window')` and raw layout values with no world/camera policy ([GameEngine.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/GameEngine.js:34)).

**Proposed seam:** `Viewport2D` owns logical size, surface bounds, safe area, scaling policy, camera transform, and bidirectional coordinate conversion.

**Depth gained:** predictable phone/tablet behavior, fairness policy, split view, orientation, hit testing.

**Leverage:** resolves rendering, controls, camera, tilemap, and HUD layout with one source of truth.

### 6. Asset/resource lifetime

**Legacy evidence:** Promise-valued initial entities use world creation as the asset-loading boundary.

**Proposed seam:** manifests and reference-counted/owned asset groups tied to session/scene lifecycle.

**Depth gained:** preload progress, clear failure modes, deterministic readiness, cleanup, format validation.

**Leverage:** supports Skia today and GLB/texture/native resource ownership tomorrow.

### 7. Agent-verifiable tooling

**Legacy evidence:** no tests, loose declarations, unstructured state, and examples that age separately from the package.

**Proposed seam:** headless runner, fake clock, schemas, diagnostics, compiled docs, reference games, and canonical `skills/` workflows.

**Depth gained:** agents can observe, change, validate, and explain games without relying on simulator screenshots alone.

**Leverage:** raises reliability for every generated game and turns documentation drift into a CI failure.

### 8. Narrow 3D adapter boundary

**Legacy evidence:** renderer replaceability was a good instinct, but the renderer received the whole loose entity map.

**Proposed seam:** share lifecycle/time/input and a renderer adapter protocol; keep 2D and 3D spatial/render types separate.

**Depth gained:** an R3F or Filament implementation can integrate without forcing Vec3/quaternions/materials into the 2D experience.

**Leverage:** preserves future ambition at far lower v1 complexity than a universal renderer abstraction.

## Suggested delivery roadmap

### Phase 0: prove the risky seams

- Build a minimal fixed-step headless session with fake-clock tests.
- Render a Skia stress scene using Atlas/buffers on representative physical devices.
- Prove `GameView` can mount Skia without per-frame React updates.
- Prove Gesture Handler can drive simultaneous virtual controls and pointer input through tick snapshots.
- Test viewport transforms in phone, iPad portrait/landscape, split view, and 120 Hz presentation.
- Run the R3F physical-device spike described above.
- Record real frame, memory, startup, and binary-size baselines.

Exit criterion: the core seams work without one renderer/input/platform implementation leaking into another.

### Phase 1: core and testing foundation

- Session and scene lifecycle.
- Fixed scheduler, RNG, command/event phases.
- Simple typed world/components/systems.
- InputFrame and replay format.
- Viewport2D math.
- Headless runner, inspectors, and at least 80% meaningful core coverage.

### Phase 2: official 2D platform

- Skia sprite/atlas/text/shape/tile/particle renderer.
- Camera2D and viewport policies.
- Gesture/virtual-control/keyboard/pointer adapters.
- Asset manifest/groups, audio buses, haptics.
- Basic arcade collision module and debug overlay.
- React HUD selectors and lifecycle integration.

### Phase 3: reference games and agent workflows

- Breakout: collision, score, restart, phone/tablet scaling.
- Platformer: tilemap, camera, animation, one-way platforms.
- Top-down shooter: aim, projectiles, particles, culling.
- Puzzle/card: adaptive iPad layout, UI-heavy React overlay.
- Twin-stick arena: simultaneous virtual controls, many moving sprites.
- Canonical skills/templates for creating and modifying each pattern.

The interface is not stable until these games reuse the same primitives without engine-specific workarounds.

### Phase 4: beta hardening

- Compatibility matrix and upgrade tests for the supported Expo/RN/Skia line.
- Real-device performance gates and leak loops.
- Accessibility and interruption policy review.
- Error/diagnostic catalog.
- Migration guide from RNGE.
- Package-size and dependency audit.
- Documentation examples compiled and exercised in CI.

### Phase 5: 3D decision gate

Choose one:

- keep R3F as experimental examples/community adapter;
- graduate a bounded R3F package with explicit device/performance limits;
- fund a separate native Filament package for serious 3D;
- defer 3D if the support cost weakens the 2D product.

Do not graduate 3D because a rotating cube works. Graduate it only after the minimum proof and at least one real small game.

## Decisions that should stay explicit

| Question | Current recommendation | Revisit trigger |
| --- | --- | --- |
| Is this an engine or toolkit? | Toolkit with a deep runtime core | Users repeatedly need editor-scale workflows |
| Primary dimension | 2D | Stable 2D product plus proven 3D demand |
| Official renderer | Skia | Device benchmarks show a blocking limitation |
| React’s role | Mount, UI, observation, platform composition | Never move authoritative per-frame world state back into React |
| Simulation rate | Fixed 60 Hz default, configurable where justified | Reference game demonstrates a different stable requirement |
| Presentation rate | Device-driven, interpolated | Accessibility/power mode or renderer limitation |
| Physics | Basic arcade collision included; rigid-body optional | Reference games prove a required default implementation |
| Expo Go | Supported for the stable 2D path | A native feature provides overwhelming product value; then require dev builds explicitly |
| Native/C++ core | Not initially | Profiling isolates a core bottleneck that cannot be solved in the current runtime |
| 3D in v1 | Experimental spike/adapter only | Physical-device game proof meets quality and maintenance gates |

## Working-name warning

`React Native GameKit` is descriptive, and the unscoped npm name `react-native-gamekit` returned no package at the research date. That is not a guarantee of future availability or brand safety.

Apple already uses **GameKit** for its Game Center framework and **GameplayKit** for game architecture/algorithm features. See Apple’s [GameKit](https://developer.apple.com/documentation/gamekit) and [GameplayKit](https://developer.apple.com/documentation/gameplaykit) documentation. The legacy timer also credits an earlier project named `react-game-kit` ([DefaultTimer.js](/Users/david/Desktop/Oreku/code/game-engine/react-native-game-engine/src/DefaultTimer.js:1)).

Before committing to the public name:

- search npm scopes, GitHub organizations, domains, app stores, and social handles;
- review likely search confusion with Apple documentation;
- perform an appropriate trademark/legal review;
- decide whether a distinctive product name with “React Native game toolkit” as the descriptor would be easier to own.

This is a naming/product-discovery warning, not a legal conclusion.

## Final recommendation

Build the ultimate React Native/Expo **2D** GameKit first, but make the deepest parts—session, time, lifecycle, commands/events, input snapshots, assets, diagnostics, and testing—independent of dimensional rendering.

Preserve the old engine’s generosity: a tiny mental model, composable systems, replaceable implementations, optional physics, and React overlays. Reject its architectural ceiling: React state as the frame store, variable frame-based simulation, raw touches, arbitrary async events, ref-driven scene changes, untyped mutable entity bags, and no tests.

Run one R3F 3D spike immediately because it is cheaper to validate a seam now than to discover a false abstraction later. Keep it experimental. If a real physical-device 3D game succeeds, it can grow as a separate adapter without making every 2D author pay the conceptual and maintenance cost.

The product wins if simple games remain simple, demanding 2D games have a credible performance path, iPad behavior is deliberate, and agents can verify every change headlessly. That is a stronger and more defensible goal than claiming support for every kind of game in version one.

## Primary external references

- [React Native Game Engine repository](https://github.com/bberak/react-native-game-engine)
- [React Native Game Engine issues](https://github.com/bberak/react-native-game-engine/issues)
- [Expo SDK reference and version table](https://docs.expo.dev/versions/latest/)
- [Expo React Native Skia integration](https://docs.expo.dev/versions/latest/sdk/skia/)
- [React Native Skia installation and compatibility](https://shopify.github.io/react-native-skia/docs/getting-started/installation/)
- [React Native Skia Atlas](https://shopify.github.io/react-native-skia/docs/shapes/atlas/)
- [React Native Gesture Handler fundamentals](https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/getting-started/)
- [React Native AppState](https://reactnative.dev/docs/appstate)
- [React Native useWindowDimensions](https://reactnative.dev/docs/usewindowdimensions)
- [Expo Asset](https://docs.expo.dev/versions/latest/sdk/asset/)
- [Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/)
- [Expo Haptics](https://docs.expo.dev/versions/latest/sdk/haptics/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo GLView](https://docs.expo.dev/versions/latest/sdk/gl-view/)
- [React Three Fiber native installation](https://r3f.docs.pmnd.rs/getting-started/installation)
- [Rapier JavaScript getting started](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)
- [cannon-es repository](https://github.com/pmndrs/cannon-es)
- [React Native Filament repository](https://github.com/margelo/react-native-filament)
- [React Native Filament documentation](https://margelo.github.io/react-native-filament/)
