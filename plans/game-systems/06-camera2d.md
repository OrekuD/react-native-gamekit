# Camera2D, interpolation, layers, and visibility

## Purpose and verdict

Provide deterministic camera state in scene data and one presented camera used by both drawing and pointer inversion. **Keep the 2D-only model, direct helpers, and conservative rotated bounds. Fix paused publication and error visibility; avoid a camera manager or scene graph.**

Sources: [camera helpers](../../packages/gamekit/src/camera2d/index.ts), [presented binding](../../packages/gamekit/src/react/camera2d/usePresentedCameraBinding.ts), [GameWorld2D](../../packages/gamekit/src/react/sprites/GameWorld2D.tsx), [GameLayer2D](../../packages/gamekit/src/react/camera2d/GameLayer2D.tsx), [pointer camera stamps](../../packages/gamekit/src/react/pointerCamera.ts).

## What is already good

Follow/dead-zone/damping are explicit pure operations. Clamp handles worlds smaller than the view. Shake is seeded, and shortest-arc interpolation respects cuts. The binding clones validated camera values before publication. Input carries an event-time cut, including deferred moves, rather than reading a newer camera on RN. Conservative AABB culling preserves simulation.

## GS-CAMERA-01 — P1: paused scene changes can present a new frame with an old camera

**Evidence: source-confirmed path; mounted/native reproduction required.** `cameraBinding.commit` updates authored shared values; only `present(alpha)` updates the presented camera. `GameView` calls `present` after the frame callback's `if (!running.value) return`. A paused `setScene`/restart publishes a new hard-cut frame synchronously, but its camera remains the previous scene's until simulation resumes. Replacement of the camera definition also tears down/rebinds the GamePresentation effect, whose `bindGameSession` unconditionally starts the session.

**Resolve:** separate commit/cut publication from animation advancement. A new valid hard cut must install a coherent presented camera even when time is paused; ordinary pause must still freeze interpolation. Definition changes must not implicitly override a user pause. Keep one GameView-owned camera and the same generation for rendering/input. Do not compute a second transform in a screen to hide the mismatch.

**Acceptance:** pause, transition to a scene with a very different camera, and verify both frame and camera change coherently without advancing tick/alpha or restarting. Change camera definition while paused. Verify invalid selectors retain the old coherent pair according to the chosen failure policy.

## GS-CAMERA-02 — P2: camera selector errors are silently swallowed

**Evidence: source-confirmed.** The selector/cut/validation transaction catches every exception and simply returns. Retaining the last valid presentation is sensible; hiding all evidence makes an invalid camera appear as frozen movement or misplaced input.

**Resolve:** retain the transaction and last-valid fallback, but report a bounded control-frequency error with selector/cut context. Prefer an existing diagnostic/error surface or one small callback; do not log on every UI frame. Reset any deduplication after recovery so a later distinct failure remains visible.

**Acceptance:** selector and cut predicate fail separately; no half-installed camera, no input-generation mismatch, one visible report per failure episode, and the next valid commit recovers.

## GS-CAMERA-03 — P3: consolidate scalar visibility math only after a parity test

**Evidence: source-confirmed maintenance duplication.** Rotated camera extents are implemented in camera transforms, bounds clamping, sprite batch visibility, particle culling, and tile-layer bounds. Their validation and no-camera policies differ; [particles](14-particles.md) has an actual no-camera failure.

**Resolve:** begin with cross-system numeric parity tests for trusted scalar extents. Extract only the shared arithmetic if that removes duplication without pulling validating/error-constructing functions into worklets. Keep parallax composition and per-system shape padding explicit. Do not route every UI item through public validating helpers.

**Acceptance:** non-square view, zoom, quarter-turn/45-degree rotation, negative center, and parallax factors agree across headless and UI paths. The no-camera viewport path stays unchanged as required by T12.

## Performance limits

Current code allocates presented camera records/transforms per presentation update; allocation-free comments should not be inferred from use of shared values. A static camera may benefit from skipping unchanged cuts, but only optimize after a real trace shows cost. Test 60/120 Hz, camera cuts during pause, fast zoom/rotation, and input under delayed RN delivery. Existing camera source-contract tests establish worklet shape, not native execution or GPU time.
