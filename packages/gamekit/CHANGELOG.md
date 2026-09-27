# Changelog

All notable changes to React Native GameKit will be documented in this file.

## Unreleased

No changes yet.

## 0.2.1 - 2026-09-27

### Changed

- Validated native-peer floors track the current SDK 57 line: `expo ~57.0.25`, `expo-asset ~57.0.18`, `react-native ~0.86.3`, and `@react-native-async-storage/async-storage ^2.2.0`. No runtime changes; behavior is identical to 0.2.0.
- Skia (`2.11.0`), Gesture Handler (`~3.1.0`), Reanimated (`4.5.3`), and Worklets (`0.10.3`) remain intentionally ahead of the SDK 57 template — consuming apps exclude them via `expo.install.exclude` (see Installation).

## 0.2.0 - 2026-09-27

### Added

- Package entry points normalized: `rn-gamekit/geometry`, `rn-gamekit/collision2d`, `rn-gamekit/camera2d`, `rn-gamekit/events`, `rn-gamekit/assets`, and `rn-gamekit/sprites` are now explicit subpaths of the single `rn-gamekit` package (one version, one tarball, `exports` map). Existing `import { … } from 'rn-gamekit'` compatibility re-exports remain and reference the same symbols (`===` / `instanceof` preserved); the new subpaths are the preferred organization (additive, no breaking change). Headless subpaths import no React/Skia/native peers.
- `useGameSession(definition)` from `rn-gamekit/react`: React-owned session
  creation and terminal disposal, safe under Strict Mode, with exact
  scene/input type inference from the game definition.
- Observable pause/resume lifecycle: `GameSession.addStatusListener()` with
  queued, snapshot-delivered notifications, and `useGameSessionStatus()`
  from `rn-gamekit/react`.
- Paused-input policy: gameplay input is cancelled on pause and rejected
  while paused at the shared session/input boundary (never replayed).
- `GameView` presentation follows core status; app backgrounding pauses and
  foregrounding resumes only the lifecycle-owned pause, and an external
  start while inactive is returned to paused.
- `GameButtonPad` and `GameButton` provide multi-touch-safe button controls
  through the same semantic input boundary as pointer input.
- Collision2D: canonical 2D geometry (`Aabb2D`, `Circle2D`, `Segment2D`,
  `Vector2D`), static predicates and contact manifolds, swept circle-AABB and
  AABB-AABB queries, segment crossings, symmetric category/mask filtering,
  local/world collider records with typed placement, a deterministic spatial
  hash broad phase, and headless debug projections.
- Camera2D: one presented camera owned by `GameView` that drives rendering
  and pointer input through the same generation, headless helpers for follow
  behavior, clamped bounds, deterministic shake, interpolation, visibility
  culling, and parallax layers via `GameLayer2D`.
- Typed game events: `defineGameEvents` / `gameEvent` declarations, typed
  envelopes with payload limits, deterministic seeding, and an update-scoped
  emitter on every scene update.
- Particles: headless `defineParticleEffect` / `createParticleSystem`
  simulation with presentation-only Skia rendering (`ParticleView`,
  `useParticlePresentation`) and camera-aware culling.
- Audio (opt-in `rn-gamekit/audio`): `createGameAudio` with one shared
  `AudioContext`, fixed category gains, fire-and-forget SFX, and a single
  music channel.
- Haptics (opt-in `rn-gamekit/haptics`): `createGameHaptics` with bounded
  presets over Pulsar, mute, capability checks, and rate limits.
- Tilemaps: `defineTileSet2D` / `defineTileLayer2D` / `defineTileMap2D` with chunked storage, `movePlatformerBody2D` tunable platformer resolver, `TileMapLayer2D` atlas rendering with culling, and Tiled JSON adapter.
- Versioned storage (opt-in `rn-gamekit/storage`): `defineGameSave` / `createGameSaveStore` with `createMemoryStorageAdapter` and optional `createGameStorageAdapter` (`@react-native-async-storage/async-storage@2.1.2`), envelope `rn-gamekit.save`, per-slot serialized queue, `flush()` / `dispose()`, migrations, bounded plain-data serialization (256 KiB, depth 16), and explicit `GameStorageError` codes.

### Changed

- Pausing a session now cancels active gameplay input and rejects new input
  until the session resumes. Paused input is never replayed.
- Running scene transitions now commit on the next frame-driver callback,
  even when no fixed simulation step is due. The new scene first updates on
  the next due fixed step.
- Scene snapshots now accept only bounded plain records, arrays, and scalar
  values. Unsupported mutable or executable values fail before publication
  with a path-aware `SnapshotDomainError`.
- Asset, sprite, session, lifecycle, particle, tilemap, audio, haptics, and
  storage ownership paths now fail closed and clean up accepted work exactly
  once.

### Dependencies

- Replaced the unused `expo-audio` and `expo-haptics` peer declarations with
  optional `react-native-audio-api` and `react-native-pulsar` peers.
- Added optional `@react-native-async-storage/async-storage` support for the
  persistent storage adapter.
- Removed `react-native-safe-area-context` from the package peer requirements;
  applications can still install it for their own HUD and screen layouts.

## 0.1.0 - 2026-08-12

First public preview.

### Added

- Fixed-step, headless game sessions with deterministic scene updates.
- Functional scene definitions, transitions, and immutable snapshots.
- Semantic button and pointer input with native gesture coalescing.
- Phone and tablet viewport resolution with `fit`, `fill`, and `extend-world` modes.
- Skia and Reanimated presentation through `GameView` and `GamePointerInput`.
- Typed local asset manifests, reference-counted loading, and React delivery.
- Sprite-sheet animation helpers, retained sprites, and Atlas-backed batching.
- A native-free root entry and deterministic testing utilities.
