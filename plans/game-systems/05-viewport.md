# Viewport and surface coordinates

## Purpose and verdict

Resolve one authored logical viewport against the measured native surface and share that mapping with rendering and pointer input. **Keep the implementation. No rewrite or new layout abstraction is justified by this review.**

Sources: [viewport math](../../packages/gamekit/src/viewport2d/math.ts), [viewport types](../../packages/gamekit/src/viewport2d/types.ts), [ViewportBinding](../../packages/gamekit/src/react/viewportBinding.ts), [GameView](../../packages/gamekit/src/react/GameView.tsx), [pointer containment](../../packages/gamekit/src/react/pointerContainment.ts).

## What is already good

- `fit`, `fill`, and `extend-world` have explicit, different interactive bounds.
- Zero or unusable measured dimensions produce absence until layout is ready.
- `fit` letterbox rejection is separate from mathematical coordinate conversion.
- Resolved values are immutable and replacement bindings reuse the already measured surface size.
- Layout revisions provide a natural invalidation boundary for active input.

Existing coverage: [viewport2d.test.ts](../../packages/gamekit/test/viewport2d.test.ts), [viewport2d.types.ts](../../packages/gamekit/test/viewport2d.types.ts), [gameViewBinding.test.ts](../../packages/gamekit/test/gameViewBinding.test.ts), and pointer containment/binding tests.

## GS-VIEWPORT-01 — P3: clarify public versus trusted coordinate helpers

**Evidence: source-confirmed limitation, low practical urgency.** Resolution validates finite positive dimensions, but arithmetic can still overflow/underflow for extreme finite values; conversion functions trust the resolved viewport and point. This is acceptable for normal measured device sizes, but a blanket “finite input always yields finite output” promise would be stronger than the implementation. `ViewportBinding.dispose()` clears subscribers; it does not make `setSurfaceSize` or later subscriptions inert despite its comment.

**Resolve:** narrow those comments to their actual contract. Keep layout-derived transforms as trusted internal values. If raw user-authored transforms become supported, validate the derived scale/bounds once at resolution, not at every vertex. Either define disposal as clearing current subscriptions or explicitly forbid reuse; do not add a state machine solely to support an inaccurate comment.

**Acceptance:** preserve all normal aspect-ratio and round-trip tests. Add extreme arithmetic tests only if tightening the public contract. Test binding reuse/disposal only to the chosen documented behavior.

## Performance and deletion decisions

Viewport resolution runs at layout frequency, so caching more intermediate math or moving it to a worker has no demonstrated value. Keep one shared mapping. Do not put orientation, safe-area, navigation, or camera ownership into the viewport math module. The host chooses the surface bounds; viewport math resolves those bounds.

The meaningful remaining verification is native: rotate with a finger held; resize split view; replace a game with a different logical size while native dimensions stay equal; confirm rendered and interactive edges coincide. Camera-specific stale presentation belongs to [Camera2D](06-camera2d.md), and nested button coordinates belong to [input](04-input.md).
