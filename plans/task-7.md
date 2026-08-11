# Task 7: 2D assets, sprites, and deterministic animation

## Status

**Proposed — not started.**

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

- [ ] Review the current dirty tree and split the already completed work into
  attributable commits before Task 7 implementation begins.
- [ ] Reconcile the F1–F7 feedback checkboxes in
  `plans/performance-tasks.md` with the code and recorded evidence. A checked
  box without the required implementation/device evidence must be reopened or
  explicitly qualified.
- [ ] Re-run the trailing-flush cases: a deferred final move reaches the
  session without another native move, terminal edges stay ordered, and no
  sampler stays active after the final pointer exits.
- [ ] Re-run consecutive/cancelled manual-gesture lifecycle cases and prove
  pointer ownership releases exactly once before the next gesture begins.
- [ ] Prove the disabled diagnostics path performs no timing reads, callbacks,
  or wrapper allocation during a normal fixed step.
- [ ] Prove nested values stored on non-index string and symbol properties of
  arrays are included in the deep-immutability contract.
- [ ] Prove stale layout/binding packets cannot acquire or release pointer
  ownership after the epoch changes.
- [ ] Confirm the fixed paddle drag on a clean iPhone development build after a
  Metro restart, since package source-vs-built resolution was part of the bug.
- [ ] Run the currently implemented mounted Performance Lab scenarios and
  archive a post-fix baseline for idle, native drag, and open/close lifecycle.
  Sprite-count scaling is introduced later in T7.7, after the sprite renderer
  and Atlas batch exist.
- [ ] Record exact RN, Expo, Skia, Reanimated, Worklets, RNGH, `expo-asset`, iOS,
  and Android versions that Task 7 starts from.
- [ ] Confirm root imports remain headless and React Native resolves package
  source while default Node/package resolution uses built output.

#### Done when

- Existing work is attributable and Task 7 starts from a known commit.
- The current physical-touch regression is not present.
- The baseline and dependency table have a stable location in the existing
  performance docs.
- No Task 7 feature code is included in this gate commit.
- The existing frame pipeline is not reopened unless a later sprite benchmark
  identifies a new measured bottleneck.

---

### T7.1 — Freeze the API contract with call-site and type fixtures

**Type:** public API · **Depends on:** T7.0

Write consumer code before implementation. This is the RED phase for the
public surface and prevents internals from dictating the API.

#### Work

- [ ] Add compile fixtures for the four examples above: image-only loading,
  sprite-sheet loading, deterministic animation, and an Atlas batch.
- [ ] Add a shape-only game fixture proving `assets` remains optional.
- [ ] Prove group, asset, frame, and clip names are inferred as string literals.
- [ ] Add expected type failures for unknown groups/assets/frames/clips and for
  retrieving a descriptor through the wrong manifest.
- [ ] Add a fixture proving a URL/string source is rejected in Task 7; remote
  sources remain a future discriminated descriptor rather than an accidental
  branch of the local loader.
- [ ] Decide the exact `GameDefinition` and `GameRendererProps` generic order
  using real inference tests; users should not normally spell more generics
  than the renderer type needs.
- [ ] Test both number props and supported Reanimated shared/derived values on
  the sprite surface.
- [ ] Define the imperative API's ownership explicitly: an explicitly created
  store owns cache/native entries; `await store.acquire(...)` returns a fully
  ready lease; callers dispose leases and then the store in `finally`.
- [ ] Define hook ownership explicitly: `useGameAssets` creates/owns its store
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

### T7.2 — Implement the headless manifest and validation layer

**Type:** headless core · **Depends on:** T7.1

This phase contains no React Native or native imports. It creates immutable
descriptors and validates everything knowable before decoding.

#### Work

- [ ] Replace the placeholder `AssetDescriptor`/`AssetSource` model with a
  discriminated image and sprite-sheet descriptor model.
- [ ] Implement `image(...)`, `spriteSheet(...)`, and `defineAssets(...)` with
  exact generic inference from the accepted fixtures.
- [ ] Add the manifest type to `GameDefinition` without making the headless
  `GameSession` own native assets.
- [ ] Normalize a stable diagnostic id from group/key while preserving typed
  descriptor references for normal lookup.
- [ ] Validate group/key identifiers, source kinds, rectangles, frame names,
  clip frame references, durations, and animation modes.
- [ ] Deep-freeze the manifest and metadata using the established trusted
  deep-freeze rules without exposing the session's internal cache.
- [ ] Add structured definition errors with stable codes and field paths.
- [ ] Reject string/URL sources with a specific unsupported-source error at an
  untyped JavaScript boundary; do not begin a network request.
- [ ] Export only the intended headless surface from `src/index.ts`.

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

### T7.3 — Implement deterministic sprite animation primitives

**Type:** headless core · **Depends on:** T7.2

Keep animation definition and sampling independently testable without a
renderer or simulator.

#### Work

- [ ] Compile named frame references into a compact immutable lookup suitable
  for both fixed-step JS use and worklet capture.
- [ ] Implement the pure clip sampler with exact loop and one-shot boundary
  semantics.
- [ ] Implement immutable `start`, `advance`, `play/change`, `pause`, `resume`,
  and reset helpers for serializable animation playback state.
- [ ] Support a finite positive speed multiplier and advance a large delta with
  bounded arithmetic rather than an unbounded frame-by-frame loop.
- [ ] Expose completion without requiring a gameplay system to infer it from a
  visual frame.
- [ ] Provide an allocation-free frame-index path if profiling confirms the
  ergonomic sampler allocates on every UI frame.
- [ ] Document the separation between simulation animation state
  (`clip`, start tick/time, play state) and presented frame selection.
- [ ] Ensure animation metadata contains only serializable numeric/string data;
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

- [ ] Verify the installed `expo-asset` and Skia APIs against their official
  docs and installed types before coding. Record the exact primitives used.
- [ ] Define internal `AssetResolver` and `ImageDecoder` interfaces so unit
  tests use fakes rather than importing native modules.
- [ ] Implement `createGameAssetStore(manifest)` as the explicit cache owner;
  reject acquisitions after store disposal and make store disposal idempotent.
- [ ] Resolve static module handles through Expo Asset and decode through the
  supported Skia data/image APIs.
- [ ] Dispose temporary decode data such as `SkData` as soon as the supported
  Skia ownership contract permits; final `SkImage` ownership remains with the
  cache entry until its last lease is released.
- [ ] Treat a null decode as a structured load failure, not a ready resource.
- [ ] Validate each sprite frame against decoded width/height before publishing
  readiness.
- [ ] Deduplicate simultaneous loads by canonical resolved source plus decode
  options; logical descriptor identity remains separate.
- [ ] Implement reference counts and idempotent disposal. Dispose the Skia
  image exactly once when the final lease releases it.
- [ ] Ensure a partially failed group releases everything acquired only by that
  attempt while preserving entries still leased elsewhere.
- [ ] Add an attempt/epoch token so stale completion after retry/unmount cannot
  become current.
- [ ] Accept `AbortSignal` for imperative acquisition and document honest
  logical cancellation when Expo cannot stop the underlying work.
- [ ] Make progress aggregation monotonic and based on requested logical
  resources; document whether a deduplicated source counts once or once per
  logical descriptor.
- [ ] Implement `LoadedGameAssets.get(descriptor)` with a disposed-state guard
  in development.
- [ ] Keep cache storage bounded by live/in-flight leases. Do not create an
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

### T7.5 — Add React loading and `GameView` asset delivery

**Type:** React adapter · **Depends on:** T7.4

The React layer adapts the owned store/acquisition model to component
lifecycle. It does not become the frame store.

#### Work

- [ ] Implement `useGameAssets(manifest, options)` over a hook-owned store and
  acquisition with the discriminated loading/ready/error contract.
- [ ] Keep the requested `groups` value semantically stable; document or
  normalize ordering so `['boot', 'play']` and a recreated equivalent array do
  not reload every React render.
- [ ] Invalidate stale attempts before releasing their resources.
- [ ] Make `retry` stable and ensure one user action starts one new attempt.
- [ ] Extend `GameView` and `GameRendererProps` with the typed, stable asset
  lease accepted in T7.1.
- [ ] Keep the asset lease out of `GameSession`, `CommitFrame`, shared frame
  values, and snapshot serialization.
- [ ] Ensure changing the lease follows an explicit policy. Recommended:
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

### T7.6 — Add retained `Sprite` and `GameSprite` primitives

**Type:** Skia rendering · **Depends on:** T7.3, T7.4, T7.5

Build the ergonomic path first. Keep the component small, composable with raw
Skia nodes, and stable across animation frames.

#### Work

- [ ] Implement full-image sprites and sprite-sheet frame selection using a
  source-verified Skia drawing path.
- [ ] Implement `GameWorld2D` as one viewport-offset/scale group shared by all
  child sprites. It must not add camera state, subscribe React per frame, or
  apply the viewport transform once per child.
- [ ] Support logical position, anchor, scale, rotation in radians, opacity,
  tint, flip, sampling, and visibility according to the contracts above.
- [ ] Accept static values and supported Reanimated shared/derived values
  without mirroring them through React state.
- [ ] Precompute static source rectangles and metadata once per resource, not
  once per frame.
- [ ] Define exact transform order and test the matrix/pivot math as pure code.
- [ ] Keep React child order as the drawing order and document it.
- [ ] Implement `GameSprite` as the common GameKit integration: it accepts the
  commit/alpha values, narrows by scene, invokes one worklet selector, and
  drives the underlying `Sprite` through one coherent derived value.
- [ ] Interpolate position, rotation, uniform scale, and opacity when the
  selector requests interpolation; choose clip/frame, tint, visibility, and
  flip discretely from the committed current snapshot.
- [ ] Keep the selector's scene typing exact so a `scene="play"` selector
  receives only the play snapshot without casts.
- [ ] Benchmark the ergonomic grouped-object selector against a compact
  numeric/setter representation at 32 and 100 retained sprites. If allocation
  or mapper work is material, change the public hot path before accepting the
  API; do not merely document the regression.
- [ ] Fail clearly when a frame name belongs to another sheet or a loaded lease
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

- [ ] Implement a fixed-capacity batch with a stable underlying Skia image,
  source-frame buffer, transform buffer, and optional color/tint buffer.
- [ ] Make active count explicit and reject writes past capacity in
  development. Define safe production behaviour rather than corrupting memory.
- [ ] Keep buffer updates on the UI runtime. Crossing a complete entity array
  from JS every display frame is not an acceptable batch design.
- [ ] Own the derived/reaction plumbing inside `SpriteBatch`; the normal API
  must not require authors to use a derived value for side effects.
- [ ] Prefer compact setter/numeric writes over temporary per-sprite objects in
  the hot path; preserve the readable author-facing wrapper where profiling
  shows it is free enough.
- [ ] Reuse buffers for the mounted lifetime and release all native resources
  on unmount.
- [ ] Define item ordering, tint, opacity, hidden slots, frame selection,
  rotation, scale, and anchor parity with `Sprite`.
- [ ] Do not put unrelated textures in one batch. Multiple sheets may share a
  batch only if they resolve to the same Skia image and compatible metadata.
- [ ] Add development diagnostics for capacity, active count, and buffer
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

### T7.9 — Documentation and agent workflow

**Type:** docs · **Depends on:** accepted API and reference game

Documentation must explain the simple path first and make performance/ownership
rules hard to miss. Update the existing Fumadocs structure; do not add an
unlinked markdown dump.

#### User documentation

- [ ] Update **Create Your First Game** without making its bare shape example
  depend on assets.
- [ ] Add **Create Your First Sprite Game** using the exact compile-tested
  reference API.
- [ ] Add an **Assets** concept page: manifests, groups, local `require`, load
  states, errors/retry, typed lookup, ownership, and disposal.
- [ ] Add a **Sprites and Sprite Sheets** page: frames, anchors, transforms,
  sampling, tint, flip, and drawing order.
- [ ] Add a **Sprite Animation** page: fixed-step state, presentation sampling,
  loop/one-shot semantics, and pause/resume.
- [ ] Add a **Sprite Batching** performance page: retained vs Atlas, measured
  device results, capacity, buffers, and when not to batch.
- [ ] Document supported formats/platforms and local-asset limitations.
- [ ] Document every public error code with a direct corrective action.
- [ ] Update package/API reference and navigation metadata.

#### Agent-facing workflow

- [ ] Update the project-local game development/asset skill only after the API
  is accepted, using the reference game as the canonical template.
- [ ] Give agents one prescribed file layout for assets, definitions, scenes,
  renderer, and tests.
- [ ] Add a checklist that rejects per-frame React state, wall-clock animation,
  unowned native handles, untyped asset strings, and remote URLs in this
  version.
- [ ] Include small copyable recipes for one sprite, a clip, and a batch rather
  than a giant generated game.
- [ ] Add diagnostic examples showing the expected error and fix for a missing
  asset, bad frame rectangle, and disposed lease.

#### Documentation quality gate

- Every documented snippet is compiled or sourced directly from a compiled
  fixture.
- The docs app builds with no broken links.
- A new contributor can reach the sprite reference game from the home page.

#### Suggested commit

`docs: add asset and sprite game guides`

---

### T7.10 — Verification, packaging, and native acceptance

**Type:** release gate · **Depends on:** all previous Task 7 work

#### Automated verification

- [ ] Run focused tests during each RED/GREEN cycle.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm typecheck`.
- [ ] Run the full workspace test suite.
- [ ] Run `pnpm test:coverage:gate`; new executable asset/sprite code must meet
  the repository's 80% coverage requirement.
- [ ] Run the package build.
- [ ] Run `pnpm pack:inspect` and inspect the tarball for root/react exports,
  declarations, source/build parity, and missing asset-related files.
- [ ] Verify a normal Node import of the root entry does not evaluate native
  dependencies.
- [ ] Build the docs app and Expo playground.
- [ ] Run `git diff --check`.

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
