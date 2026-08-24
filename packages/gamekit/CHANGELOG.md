# Changelog

All notable changes to React Native GameKit will be documented in this file.

## Unreleased

### Added

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
