# Changelog

All notable changes to React Native GameKit will be documented in this file.

## Unreleased

### Added

- `useGameSession(definition)` from `rn-gamekit/react`: React-owned session
  creation and terminal disposal, safe under Strict Mode, with exact
  scene/input type inference from the game definition.

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
