# Task 7: 2D assets, sprites, and deterministic animation

## Status

**In progress — T7.1–T7.9 complete; T7.10 automated verification complete,
physical-device remainder device-gated.**

T7.0 (baseline, feedback reconciliation F1–F7, and the pointer lifecycle
checkpoint) is complete; T7.1–T7.9 landed in attributable commits with the
T7.1 contract fixtures green, headless + mounted tests, the Sprite Field
reference game verified on the simulator, and the docs/agent workflow in
place. T7.10's automated gate passes (lint, typecheck, 238 tests,
coverage gate, package build + tarball inspection, headless root import,
docs build, Expo export, diff check). The physical-device matrix, the
retained-vs-batch device benchmarks, the 50-cycle leak gate, and
release-like builds remain device-gated (no physical hardware in this
environment) and are tracked with F7; the RNGH in-place session-swap
delivery limitation is recorded for the device matrix.

Task 7 is the next product milestone after the core runtime, viewport/input
work, and the performance programme. It turns GameKit from a shape-based game
runtime into a practical 2D game toolkit by adding the first complete vertical
slice for:

- declaring local game assets;
- loading and validating them before play begins;
- owning and disposing native image resources correctly;
- drawing individual sprites and sprite-sheet regions;
- animating sprite sheets deterministically; and
- drawing large groups of repeated sprites through Skia's Atlas path.

This document is an implementation plan, not a record of completed work. Every
checkbox remains open until the implementation and its stated evidence exist.

---

## Objective

A game author should be able to define a sprite sheet next to the game
definition, show an honest loading/error state, start the session only after
the required resources are ready, and render either one animated character or
hundreds of repeated sprites without moving frame state through React.

The end-to-end authoring flow should look approximately like this:

```text
static require(...)
       |
       v
typed immutable asset manifest
       |
       v
Expo Asset resolution -> Skia decode -> validated, reference-counted lease
       |                                      |
       |                                      +-> explicit disposal
       v
ready GameView -> retained Sprite or Atlas-backed SpriteBatch
       |
       v
fixed-step animation state + UI-thread presentation
```

Task 7 is complete only when that path works in the package, in a new
playground example, in the documentation, and on physical iPhone, iPad, and
Android hardware.

---

## Why this is next

The current GameKit already has the difficult runtime foundation:

- deterministic fixed-step sessions;
- typed scenes and atomic transitions;
- immutable committed snapshots;
- commit-frequency JS-to-UI presentation;
- a shared drawing/input viewport;
- UI-runtime pointer handling and coalescing;
- Skia retained rendering through `GameView`; and
- a performance lab for measuring the mounted pipeline.

It can build shape-based arcade games such as the current Brick Breaker, but a
normal 2D game still has to invent its own image loading, sprite-sheet metadata,
animation sampling, loading UI, caching, and cleanup. The existing
`GameDefinition.assets` field is only a placeholder and does not load anything.

Assets and sprites are the highest-leverage next layer: platformers, top-down
games, card games, board games, shooters, puzzles, and tile-based games all
need them. The work also establishes resource ownership that future audio,
haptics, tilemaps, particles, and 3D adapters can build on.

---

## Scope

### Included

- Static local assets declared with React Native/Expo `require(...)`.
- PNG, JPEG, and WebP image decoding, subject to verified platform support.
- Typed asset groups and typed references.
- Image and sprite-sheet descriptors.
- Sprite-sheet frame and animation metadata.
- Progress, ready, and error loading states.
- Clear load errors with asset identity and underlying cause.
- Concurrent-load deduplication and reference-counted resource ownership.
- Explicit, idempotent disposal of Skia objects.
- A React loading adapter and an imperative loading API.
- `GameView` delivery of a stable loaded-asset lease to the renderer.
- A retained-mode sprite component for stable/small sprite topologies.
- An Atlas-backed batch for many instances sharing one image.
- Pure deterministic animation sampling.
- One reference playground game and complete docs.
- Benchmarks and physical-device validation, including iPad layouts.

### Explicitly deferred

- Remote URL assets, authenticated downloads, persistent disk caches, and
  streaming.
- Fonts, SVGs, animated GIF/WebP playback, video, shaders, and runtime-generated
  textures.
- Audio and haptics. They will use `react-native-audio-api` and Pulsar in a
  separate service/lifecycle task.
- Tilemaps, cameras, culling, particles, collision/physics, ECS, and editor
  tooling.
- Automatic async scene transitions or making `defineScene.create()` async.
- Automatic asset loading merely because a scene name changed.
- Texture packing or a TexturePacker JSON importer.
- Skeletal animation, animation blending, transition graphs, and animation
  events.
- Remote hot reload/replacement of native resources.
- A 3D renderer or 3D asset formats.

These are deferred deliberately. Task 7 must create seams for them without
pretending to implement them.

---

## Locked architecture decisions

### 1. Keep the root entry headless

`react-native-gamekit` may export plain descriptors, manifest helpers, sprite
metadata, validation, and pure animation functions. Importing the root entry
must not evaluate React, Expo, Skia, Reanimated, or another native module.

`react-native-gamekit/react` owns the Expo/Skia implementation:

- `createGameAssetStore` and its ready-lease API;
- `useGameAssets`;
- loaded native resource types;
- `GameWorld2D`;
- `Sprite`;
- `GameSprite`; and
- `SpriteBatch` and its supporting hook/buffer API.

Do not add a third package entry until a real consumer needs one. Keeping the
native surface under the existing React adapter is simpler to install, build,
and document at this stage.

### 2. Descriptors are not native handles

An asset descriptor is immutable data describing what should be loaded. It
must never contain a `SkImage`, Expo `Asset`, Reanimated shared value, GL/GPU
object, mutable cache entry, or disposal function.

The public identity of an asset comes from its manifest group and key, not from
the URI, Metro module number, or a Skia object identity. This lets another
renderer resolve the same logical asset differently in the future.

### 3. Loading is an explicit boundary before simulation

Do not put promises in scene state, snapshots, entities, or render functions.
Do not create a session and let it run against missing resources.

The React screen renders one of three discriminated states:

```ts
type GameAssetLoadState<TManifest> =
  | {
      readonly status: 'loading'
      readonly loaded: number
      readonly total: number
      readonly progress: number
    }
  | {
      readonly status: 'ready'
      readonly assets: LoadedGameAssets<TManifest>
    }
  | {
      readonly status: 'error'
      readonly error: GameAssetLoadError
      readonly retry: () => void
    }
```

The exact file/type names may be refined in the API-contract task, but the
semantics are locked: there is no half-ready asset store, loading progress is
monotonic, errors are visible, and a ready value owns usable resources.

### 4. Ownership is explicit and reference counted

The native resource lifecycle is:

```text
manifest descriptor (static, never disposed)
  -> resolved Expo asset/local URI
  -> explicit screen/game-owned store
  -> decoded SkImage cache entry (store owns native handle)
  -> one or more loaded-asset leases
  -> final lease release
  -> SkImage.dispose() exactly once
```

- There is no immortal module-global native-image cache.
- Concurrent requests for the same resolved source share one in-flight load
  and one decoded image.
- Releasing one lease must not invalidate another lease.
- `dispose()` is public on imperatively loaded leases, idempotent, and makes
  later access fail clearly in development.
- `useGameAssets` owns its lease and releases it on unmount, retry, manifest
  replacement, or group replacement.
- A failed/abandoned load cleans every partially acquired handle exactly once.
- No finalizer or garbage-collection timing is treated as the primary cleanup
  mechanism.
- `AbortSignal` detaches an imperative caller immediately. If the underlying
  Expo operation cannot be physically aborted, its late result must be ignored
  or retained only for another still-live lease; it must never resurrect a
  disposed store or publish stale progress.

Automatic scene-group ownership is deferred because current scene transitions
are synchronous. Task 7 exposes explicit group selection and lease boundaries
without making transitions asynchronous.

### 5. Start with local Expo assets

The first public source contract accepts static module handles from
`require(...)`. `expo-asset` resolves those handles and Skia performs the image
decode. A URL-shaped string must not silently become a remote network feature;
remote sources need a later descriptor with explicit caching, cancellation,
retry, and security policy.

If existing placeholder types currently accept `string | number`, replace or
deprecate them deliberately. Do not leave a public string type whose runtime
behaviour is undefined.

### 6. Retained and batched drawing are separate, explicit tools

Task 7 provides two paths that can coexist inside the same Skia `Canvas`:

1. `Sprite` for a stable, modest number of independently authored sprites.
   It uses retained React/Skia structure and animatable properties stay on the
   UI runtime.
2. `SpriteBatch` for many instances that share a decoded image. It uses Skia's
   `Atlas` primitive and fixed-capacity, UI-owned buffers.

GameKit must not dynamically switch between these paths. Automatic switching
would create unpredictable allocation, ordering, and profiling behaviour.
Authors choose the path; docs explain the trade-off using measured data.

Skia's normal `<Image>` component has no source-rectangle prop. A sprite-sheet
region must therefore use an Atlas-compatible path (including a possible
single-entry Atlas internally) or another source-verified crop primitive. Do
not fake cropping with a container clip plus a transformed whole texture until
it has been measured and its sampling behaviour is correct.

### 7. Animation time comes from GameKit, not the wall clock

Animation definitions are static data. Gameplay-significant animation state
belongs in the scene state/snapshot and advances from fixed-step game time.

A renderer-only loop may calculate its presented sprite frame from the latest
committed animation state plus interpolation alpha. It must not emit collision,
damage, scoring, or transition events based on a presentation-only frame.

The same input and elapsed game time must select the same sprite frame at
30/60/90/120 Hz. `Date.now()`, React timers, and per-frame `setState` are
forbidden in animation sampling.

### 8. No new per-frame React work

- React may render loading/error/ready boundaries and static sprite topology.
- Position, rotation, scale, frame selection, tint, and batch transforms may be
  numbers or supported UI-runtime animated values.
- A sprite must not subscribe React to the full game frame.
- A batch must not allocate an object per sprite per frame.
- Batch capacity is fixed for the mounted batch. Inactive slots are hidden or
  moved out of the active range; topology is not remounted every tick.
- Development validation may be richer, but production drawing must not repeat
  manifest validation on every frame.

### 9. Preserve the dependency contract

Task 7 uses the already aligned `expo-asset` and
`@shopify/react-native-skia` peers. It must not add another image loader or
graphics dependency. Exact supported peer versions remain declared by
GameKit, with matching development dependencies for the monorepo.

Package resolution must preserve the current rule: Metro/React Native consumes
the source entry while published/default consumers consume built modules.
Every package gate must test both so stale `lib` output cannot hide a runtime
fix again.

### 10. Keep the future 3D boundary clean

Manifest identity, grouping, progress, errors, leases, and disposal are
dimension-independent. Skia image handles, sprite frames, Atlas buffers, and
2D transforms are adapter-specific.

A later 3D adapter may reuse the manifest/lifecycle concepts and add model,
material, and environment descriptors. It must not require changing a 2D
sprite into a fake universal render object. Avoid names such as `GameObject`,
`MeshLike`, or a shared 2D/3D transform abstraction in this task.

---

## Proposed public API

The first implementation task must turn these sketches into compile fixtures
before runtime code is written. Names can change during that task only if the
replacement is simpler and the semantics above remain intact.

### Example 1: define grouped assets

```ts
import { defineAssets, image, spriteSheet } from 'react-native-gamekit'

export const gameAssets = defineAssets({
  boot: {
    logo: image(require('./assets/logo.png')),
  },
  gameplay: {
    player: spriteSheet(require('./assets/player.png'), {
      frames: {
        'idle-0': { x: 0, y: 0, width: 32, height: 32 },
        'idle-1': { x: 32, y: 0, width: 32, height: 32 },
        'run-0': { x: 0, y: 32, width: 32, height: 32 },
        'run-1': { x: 32, y: 32, width: 32, height: 32 },
      },
      animations: {
        idle: {
          frames: ['idle-0', 'idle-1'],
          frameDurationMs: 140,
          mode: 'loop',
        },
        run: {
          frames: ['run-0', 'run-1'],
          frameDurationMs: 80,
          mode: 'loop',
        },
      },
    }),
  },
})
```

`defineAssets` preserves the exact group, asset, frame, and clip names in the
type system. A loaded store retrieves an asset by its typed descriptor
reference, not by an arbitrary duplicated string:

```ts
const playerSheet = loadedAssets.get(gameAssets.gameplay.player)
```

### Example 2: load, show honest states, and start only when ready

```tsx
import { useGameAssets } from 'react-native-gamekit/react'

export function SpriteGameScreen() {
  const state = useGameAssets(gameAssets, {
    groups: ['boot', 'gameplay'],
  })

  if (state.status === 'loading') {
    return <LoadingScreen progress={state.progress} />
  }

  if (state.status === 'error') {
    return <LoadErrorScreen error={state.error} onRetry={state.retry} />
  }

  return <RunningSpriteGame assets={state.assets} />
}
```

`RunningSpriteGame` is a separate mounted component. It creates the synchronous
`GameSession` only after assets are ready, owns and disposes that session, and
passes the stable loaded lease into `GameView`:

```tsx
<GameView
  game={session}
  assets={assets}
  renderer={SpriteGameRenderer}
/>
```

`GameRendererProps` gains an asset-manifest generic so renderer lookup remains
typed without teaching the headless `GameSession` about Skia handles:

```ts
type RendererProps = GameRendererProps<typeof scenes, typeof gameAssets>
```

The normal React path above hides the store. Advanced code that deliberately
coordinates game-owned and scene-owned groups can use the same ownership model
imperatively:

```ts
const store = createGameAssetStore(gameAssets)
const lease = await store.acquire({
  groups: ['boot', 'gameplay'],
  signal: abortController.signal,
})

try {
  const playerSheet = lease.assets.get(gameAssets.gameplay.player)
  // Mount/use resources that borrow from this lease.
} finally {
  lease.dispose()
  store.dispose()
}
```

`store.acquire(...)` resolves only with a complete usable lease. The renderer
borrows from it and never disposes its images.

### Example 3: deterministic single-sprite animation

```tsx
function PlayerSprite({ assets, frame, alpha, viewport }: PlayerSpriteProps) {
  return (
    <GameWorld2D viewport={viewport}>
      <GameSprite
        scene="play"
        commit={frame}
        alpha={alpha}
        source={assets.get(gameAssets.gameplay.player)}
        anchor={{ x: 0.5, y: 1 }}
        select={({ previous, current, alpha: t }) => {
          'worklet'
          return {
            x: previous.player.x + (current.player.x - previous.player.x) * t,
            y: current.player.y,
            clip: current.player.animation.clip,
            elapsedMs: current.player.animation.elapsedMs,
            flipX: current.player.facing === 'left',
          }
        }}
      />
    </GameWorld2D>
  )
}
```

`GameSprite` owns the routine derived-value/Skia `select()` plumbing, narrows the
snapshot from `scene`, and creates one coherent mapper. `Sprite` remains the
lower-level direct-prop primitive for advanced composition. `GameWorld2D`
applies the resolved viewport offset/scale once to its children; it is not a
camera API. The final hot-path sampler may expose an allocation-free frame-index
helper in addition to the ergonomic pure result. That decision must be based on
a worklet benchmark, not guesswork.

Gameplay code advances the serializable animation state with pure helpers:

```ts
const initialAnimation = startSpriteAnimation(
  gameAssets.gameplay.player,
  'idle',
)

const nextAnimation = advanceSpriteAnimation(
  gameAssets.gameplay.player,
  initialAnimation,
  deltaSeconds,
)
```

Changing, pausing, restarting, or completing a clip returns a new state object;
it never mutates scene state or emits a side effect.

### Example 4: shared-texture batch

```tsx
return (
  <GameWorld2D viewport={viewport}>
    <SpriteBatch
      scene="play"
      commit={frame}
      alpha={alpha}
      source={assets.get(gameAssets.gameplay.enemies)}
      capacity={512}
      select={({ current }) => current.enemies}
      write={(write, enemy, index) => {
        'worklet'
        write.set(
          index,
          enemy.frame,
          enemy.x,
          enemy.y,
          enemy.rotation,
          enemy.scale,
        )
      }}
    />
  </GameWorld2D>
)
```

The common batch path owns its UI mapper and buffers; authors do not wire a
side-effecting `useDerivedValue`. This is still a contract sketch. The batch API
task must prototype the setter form against Skia's
`useRectBuffer`/`useRSXformBuffer`, then retain the clearest form that meets the
measured allocation and frame budget.

---

## Public contracts and validation rules

### Asset manifest

- Group and asset keys must be non-empty, stable identifiers.
- Reserve any separator used in diagnostic ids; fail at definition time when a
  key contains it.
- The returned manifest and every descriptor/metadata object are deeply
  immutable.
- Object-literal duplicate properties cannot be detected after JavaScript has
  overwritten them; documentation must not promise impossible duplicate-key
  detection. It can detect duplicate resolved ids produced by normalization.
- Asset references remain valid only for their originating manifest.
- Definition helpers allocate no native resources and perform no I/O.
- `GameDefinition.assets` accepts the manifest and remains optional for games
  that use only shapes.

### Sprite sheets

- Frame coordinates and dimensions must be finite numbers.
- `x` and `y` must be non-negative; `width` and `height` must be greater than
  zero.
- Frame rectangles are validated against decoded image dimensions after load.
- Every animation contains at least one known frame.
- Every duration is finite and greater than zero.
- Task 7 supports a uniform duration or an explicit duration per frame. If both
  forms are allowed, their precedence must be impossible to misunderstand.
- Loop and one-shot behaviour use a discriminated `mode`, not combinations of
  ambiguous booleans.
- A one-shot clip holds its final frame and reports completion. Restarting it is
  an explicit gameplay state change.
- Zero/negative/NaN elapsed time has documented fail-fast or clamp semantics;
  choose once and test it. Recommended: reject non-finite values and clamp
  finite negative presentation values to zero.

### Loading state and progress

- `progress` stays in `[0, 1]`, never decreases, and is `1` only when all
  requested resources are ready.
- An empty selected group set resolves immediately with `progress: 1`.
- Retry creates a new attempt id so late completion from an older attempt
  cannot replace the new state.
- Unmount invalidates the attempt and releases resources that completed in the
  meantime.
- An error includes a stable code, group, key, source metadata safe to display,
  and the original error as `cause` where supported.
- Error messages must not leak absolute development-machine paths in production
  UI.
- Missing required assets fail. An optional development placeholder must be
  explicitly enabled, visually unmistakable, and never used to hide a release
  packaging failure.

### Sprite geometry

- World position uses logical GameKit units.
- Rotation uses radians and has one documented pivot order.
- Anchor values use normalized `[0, 1]` coordinates relative to the selected
  frame; `(0, 0)` is top-left and `(0.5, 0.5)` is centre.
- `scaleX`/`scaleY` or a uniform `scale` have unambiguous precedence.
- Flipping is explicit and preserves the anchor.
- Opacity is clamped to `[0, 1]`; tint/color semantics match Skia Atlas.
- Sampling defaults are documented. Pixel-art examples use nearest-neighbour;
  scaled illustrative art can opt into linear/cubic sampling.
- Drawing order in Task 7 is React child order for retained sprites and item
  order inside a batch. A general layer/render graph is deferred.
- Invalid or disposed resources produce actionable development errors rather
  than undefined native behaviour.

---

## Proposed source organization

Keep files focused and keep native imports out of the headless subtree:

```text
packages/gamekit/src/
  assets/
    defineAssets.ts
    descriptors.ts
    errors.ts
    types.ts
    validation.ts
  sprites/
    defineSpriteSheet.ts
    spriteAnimationState.ts
    sampleSpriteClip.ts
    types.ts
  react/
    assets/
      decodeSkiaImage.ts
      createGameAssetStore.ts
      resourceCache.ts
      useGameAssets.ts
      types.ts
    sprites/
      GameWorld2D.tsx
      Sprite.tsx
      GameSprite.tsx
      SpriteBatch.tsx
      useSpriteBatch.ts
      types.ts
```

One focused public export per file is preferred. Internal helpers may be
grouped when they are inseparable. Every exported type/function/component needs
JSDoc that describes ownership, thread, units, failure, and disposal semantics.

---

## Execution plan

### T7.0 — Establish a clean, truthful baseline

**Type:** gate · **Depends on:** current pointer/package work

Do not mix the recent pointer, Brick Breaker layout, package-resolution, docs,
or performance-feedback changes into the asset implementation commits.

#### Work

- [x] Review the current dirty tree and split the already completed work into
  attributable commits before Task 7 implementation begins.
- [x] Reconcile the F1–F7 feedback checkboxes in
  `plans/performance-tasks.md` with the code and recorded evidence. A checked
  box without the required implementation/device evidence must be reopened or
  explicitly qualified.
- [x] Re-run the trailing-flush cases: a deferred final move reaches the
  session without another native move, terminal edges stay ordered, and no
  sampler stays active after the final pointer exits.
- [x] Re-run consecutive/cancelled manual-gesture lifecycle cases and prove
  pointer ownership releases exactly once before the next gesture begins.
- [x] Prove the disabled diagnostics path performs no timing reads, callbacks,
  or wrapper allocation during a normal fixed step.
- [x] Prove nested values stored on non-index string and symbol properties of
  arrays are included in the deep-immutability contract.
- [x] Prove stale layout/binding packets cannot acquire or release pointer
  ownership after the epoch changes.
- [x] Confirm the fixed paddle drag on a clean iPhone development build after a
  Metro restart, since package source-vs-built resolution was part of the bug.
- [x] Run the currently implemented mounted Performance Lab scenarios and
  archive a post-fix baseline for idle, native drag, and open/close lifecycle.
  Sprite-count scaling is introduced later in T7.7, after the sprite renderer
  and Atlas batch exist.
- [x] Record exact RN, Expo, Skia, Reanimated, Worklets, RNGH, `expo-asset`, iOS,
  and Android versions that Task 7 starts from.
- [x] Confirm root imports remain headless and React Native resolves package
  source while default Node/package resolution uses built output.

#### Done — T7.0 gate passed (2026-08-11)

- The dirty tree was split into attributable commits: session pointer-preserving
  transitions, F2/F3 pointer adapter, package source resolution, GameView
  context stabilization, portrait Brick Breaker + perf-lab definition, docs
  guide, playground config, F1 lab fixes, F4 diagnostics, F5 deep-freeze keys,
  F6 binding epochs (SHAs recorded in `plans/performance-tasks.md`).
- F1–F6 reconciled with code + evidence in `plans/performance-tasks.md` (F7
  stays device-gated and open).
- Live simulator baseline (dev-mode, iPhone 17 Pro Max simulator, iOS 26.5)
  through the mounted pipeline, recaptured after the review fixes: idle-active
  display 298 / commits 298 / ui 16.63 ms p50; engine-drag commits 298,
  input-to-commit 17.00 ms p50/p95 (18 p99), paddle-x p95/p99 288; native-drag
  raw 62 / forwarded 50 / sampled 297 / committed 296 / presented 296, paddle-x
  p99 179.77, input→present 15/16/16 ms (39 samples, one per consumed forward);
  stall display 289 / commits 289 / catch-up 4 / ui 16.63 p50 (pre-fix capture).
- Dependency snapshot Task 7 starts from: React Native 0.86.2, Expo SDK 57
  (expo ~57.0.10), React 19.2.3, Skia 2.11.0, Reanimated 4.5.3, Worklets
  0.10.3, RNGH 3.1.0, `expo-asset` ~57.0.8 (peer-aligned), Safe Area Context
  ~5.7.0, iOS 26.5 simulator / Android builds pending the device matrix.
- Headless root import proven: requiring `react-native-gamekit` loads no
  Expo/Skia/Reanimated/Gesture-Handler module; Metro consumes package `src/`
  while Node resolves built `lib/`.
- No Task 7 feature code landed in this gate.


---

### T7.1 — Freeze the API contract with call-site and type fixtures

**Type:** public API · **Depends on:** T7.0

Write consumer code before implementation. This is the RED phase for the
public surface and prevents internals from dictating the API.

#### Work

- [x] Add compile fixtures for the four examples above: image-only loading,
  sprite-sheet loading, deterministic animation, and an Atlas batch.
- [x] Add a shape-only game fixture proving `assets` remains optional.
- [x] Prove group, asset, frame, and clip names are inferred as string literals.
- [x] Add expected type failures for unknown groups/assets/frames/clips and for
  retrieving a descriptor through the wrong manifest.
- [x] Add a fixture proving a URL/string source is rejected in Task 7; remote
  sources remain a future discriminated descriptor rather than an accidental
  branch of the local loader.
- [x] Decide the exact `GameDefinition` and `GameRendererProps` generic order
  using real inference tests; users should not normally spell more generics
  than the renderer type needs.
- [x] Test both number props and supported Reanimated shared/derived values on
  the sprite surface.
- [x] Define the imperative API's ownership explicitly: an explicitly created
  store owns cache/native entries; `await store.acquire(...)` returns a fully
  ready lease; callers dispose leases and then the store in `finally`.
- [x] Define hook ownership explicitly: `useGameAssets` creates/owns its store
  and lease; the caller must not dispose the returned ready value manually.
- [ ] Record the accepted surface and rejected alternatives in a short decision
  section in this file or an existing architecture doc. Do not create another
  top-level document.

#### Required tests

- Type fixtures fail before the exports exist.
- No test imports Expo/Skia through the root entry.
- The final fixture examples are suitable for direct use in documentation.

#### Suggested commit

`test(api): define asset and sprite contracts`

---

#### T7.1 contract decisions (2026-08-11)

Accepted surface — frozen by the fixtures in `packages/gamekit/test/`:

- `defineAssets(groups)` returns a deeply readonly manifest; group, asset,
  frame, and clip names are preserved as string literals; retrieval goes
  through typed descriptor references (`loadedAssets.get(manifest.group.key)`),
  never duplicated strings.
- `image(source)` / `spriteSheet(source, { frames, animations })` accept a
  static module handle only. The source type is `number`; string/URL sources
  are rejected at the type boundary (a future remote-source descriptor is a
  separate discriminated kind, never a branch of the local loader).
- Sprite sheets: `frames` name rectangles; `animations` name clips with a
  discriminated `mode: 'loop' | 'once'`, a uniform `frameDurationMs`, and
  frame references restricted to the declared frame names. Per-frame
  durations are deferred: uniform duration only, so precedence cannot be
  misunderstood.
- Generic order: `GameDefinition<TScenes, TInput, TInitialScene,
  TAssets = undefined>` and `GameRendererProps<TScenes, TAssets = undefined>`
  — assets are the LAST generic on both, so shape-only games and renderers
  spell nothing new. `GameView` gains an optional `assets` prop carrying the
  loaded lease; the headless `GameSession` never owns native handles.
- `useGameAssets(manifest, { groups })` state shape:
  `{ status: 'loading'; progress: number }` | `{ status: 'error'; error;
  retry }` | `{ status: 'ready'; assets }`. The hook creates and owns its
  store and lease; callers must not dispose the ready value.
- Imperative ownership: `createGameAssetStore(manifest)` owns cache/native
  entries; `await store.acquire({ groups, signal })` resolves only with a
  complete usable lease; callers dispose the lease then the store in
  `finally`; `AbortSignal` detaches immediately.
- Animation: `startSpriteAnimation(descriptor, clip)` and
  `advanceSpriteAnimation(descriptor, state, deltaSeconds)` are headless,
  pure, fixed-step helpers; clip names are typed per descriptor.
- Rejected alternatives: string/URL sources, module-global native-image
  caches, automatic Sprite/SpriteBatch switching, wall-clock animation
  sampling, per-frame React state, and any public string-typed lookup.

### T7.2 — Implement the headless manifest and validation layer

**Type:** headless core · **Depends on:** T7.1

This phase contains no React Native or native imports. It creates immutable
descriptors and validates everything knowable before decoding.

#### Work

- [x] Replace the placeholder `AssetDescriptor`/`AssetSource` model with a
  discriminated image and sprite-sheet descriptor model.
- [x] Implement `image(...)`, `spriteSheet(...)`, and `defineAssets(...)` with
  exact generic inference from the accepted fixtures.
- [x] Add the manifest type to `GameDefinition` without making the headless
  `GameSession` own native assets.
- [x] Normalize a stable diagnostic id from group/key while preserving typed
  descriptor references for normal lookup.
- [x] Validate group/key identifiers, source kinds, rectangles, frame names,
  clip frame references, durations, and animation modes.
- [x] Deep-freeze the manifest and metadata using the established trusted
  deep-freeze rules without exposing the session's internal cache.
- [x] Add structured definition errors with stable codes and field paths.
- [x] Reject string/URL sources with a specific unsupported-source error at an
  untyped JavaScript boundary; do not begin a network request.
- [x] Export only the intended headless surface from `src/index.ts`.

#### TDD cases

- Valid image and sheet manifests preserve literal types and values.
- The input object and returned manifest cannot be mutated after definition.
- Empty/reserved keys, invalid rectangles, empty clips, unknown frames, and
  invalid durations fail with the correct code/path.
- Two descriptors using the same source remain two logical asset identities;
  runtime decoding may later deduplicate their shared source.
- Defining assets performs no I/O and allocates no native handle.
- A Node test importing `react-native-gamekit` does not evaluate Expo or Skia.

#### Suggested commit

`feat: add typed game asset manifests`

---

**Status (2026-08-11):** implemented + tested (commit `566d866`). See
`test/assetManifest.test.ts` and the T7.1 manifest fixture.

### T7.3 — Implement deterministic sprite animation primitives

**Type:** headless core · **Depends on:** T7.2

Keep animation definition and sampling independently testable without a
renderer or simulator.

#### Work

- [x] Compile named frame references into a compact immutable lookup suitable
  for both fixed-step JS use and worklet capture.
- [x] Implement the pure clip sampler with exact loop and one-shot boundary
  semantics.
- [x] Implement immutable `start`, `advance`, `play/change`, `pause`, `resume`,
  and reset helpers for serializable animation playback state.
- [x] Support a finite positive speed multiplier and advance a large delta with
  bounded arithmetic rather than an unbounded frame-by-frame loop.
- [x] Expose completion without requiring a gameplay system to infer it from a
  visual frame.
- [ ] Provide an allocation-free frame-index path if profiling confirms the
  ergonomic sampler allocates on every UI frame.
- [x] Document the separation between simulation animation state
  (`clip`, start tick/time, play state) and presented frame selection.
- [x] Ensure animation metadata contains only serializable numeric/string data;
  Skia rectangles are created in the adapter rather than stored in the
  headless descriptor.

#### TDD cases

- Frame selection is exact immediately before, at, and after every boundary.
- Looping wraps without a duplicate/zero-length boundary frame.
- One-shot clips hold their last frame and report completion.
- A single-frame clip is stable for all elapsed values.
- Per-frame durations and uniform durations produce the documented timeline.
- Pause/resume, restart, clip change, speed, and large-delta behaviour are exact
  and return new immutable state.
- Finite negative elapsed time follows the chosen clamp policy; NaN/infinity
  fails clearly.
- Equivalent elapsed game time produces identical results at simulated
  30/60/90/120 Hz presentation schedules.
- The sampler is worklet-compatible and does not capture native objects.

#### Suggested commit

`feat: add deterministic sprite clip sampling`

---

**Status (2026-08-11):** implemented + tested (commits `c1b9732`,
`566d866`). See `test/spriteAnimation.test.ts` and the T7.1 animation fixture.

### T7.4 — Build the Expo/Skia loader and owned resource cache

**Type:** native adapter · **Depends on:** T7.2

Separate source resolution, byte/data loading, image decoding, validation, and
ownership so each part can be tested without a device.

#### Implementation shape

```text
AssetResolver (Expo static module -> local URI + metadata)
  -> ImageDecoder (URI/data -> SkImage)
  -> RuntimeValidator (decoded dimensions vs. frames)
  -> explicit GameAssetStore
  -> ResourceCache (in-flight dedupe + ref count)
  -> LoadedGameAssets lease (typed get + dispose)
```

#### Work

- [x] Verify the installed `expo-asset` and Skia APIs against their official
  docs and installed types before coding. Record the exact primitives used.
- [x] Define internal `AssetResolver` and `ImageDecoder` interfaces so unit
  tests use fakes rather than importing native modules.
- [x] Implement `createGameAssetStore(manifest)` as the explicit cache owner;
  reject acquisitions after store disposal and make store disposal idempotent.
- [x] Resolve static module handles through Expo Asset and decode through the
  supported Skia data/image APIs.
- [x] Dispose temporary decode data such as `SkData` as soon as the supported
  Skia ownership contract permits; final `SkImage` ownership remains with the
  cache entry until its last lease is released.
- [x] Treat a null decode as a structured load failure, not a ready resource.
- [x] Validate each sprite frame against decoded width/height before publishing
  readiness.
- [x] Deduplicate simultaneous loads by canonical resolved source plus decode
  options; logical descriptor identity remains separate.
- [x] Implement reference counts and idempotent disposal. Dispose the Skia
  image exactly once when the final lease releases it.
- [x] Ensure a partially failed group releases everything acquired only by that
  attempt while preserving entries still leased elsewhere.
- [x] Add an attempt/epoch token so stale completion after retry/unmount cannot
  become current.
- [x] Accept `AbortSignal` for imperative acquisition and document honest
  logical cancellation when Expo cannot stop the underlying work.
- [x] Make progress aggregation monotonic and based on requested logical
  resources; document whether a deduplicated source counts once or once per
  logical descriptor.
- [x] Implement `LoadedGameAssets.get(descriptor)` with a disposed-state guard
  in development.
- [x] Keep cache storage bounded by live/in-flight leases. Do not create an
  immortal module-global image cache.
- [ ] Add optional development placeholders only after the required failure
  path is correct and tested.

#### TDD cases

- One local image resolves, decodes, validates, and returns ready.
- Two concurrent logical assets with the same source decode once.
- Two leases share a resource; disposing the first keeps it alive and disposing
  the second calls native `dispose()` once.
- Duplicate `dispose()` is harmless.
- Decode-null, resolver rejection, unsupported type, and out-of-bounds frame
  produce distinct structured errors.
- Failure after N successful acquisitions releases only the attempt's owned
  references.
- Retry ignores old completion and cannot double-dispose.
- Abort before start, during an unshared load, during a shared load, and after
  readiness follows the documented ownership rules without late progress.
- Empty groups complete immediately.
- Progress is monotonic and reaches exactly one before ready is emitted.
- Store acquisition never resolves a partially ready lease.

#### Suggested commit

`feat(react): load and own Skia image assets`

---

**Status (2026-08-11):** implemented + tested (commit `7412b38`). See
`test/assetStore.test.ts` (14 ownership tests with injected pipeline fakes),
`test/useGameAssets.test.tsx` (6 hook tests), and the T7.1 loading fixture.

### T7.5 — Add React loading and `GameView` asset delivery

**Type:** React adapter · **Depends on:** T7.4

The React layer adapts the owned store/acquisition model to component
lifecycle. It does not become the frame store.

#### Work

- [x] Implement `useGameAssets(manifest, options)` over a hook-owned store and
  acquisition with the discriminated loading/ready/error contract.
- [x] Keep the requested `groups` value semantically stable; document or
  normalize ordering so `['boot', 'play']` and a recreated equivalent array do
  not reload every React render.
- [x] Invalidate stale attempts before releasing their resources.
- [x] Make `retry` stable and ensure one user action starts one new attempt.
- [x] Extend `GameView` and `GameRendererProps` with the typed, stable asset
  lease accepted in T7.1.
- [x] Keep the asset lease out of `GameSession`, `CommitFrame`, shared frame
  values, and snapshot serialization.
- [x] Ensure changing the lease follows an explicit policy. Recommended:
  require a new mounted running-game boundary rather than hot-swapping native
  resources under a live renderer.
- [ ] Add an optional small loading-boundary example, not a mandatory visual
  component with GameKit branding.

#### TDD/integration cases

- Loading -> ready mounts the running child once.
- Loading -> error exposes the structured error and stable retry action.
- Retry ignores stale completion from the first attempt.
- Unmount during loading never updates React and leaves no lease alive.
- Unmount after ready releases hook-owned resources once.
- An equivalent group list does not reload.
- A renderer receives the exact stable ready lease without a per-commit React
  rerender.
- Replacing a ready lease requires the documented unmount/remount boundary;
  compile and lifecycle fixtures prove a live renderer never observes native
  handles hot-swapped underneath it.
- A session is not created in the loading/error branch in the reference usage.

#### Suggested commit

`feat(react): add game asset loading lifecycle`

---

**Status (2026-08-11):** implemented (commit `c074a7b`): transform math
(8 pure tests), `GameWorld2D`, `Sprite` (single-entry Atlas sheet path with
worklet frame resolution), `GameSprite` (exact per-scene selectors), and the
T7.1 sprite fixture compiles. The visual/device cases (crispness, coexistence
with raw Skia shapes, retained-vs-batch benchmark) remain pending the
simulator/device verification in T7.8/T7.10.

### T7.6 — Add retained `Sprite` and `GameSprite` primitives

**Type:** Skia rendering · **Depends on:** T7.3, T7.4, T7.5

Build the ergonomic path first. Keep the component small, composable with raw
Skia nodes, and stable across animation frames.

#### Work

- [x] Implement full-image sprites and sprite-sheet frame selection using a
  source-verified Skia drawing path.
- [x] Implement `GameWorld2D` as one viewport-offset/scale group shared by all
  child sprites. It must not add camera state, subscribe React per frame, or
  apply the viewport transform once per child.
- [x] Support logical position, anchor, scale, rotation in radians, opacity,
  tint, flip, sampling, and visibility according to the contracts above.
- [x] Accept static values and supported Reanimated shared/derived values
  without mirroring them through React state.
- [x] Precompute static source rectangles and metadata once per resource, not
  once per frame.
- [x] Define exact transform order and test the matrix/pivot math as pure code.
- [x] Keep React child order as the drawing order and document it.
- [x] Implement `GameSprite` as the common GameKit integration: it accepts the
  commit/alpha values, narrows by scene, invokes one worklet selector, and
  drives the underlying `Sprite` through one coherent derived value.
- [x] Interpolate position, rotation, uniform scale, and opacity when the
  selector requests interpolation; choose clip/frame, tint, visibility, and
  flip discretely from the committed current snapshot.
- [x] Keep the selector's scene typing exact so a `scene="play"` selector
  receives only the play snapshot without casts.
- [ ] Benchmark the ergonomic grouped-object selector against a compact
  numeric/setter representation at 32 and 100 retained sprites. If allocation
  or mapper work is material, change the public hot path before accepting the
  API; do not merely document the regression.
- [x] Fail clearly when a frame name belongs to another sheet or a loaded lease
  has been disposed.
- [ ] Add a development-only bounds/debug overlay if it can be completely
  eliminated from the normal path.

#### TDD and visual cases

- Anchor and transform math is correct for top-left, centre, and bottom-centre.
- Flip preserves the selected anchor and does not change source selection.
- Opacity/tint/sampling map to the intended Skia properties.
- Frame changes update pixels without remounting the React component.
- A normal moving/animated game sprite requires no author-written
  `useDerivedValue` or Skia `select()` plumbing.
- Scene mismatch and transition hard cuts hide/select the sprite according to
  a documented rule without briefly reading the wrong snapshot type.
- One `GameWorld2D` applies the viewport transform for the renderer and nests
  correctly with raw Skia nodes.
- A static sprite causes no continuous React render.
- Pixel-art sampling stays crisp at integer scales in the visual fixture.
- Retained sprites coexist with raw Skia shapes inside one renderer.

#### Suggested commit

`feat(react): render retained 2d sprites`

---

### T7.7 — Add Atlas-backed `SpriteBatch` and sprite scaling lab

**Type:** performance/rendering · **Depends on:** T7.6 and T7.0 baseline

This phase must be measurement-led. Skia Atlas is the intended shared-texture
batching primitive, but GameKit still has to prove its buffer ownership and API
on supported devices. This is also where the deferred shared-texture sprite
scaling scenario is added to the Performance Lab; do not pretend that scenario
exists before this task lands.

#### Prototype first

- [ ] Prototype the official `Atlas`, `useRectBuffer`, and
  `useRSXformBuffer` path with 32/100/500/1,000 instances.
- [ ] Compare it with the retained `Sprite` path on the same decoded texture,
  scene, transforms, device, build mode, and duration.
- [ ] Measure UI p50/p95/p99, missed frames, mapper count, JS/UI crossings,
  allocation/GC, memory, and mount/unmount cost.
- [ ] Test phone and iPad portrait/landscape; include a mid-range Android
  device before selecting defaults.
- [ ] Record the crossover data. Do not publish a universal "use batching over
  N sprites" rule unless results are consistent across the matrix.

#### Implementation

- [x] Implement a fixed-capacity batch with a stable underlying Skia image,
  source-frame buffer, transform buffer, and optional color/tint buffer.
- [x] Make active count explicit and reject writes past capacity in
  development. Define safe production behaviour rather than corrupting memory.
- [x] Keep buffer updates on the UI runtime. Crossing a complete entity array
  from JS every display frame is not an acceptable batch design.
- [x] Own the derived/reaction plumbing inside `SpriteBatch`; the normal API
  must not require authors to use a derived value for side effects.
- [x] Prefer compact setter/numeric writes over temporary per-sprite objects in
  the hot path; preserve the readable author-facing wrapper where profiling
  shows it is free enough.
- [x] Reuse buffers for the mounted lifetime and release all native resources
  on unmount.
- [x] Define item ordering, tint, opacity, hidden slots, frame selection,
  rotation, scale, and anchor parity with `Sprite`.
- [x] Do not put unrelated textures in one batch. Multiple sheets may share a
  batch only if they resolve to the same Skia image and compatible metadata.
- [x] Add development diagnostics for capacity, active count, and buffer
  updates without adding default production work.

#### TDD/acceptance

- Capacity 0/1/max and overflow behaviour are explicit.
- Reducing active count prevents stale slots from drawing.
- Frame/transform/color buffers stay aligned for every active index.
- Recreated React parents do not replace a live batch or lose its buffers.
- Unmount disposes batch-owned native objects once but does not dispose an
  image still owned by the asset lease.
- The final implementation beats or materially simplifies the retained path in
  the measured dense scenarios; otherwise keep it experimental and document
  the evidence honestly.

#### Suggested commits

- `test(perf): benchmark retained and atlas sprites`
- `feat(react): add atlas sprite batching`

Keep the benchmark and implementation changes attributable.

---

**Status (2026-08-11):** implemented + committed (T7.7: `3e0d91c`). The
benchmark-led comparison (retained vs batch on the device matrix) and the
sprite-scaling lab scenario remain part of T7.10's device/evidence work —
simulator numbers are development proxies only.

### T7.8 — Build a sprite reference game in the playground

**Type:** vertical slice · **Depends on:** T7.5–T7.7

Add a new catalog game rather than rewriting Brick Breaker. Brick Breaker
remains the shape/input regression example; the new game proves the new public
surface as a consumer would use it.

#### Recommended example: Sprite Field

A small top-down scene with one controllable animated character and a bounded
field of repeated animated/decorative sprites:

- loading screen with real group progress;
- visible, retryable development failure mode;
- idle/run character clips selected from deterministic scene state;
- a retained player sprite;
- many repeated objects/enemies rendered with `SpriteBatch`;
- a simple input path using the existing pointer/button primitives;
- phone and tablet viewport layouts;
- pause/background/resume without animation-time jumps;
- score/status in a low-frequency React overlay, not the render hot path; and
- clean close/reopen resource and session ownership.

Use purpose-created or clearly licensed repository assets and record their
source/license. Do not copy copyrighted game art from an existing title.

#### Work

- [ ] Add assets under the playground with consistent lowercase paths/casing.
- [ ] Declare them through the public package API; no playground-only loader.
- [ ] Add a new typed catalog id and exhaustive screen registry entry.
- [ ] Keep screen chrome separate from the game surface and preserve the
  current safe-area/back behaviour.
- [ ] Make "tap to start" respond across the gameplay body, excluding the
  title/back chrome, using the established input rules.
- [ ] Start the session only inside the ready child and dispose it once on
  close.
- [ ] Add a deliberate development-only missing-asset scenario or test fixture
  for error/retry verification.
- [ ] Add deterministic headless tests for the example's game rules and clip
  selection.
- [ ] Add mounted tests for loading -> play -> close -> reopen.

#### Done when

- The new game demonstrates every Task 7 public API without internal imports.
- No sprite position or animation frame is held in React state.
- Reopening starts a fresh session while safe shared assets obey their lease
  policy.
- It behaves correctly on a phone and an iPad in portrait and landscape.

#### Suggested commit

`feat(playground): add sprite field reference game`

---

#### T7.8 simulator verification (2026-08-11)

Verified on the iPhone 17 Pro Max simulator (dev build): the Sprite Field
game opens with an honest loading boundary (progress 0 -> ready), the
renderer draws the retained player sprite and the Atlas enemy field from
the public surface, and pointer-following movement accumulates score from
deterministic scene state (measured score 143 over a 2.5 s drag; idle/run
clip selection switches with movement). The mounted pointer pipeline is
also healthy: the lab's native-drag run records raw 70 / forwarded 56,
paddle-x p99 187.64, input→commit p50 16 ms, input→ui-observed p50 33 ms,
samplers-at-end 0 (after the content roots were fixed to pass touches
through — the full-screen content views were intercepting every touch
before the RNGH surface).

Known stack limitation (recorded for F7): RNGH recognizer delivery dies
after the first in-place session swap on the persistent surface — the
first game's touches work; after switching games, subsequent detectors do
not begin gestures (reproduced with and without detector remount keys and
with frame re-seeding). This is the same upstream RNGH/Skia remount class
found in T7.0; it is tracked for the F7 device matrix and the physical
builds must validate the swap path. The close/reopen resource path is
covered by the headless session-disposal tests and the F7 50-cycle gate.

**Status (2026-08-11):** complete (`3566dd6`): six new Fumadocs pages
wired into the navigation, the docs index links to the sprite guide, the
docs build passes, and the project-local game-assets skill gained the
GameKit workflow addendum (layout, accepted API, rejection checklist,
recipes, diagnostics).

### T7.9 — Documentation and agent workflow

**Type:** docs · **Depends on:** accepted API and reference game

Documentation must explain the simple path first and make performance/ownership
rules hard to miss. Update the existing Fumadocs structure; do not add an
unlinked markdown dump.

#### User documentation

- [ ] Update **Create Your First Game** without making its bare shape example
  depend on assets.
- [x] Add **Create Your First Sprite Game** using the exact compile-tested
  reference API.
- [x] Add an **Assets** concept page: manifests, groups, local `require`, load
  states, errors/retry, typed lookup, ownership, and disposal.
- [x] Add a **Sprites and Sprite Sheets** page: frames, anchors, transforms,
  sampling, tint, flip, and drawing order.
- [x] Add a **Sprite Animation** page: fixed-step state, presentation sampling,
  loop/one-shot semantics, and pause/resume.
- [x] Add a **Sprite Batching** performance page: retained vs Atlas, measured
  device results, capacity, buffers, and when not to batch.
- [x] Document supported formats/platforms and local-asset limitations.
- [x] Document every public error code with a direct corrective action.
- [x] Update package/API reference and navigation metadata.

#### Agent-facing workflow

- [x] Update the project-local game development/asset skill only after the API
  is accepted, using the reference game as the canonical template.
- [x] Give agents one prescribed file layout for assets, definitions, scenes,
  renderer, and tests.
- [x] Add a checklist that rejects per-frame React state, wall-clock animation,
  unowned native handles, untyped asset strings, and remote URLs in this
  version.
- [x] Include small copyable recipes for one sprite, a clip, and a batch rather
  than a giant generated game.
- [x] Add diagnostic examples showing the expected error and fix for a missing
  asset, bad frame rectangle, and disposed lease.

#### Documentation quality gate

- Every documented snippet is compiled or sourced directly from a compiled
  fixture.
- The docs app builds with no broken links.
- A new contributor can reach the sprite reference game from the home page.

#### Suggested commit

`docs: add asset and sprite game guides`

---

**Status (2026-08-11):** automated verification complete: lint,
typecheck, full tests (238 GameKit + playground), coverage gate, package
build + tarball inspection (root/react exports + declarations present,
sprite modules packaged), built-root Node import loads no native modules,
docs build + Expo export, `git diff --check`. The physical-device matrix,
the retained-vs-batch device benchmarks, the 50-cycle leak gate, and the
release-like builds remain device-gated (no physical hardware in this
environment) and are tracked with F7.

### T7.10 — Verification, packaging, and native acceptance

**Type:** release gate · **Depends on:** all previous Task 7 work

#### Automated verification

- [x] Run focused tests during each RED/GREEN cycle.
- [x] Run `pnpm lint`.
- [x] Run `pnpm typecheck`.
- [x] Run the full workspace test suite.
- [x] Run `pnpm test:coverage:gate`; new executable asset/sprite code must meet
  the repository's 80% coverage requirement.
- [x] Run the package build.
- [x] Run `pnpm pack:inspect` and inspect the tarball for root/react exports,
  declarations, source/build parity, and missing asset-related files.
- [x] Verify a normal Node import of the root entry does not evaluate native
  dependencies.
- [x] Build the docs app and Expo playground.
- [x] Run `git diff --check`.

#### Native/device matrix

- [ ] iPhone 60 Hz development and release-like builds.
- [ ] ProMotion iPhone at 120 Hz where available.
- [ ] iPad portrait, landscape, and split view.
- [ ] iPad Pro 120 Hz where available.
- [ ] Mid-range Android in its supported refresh modes.
- [ ] App background/resume while loading and while animation is active.
- [ ] Rotation/resize while ready and during active play.
- [ ] Offline launch with all required bundled assets.
- [ ] Deliberate missing/corrupt asset error and retry.
- [ ] Fifty open/close cycles with memory/resource inspection.

#### Performance evidence

- [ ] Capture retained and batch scenarios at 32/100/500/1,000 sprites using
  the T7.0 measurement method.
- [ ] Record UI and JS p50/p95/p99, missed frames, crossings, mapper/buffer
  count where observable, memory, mount time, decode time, and disposal time.
- [ ] Compare against the pre-Task-7 mounted baseline on the same devices and
  thermal conditions.
- [ ] Confirm static topology causes no per-frame React renders.
- [ ] Confirm idle asset ownership introduces no permanent UI frame callback or
  recurring JS timer.
- [ ] Establish and record supported batch capacities from evidence. Do not
  advertise a capacity that misses the device frame budget.

#### Final acceptance criteria

Task 7 is accepted only when all of the following are true:

1. A local image and sprite sheet can be declared with fully inferred types.
2. Loading reports honest progress/error/ready states and never exposes a
   half-ready store.
3. Concurrent identical sources decode once and dispose only after the final
   lease releases them.
4. A failed, retried, or abandoned load leaks no acquired Skia handle.
5. A running session is not created before its required assets are ready.
6. A retained sprite supports the documented frame/transform/sampling surface
   without per-frame React state, and `GameSprite` hides the routine mapper and
   Skia-property-selection plumbing.
7. Sprite animation is deterministic across 30/60/90/120 Hz schedules.
8. The Atlas batch has bounded capacity, stable buffers, and recorded device
   evidence.
9. The Sprite Field example works on phone, iPad, and Android and uses only
   public package exports.
10. Fifty open/close cycles show no retained session, asset lease, SkImage,
    batch buffer, listener, or unbounded memory growth.
11. Root imports remain native-free and the published package contains working
    source, module, and type entrypoints.
12. Lint, typecheck, tests, coverage, package build, docs build, Expo build, and
    whitespace checks all pass.

---

## Execution order

```text
T7.0  truthful baseline
  |
T7.1  compile-first public contract
  |
  +--> T7.2  headless asset manifest
          |
          +--> T7.3  deterministic animation
          |
          +--> T7.4  Expo/Skia loader + ownership
                    |
                    +--> T7.5  React/GameView integration
                              |
                              +--> T7.6  retained Sprite
                                        |
                                        +--> T7.7  Atlas SpriteBatch
                                                  |
                                                  +--> T7.8  reference game
                                                            |
                                                            +--> T7.9  docs/skills
                                                                      |
                                                                      +--> T7.10 release gate
```

T7.3 and most of T7.4 may proceed in parallel after T7.2 because the animation
sampler is headless and the loader is adapter-specific. All public names must
still remain governed by the T7.1 fixtures.

---

## Required implementation discipline

- Use TDD for each task: failing behavioural/type test, minimal implementation,
  then refactor with the same tests green.
- Keep one attributable concern per commit. Loader ownership, React lifecycle,
  retained sprites, batching, and docs are separate commits.
- Run the relevant focused test after each change and the full gate before each
  milestone commit.
- Do not weaken snapshot immutability, transition atomicity, input edge
  semantics, viewport agreement, or package entry isolation.
- Do not optimize from simulator impressions alone. Profile release-like builds
  on physical devices and label simulator results as proxies.
- Prefer official Expo, Skia, Reanimated, and React Native docs plus the exact
  installed source/types when behaviour is version-specific.
- Review code after each implementation phase and resolve Critical/High
  findings before continuing.
- Before any commit, inspect the staged diff and check for secrets, accidental
  binary assets, machine-specific paths, generated noise, and unrelated dirty
  files.

---

## Source references for implementation

- React Native Skia images:
  <https://shopify.github.io/react-native-skia/docs/images/>
- React Native Skia Atlas:
  <https://shopify.github.io/react-native-skia/docs/shapes/atlas/>
- React Native Skia rendering modes:
  <https://shopify.github.io/react-native-skia/docs/canvas/rendering-modes/>
- React Native Skia textures:
  <https://shopify.github.io/react-native-skia/docs/animations/textures/>
- Expo Asset SDK 57:
  <https://docs.expo.dev/versions/v57.0.0/sdk/asset/>
- Existing architecture and ownership research:
  [`../REACT_NATIVE_GAMEKIT_RESEARCH.md`](../REACT_NATIVE_GAMEKIT_RESEARCH.md)
- Existing measured performance plan:
  [`./performance-tasks.md`](./performance-tasks.md)

Official documentation and the installed dependency types/source are the
authority for implementation details. If they disagree, record the exact
installed-version behaviour and do not silently code to a different release.

---

## Feedback — T7.0 follow-up review

**Review status (2026-08-11):** the first follow-up fixed the original inactive
trailing-flush callback, the array-owned deep-freeze traversal, duplicate
latency samples, the obvious binding-epoch mismatch, and the earlier plan
checkbox contradictions. The implementation is substantially stronger, but
T7.0 should be treated as **reopened** until the items below are resolved. T7.1
must not use the current latency numbers as an accepted input-to-visible
baseline.

Work in the listed order. F1 defines whether the native-input measurement is
valid; F2 and F3 close remaining pointer lifecycle races; F4 makes the
performance gate auditable; F5 reconciles the plan only after the code and
evidence are correct.

### F1 — Measure an input-bearing presentation, not an unrelated commit

**Priority:** Important · **Blocks:** T7.0 baseline acceptance and performance
conclusions

**Problem:** sequence numbers now prevent the same retained forward timestamp
from being sampled repeatedly, but they do not establish causality. The UI
runtime records a forward before `scheduleOnRN` necessarily delivers it to the
session. `GameView` then invokes `onPresentCommit` when a new commit is assigned
to its frame shared value on the RN runtime. That callback does not prove that:

- the forwarded event reached the input buffer before the fixed step;
- the commit contains the sampled input;
- the UI runtime observed that commit; or
- Skia presented the resulting frame.

`latestForwarded` also retains only one value. When multiple forwards occur
between presentation observations, earlier sequences can be overwritten. The
current implementation therefore provides deduplicated latest-event sampling,
not “each forwarded input consumed exactly once,” and the recorded 15/16/16 ms
must remain labelled as a development-simulator proxy.

#### Required approach

1. Define the exact metric before changing code. Prefer distinct stages rather
   than one ambiguous number:
   - native/UI touch timestamp -> RN binding dispatch;
   - accepted input -> first simulation commit that sampled it; and
   - that commit -> first UI frame callback that observes its revision.
2. Carry a monotonic forward sequence and timestamp with the pointer packet
   across `scheduleOnRN`. Do not infer packet delivery by reading a separate
   “latest” shared value later.
3. Acknowledge the sequence only after `PointerBinding.dispatch()` accepts the
   packet. Stale or rejected packets must never become latency samples.
4. Associate the accepted sequence with the first fixed-step commit that
   samples it. Preserve that association through the commit instrumentation so
   an unrelated commit cannot consume the sequence.
5. Observe the associated revision from the UI runtime on the first display
   frame that sees it. If the available Skia API cannot prove actual GPU
   presentation, name the metric honestly (for example,
   `input-to-ui-observed`) and reserve `input-to-visible`/`input-to-present` for
   a presentation primitive that provides that guarantee.
6. Use a bounded, constant-space pending structure. Do not append an unbounded
   per-input history to a shared value. If several inputs are intentionally
   represented by one fixed-step commit, document whether the metric samples
   the newest accepted input, the oldest, or one aggregate for that commit.
7. Keep the existing engine-input enqueue -> commit measurement separate. It
   must not be silently combined with native/UI pipeline latency.

#### RED-first tests

- [ ] A presentation callback that occurs before RN dispatch records no sample.
- [ ] A commit that did not sample the forwarded input records no sample.
- [ ] A rejected stale-epoch packet records no latency sample.
- [ ] The first UI observation of the matching input-bearing revision records
  exactly one sample; later observations of that revision record none.
- [ ] Multiple forwards between commits follow the documented aggregation rule
  without duplicate or falsely attributed samples.
- [ ] Pending forwards at run end remain explicitly unmatched and do not become
  fabricated samples.
- [ ] Run replacement/reset clears every sequence, pending association, and
  accumulator so a late event from the previous run cannot contaminate the
  next result.

#### Acceptance evidence

- [ ] The result schema reports matched, unmatched, rejected, and superseded
  forward counts so sample loss is explainable.
- [ ] Simulator output is labelled as a proxy.
- [ ] Release-like physical-device capture records the exact device, refresh
  rate, build mode, run count, thermal state, and p50/p95/p99.

### F2 — Deactivate the trailing-flush sampler on binding replacement

**Priority:** Important · **Blocks:** pointer lifecycle correctness and the
“no idle sampler” performance contract

**Problem:** normal `up`, cancel, and finalization paths mirror the coalescer's
terminal event into `pointerActive`. Binding cleanup instead resets the shared
coalescer directly without clearing that React mirror. If `game`, `action`, or
viewport-owner identity changes during an active touch, the sampler can remain
mounted after the coalescer no longer owns a pointer and run an empty frame
callback indefinitely. A later `up` can also produce an empty coalescer batch,
so it is not guaranteed to repair the stale React state.

#### Required approach

1. Make sampler ownership belong to a specific binding generation, not to an
   unqualified boolean that survives prop replacement. A state value such as
   `{ bindingGeneration, active }` or an equivalent keyed owner makes a new
   binding inactive by construction.
2. During replacement, invalidate the old generation before accepting packets
   for the new one, neutralize old input ownership exactly once, reset the
   coalescer, and remove the old sampler.
3. Do not rely on a future touch edge to perform cleanup. Replacement, unmount,
   cancellation, and final pointer exit must each reach a complete terminal
   state independently.
4. Keep sampler mounting outside the per-frame React path. React state may
   change on pointer/binding boundaries only; it must never mirror move events
   or display frames.
5. Retain the conditional-mount strategy unless device evidence shows a safer
   supported Reanimated lifecycle. The previously attempted runtime
   `setActive()` path crashed in this exact dependency stack and must not be
   restored without a focused reproduction and dependency-source justification.

#### RED-first tests

- [ ] Active pointer -> replace `game` -> old sampler unmounts and old input is
  neutralized exactly once.
- [ ] Active pointer -> replace `action` -> no empty frame sampler remains.
- [ ] Active pointer -> replace viewport owner -> old terminal callbacks are
  harmless and the new binding starts inactive.
- [ ] A late `up`, cancel, or finalize from the old generation cannot alter the
  new generation's sampler state.
- [ ] A fresh pointer on the replacement binding activates one sampler and its
  terminal edge removes it.
- [ ] Repeated replacement/unmount is idempotent and leaves no frame callback,
  scheduled callback, binding, or input ownership behind.

#### Acceptance evidence

- [ ] Add a mounted adapter test or a narrow injected frame-sampler seam; pure
  reducer tests alone do not prove React mount/unmount lifecycle.
- [ ] Instrument active sampler count in the Performance Lab and prove it is
  zero after pointer exit, replacement, close, and reopen.

### F3 — Remove the post-commit/pre-effect epoch synchronization window

**Priority:** Important · **Blocks:** immediate input after session/action/
viewport-owner replacement

**Problem:** the replacement binding starts at epoch zero while the shared
epoch can still contain the previous binding's value. A passive `useEffect`
re-synchronizes them after commit. New gesture callbacks can therefore be
installed before synchronization finishes; an immediate touch can be stamped
with the stale shared epoch and rejected by the fresh binding. The current
“adapter-level” test manually copies `replacement.epoch` into a local value and
does not mount the component or exercise React effect ordering.

#### Required approach

1. Prefer a monotonic adapter-owned binding generation that never resets to
   zero. Stamp it directly into each worklet packet and make the RN binding
   validate the same generation. Keep layout revision invalidation separate if
   that makes ownership clearer.
2. Do not repair mismatched owners after commit with a passive synchronization
   effect. The packet producer and consumer must agree before the replacement
   gesture can receive native events.
3. If a layout-phase synchronization is used as an interim fix, prove from the
   installed React/RNGH/Reanimated lifecycle that native input cannot arrive in
   between. Do not assume `useLayoutEffect` is sufficient without the mounted
   regression test.
4. Preserve stale-packet rejection: delayed packets from the previous binding
   or layout revision must remain rejected, including terminal packets using a
   reused native pointer id.
5. Ensure generation changes and sampler cleanup form one replacement
   transition. Avoid independent effects whose ordering is the correctness
   mechanism.

#### RED-first tests

- [ ] Invalidate the old binding, replace it, and dispatch a begin immediately
  after the new commit but before passive effects; the begin is accepted.
- [ ] A delayed packet from the old binding is rejected after replacement.
- [ ] A stale terminal packet cannot release a new capture that reuses the same
  native pointer id.
- [ ] Replacement after one or more layout-epoch increments still accepts the
  first new pointer without waiting for another render or layout event.
- [ ] Game, action, and viewport-owner replacement each exercise the mounted
  adapter path rather than only constructing two `PointerBinding` instances.

#### Acceptance evidence

- [ ] Run the immediate-touch replacement case repeatedly on the connected
  iPhone development build and record the build/dependency versions.
- [ ] Rotation and iPad split-view validation remain part of F7; simulator
  tests cannot close those device gates.

### F4 — Make the deep-freeze benchmark gate auditable and stable

**Priority:** Important · **Blocks:** trusting the T3/F5 performance gate

**Problem:** the benchmark prints one measurement for every size and then
re-measures the 32- and 1,000-entity cases for its pass/fail gate. A single run
during review printed 1.9x at 32 entities (below the documented 2.5x floor),
then re-measured 3.4x and passed. The visible table and final verdict can thus
contradict each other. The `iterations` parameter is also currently unused, so
the smallest case measures only microseconds and is dominated by noise.

#### Required approach

1. Measure each configured size once per benchmark invocation, retain the
   result object, print it, and gate that exact same result. Never run a hidden
   second measurement for acceptance.
2. Make each timed sample long enough to rise above timer and scheduler noise.
   Use batched snapshot operations per sample, honor an explicit iteration
   count, warm both implementations consistently, and report per-operation
   time from the batch.
3. Use several batches and a documented robust statistic such as the median.
   Record dispersion or the observed range so an unstable threshold is visible.
4. Keep the compared workloads equivalent. Both legacy and cached paths must
   build the same logical frames and perform the same number of operations.
5. If the result is too noisy to decide, fail or report the gate as
   inconclusive; do not pass using a lucky second sample.
6. Recalibrate floors only from recorded repeated runs on the documented Node
   version and hardware. Preserve the complete floor history and explain why a
   new floor still catches the legacy full-walk regression class.

#### Tests and acceptance

- [ ] Extract the gate decision into a pure helper and test values immediately
  above and below each floor.
- [ ] Prove the printed rows and gated values come from the same retained
  measurement objects.
- [ ] Run the benchmark at least five times; no invocation may print a failing
  gated row and then report success.
- [ ] Record Node version, CPU/device, iteration count, batch count, statistic,
  corrected ranges, and final floors in the benchmark header and plan.
- [ ] Retain tests for non-enumerable own values, inherited values, symbols,
  canonical indices, numeric-looking non-indices, sparse arrays, cycles, and
  getter failures.

### F5 — Reconcile Task 7 and performance documentation with final evidence

**Priority:** Important · **Depends on:** F1-F4

**Problem:** the code and several tests are newer than the status prose. The F5
performance entry still describes the rejected allocation-free `for-in` scan
and the old 4x/8x floors; the F2 status omits the final conditional-sampler
commit (`76908aa`); the latency prose overstates latest-event deduplication as
consuming every forwarded input; and T7.0 checks off an open/close baseline
without recording matching post-fix results.

#### Required changes

1. Update the F2 evidence to include the final conditional-sampler commit and
   the mounted lifecycle tests introduced by F2/F3 above. Do not use raw ->
   forwarded reduction alone as proof that the trailing frame flush ran.
2. Rewrite the F5 status to describe `Object.getOwnPropertyNames` plus symbol
   traversal, own/non-enumerable behaviour, canonical array-index handling,
   and the final benchmark implementation and floors from F4.
3. Replace “each forwarded input consumed exactly once” with the precise metric
   semantics established in F1. Report matched and unmatched counts next to
   latency percentiles.
4. Either capture and archive the promised post-fix open/close lifecycle
   baseline or reopen that T7.0 checkbox. Keep F7's 50-cycle Instruments/
   Perfetto leak gate separate and open until the physical run exists.
5. Record physical-device claims with the device model, OS, build mode,
   dependency versions, exact scenario, and result. Do not let a dev simulator
   proxy approve a hardware/release gate.
6. Reconcile commit SHAs only after the final fixes land. Each status block must
   point to the commit that contains the implementation currently described.
7. Update the T7.0 status and completion date only when every reopened item has
   direct evidence. F7 must remain open and device-gated.

#### Final re-verification checklist

- [ ] Focused RED/GREEN tests for F1-F4 pass.
- [ ] Full GameKit and Playground test suites pass.
- [ ] GameKit, Playground, and docs lint/typechecks pass.
- [ ] GameKit build, Playground iOS export, and docs production build pass.
- [ ] `pnpm test:coverage:gate` remains at or above 80% for the covered engine
  modules.
- [ ] `git diff --check` passes.
- [ ] The committed plan contains no checked item whose required evidence is
  absent or explicitly deferred.

#### Review verification already completed

The follow-up review itself made no runtime-code changes. It verified 184
GameKit tests and 65 Playground tests, all three workspace lint/typecheck
stages, the GameKit build, Playground iOS export, and the docs production
build. The root `pnpm check --force` wrapper could not run in the review sandbox
because its nested command expected a bare `pnpm` binary; the equivalent
workspace stages were invoked individually through Corepack. The working tree
also contained unrelated pre-existing skill, research, and temporary files;
those are not part of this feedback.
