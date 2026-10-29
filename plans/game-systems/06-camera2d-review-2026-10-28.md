# Camera2D implementation review — 2026-10-28

Camera2D keeps the rendered world and pointer coordinates aligned while following,
zooming, rotating, and cutting between views. This review preserves scene-owned
camera data and one `GameView`-owned presented camera. It completes the remaining
[system 06](06-camera2d.md) lifecycle and error work; geometry (07) is next.

Base: `939a5f5` on `main`. The viewport review in PR #7 is independent. No dependency
versions, lockfile, workflow, native project, simulation, or draw representation
changes are needed for this slice.

## Bugs reproduced and fixed

| Trigger | Before | After / regression |
| --- | --- | --- |
| Replace a camera definition while paused | Replacement clears the camera and waits for a simulation commit that may never arrive. | Reselect the latest attempted frame immediately and cut on UI without restarting the session. |
| Selector, cut predicate, or camera validation fails after a valid frame | `GameView` publishes the new frame before camera validation; the old camera endpoints can continue interpolating. | Validate before publication. Freeze the last valid frame, alpha, and camera together. Recovery publishes the latest frame as a hard cut with `previous === current`. |
| First camera selection fails, or UI delivery is delayed | Renderer and pointer begin can use the viewport-only fallback despite an authored camera. | Mount the renderer only after UI acknowledges the first valid camera; reject new pointer begins until that value exists. A fresh down is required after readiness. |
| Replace the session/presentation or replay effects in StrictMode | The new renderer can inherit the previous camera; deferred cleanup/publication can target a retired owner. | Give each presentation a distinct camera shared value, preserve monotonic cuts within `GameView`, and stamp publication, cleanup, and readiness with lifetime generations. |
| Throw a null-prototype value or change error messages on every failing tick | Error stringification can throw outside the guard; message-based deduplication can report every tick. | Preserve the original `unknown` value without coercion. Report once per uninterrupted failure episode; contain reporter errors and allow nested recovery. |
| Sample shake with seed 1, elapsed 0.1, duration 1, amplitude 1 | Offset magnitude is about 1.1025 although the decayed limit is 0.9. | Normalize only vectors longer than one before amplitude/envelope scaling. Direction and already-in-bound samples are preserved. |
| Pass `null` as a constructor field from untyped data | Nullish defaults silently replace invalid center/zoom/rotation. | Only missing/undefined fields default; explicit nulls throw structured `GeometryError`. |

The original paused scene-cut fix, stable binding identity, optional `onError`,
and common scalar extents were already on the base branch. This change extends
those contracts rather than claiming them as new features.

## Runtime ownership and performance

- RN owns selector evaluation, validated camera copies, accepted endpoints,
  failure state, cut counters, and latest attempted frames.
- One `scheduleOnUI` packet installs each accepted frame and camera endpoints.
  Hard cuts also install the presented camera in that task. UI owns display
  interpolation and the presented value used by both drawing and event sampling.
- Failure blocks presentation advancement, not authoritative simulation. A game
  can pause in its reporter if that is its desired policy.
- A first-ready acknowledgement crosses back to RN once per camera readiness
  cycle to mount the renderer. Subsequent simulation commits do not update React
  state. Removed cameras release the block and restore viewport-only publication.
- Retained rendering, the existing alpha clock, and event-time pointer camera
  stamps remain. There is no extra frame callback, worker, or camera controller.

Before, ordinary camera commits read two UI shared values on RN (cut ID and
authored camera); hard cuts read the cut ID four times. After, the transaction
uses RN-owned state and reads **zero** shared values. A mounted regression counts
RN reads and verifies that frame/camera writes occur together on UI. The
no-camera display path skips camera state reads and interpolation.

These are source and test work-count improvements, **not a measured FPS gain**.
Per-display camera records and transforms still allocate. Static-camera caching
has no device trace justifying it, so it is deferred. The sprite visibility
comment now acknowledges its constant-size bounds/extent records.

## API before / after / recommendation

### Implemented: reusable error handler type

Before, a separately declared handler needed an inferred callback type or a
private source import even though `onError` was public:

```ts
type CameraError = Parameters<NonNullable<GameCamera2DDefinition<GameFrame>['onError']>>[0];
```

After, the same context has a direct public export:

```ts
import { defineGameCamera2D, type GameCameraErrorInfo } from 'rn-gamekit/react';

const reportCameraError = (info: GameCameraErrorInfo) => {
  report(info.phase, info.scene, info.error);
};

const camera = defineGameCamera2D({
  select: (frame: GameFrame) => frame.current.camera,
  onError: reportCameraError,
});
```

`GameFrame` and `report` are application-defined. The context remains read-only,
and its error remains `unknown`. Existing call sites and callback signatures
continue to work. Compile fixtures verify the built public declaration export.

### Implemented: explicit failure and replacement contract

Before, callers could not rely on a failed camera retaining a coherent frame or
on a paused definition replacement becoming visible. After, both follow the
transaction above. Replacing a definition evaluates it immediately against the
latest attempted frame. One continuous failure produces at most one report,
regardless of message or phase changes; successful selection resets the episode.

This requires no additional camera manager or public methods. Keep definitions
stable when their behavior has not changed. Documentation now correctly shows
`defineGameCamera2D({ select, cut?, onError? })` with RN selectors and UI
interpolation; the previous API table incorrectly showed a function argument and
worklet selector.

### Proposal for system 11: make parallax-aware culling explicit

Before, passing the main `GameView` camera into `SpriteBatch.cull` while rendering
under `GameLayer2D` uses different camera centers for culling and drawing. For
example, a zero-parallax layer remains fixed while the primary camera moves;
primary-camera culling can discard visible sprites. The current workaround is to
omit `cull` or supply a matching effective camera.

Proposed after: allow `cull` to accept the layer's per-axis parallax, using the
same center scaling as layer transforms and tile visibility. Keep default
`{ x: 1, y: 1 }` behavior. This makes the difference visible at the call site and
can share trusted scalar arithmetic without introducing another input camera.
Implement and validate it with the sprite rendering review, where transformed
sprite bounds and culling ownership must be assessed together. It is **not an
implemented API in this PR**; the limitation is now documented.

### Retain the current headless API

Keep immutable `Camera2D`, explicit logical-view arguments, and the existing
follow/clamp/shake helpers. Trusted scalar helpers stay separate from validating
public transforms. No evidence supports a mutable controller, general scene
graph, or 3D naming. Coordinate naming should be evaluated with the viewport API
proposal; this PR adds no aliases.

## Verification

Tests were added before implementation: six mounted presentation regressions
failed initially; shake had six failing cases; explicit-null fields had three;
initial pointer readiness and the missing public error export also failed. The
presentation suite now has ten scenarios, including delayed retired UI work,
StrictMode, camera removal/re-addition, and a reporter that changes scenes.

- Library suite: **1,151 tests passed**.
- `pnpm check` passed: workspace lint, typecheck, tests (including 55 playground
  tests), library/docs production builds, and the playground iOS Hermes export.
  Built public API fixtures and the expanded coverage gate also passed.
- Cross-system extents: headless transforms, clamp, sprite batches, particles,
  and tile bounds agree for non-square views, negative centers, zoom, quarter and
  45-degree turns. Tile parity also covers nonzero logical origins and positive,
  zero, and negative per-axis parallax. No-camera bounds retain their policy.
- Shake regression matrix: six seeds, three durations, nine elapsed ratios,
  four amplitudes, and five frequency modes; deterministic output and endpoint
  copies remain covered.
- Full library coverage: binding **99.54% lines / 92% branches / 100% functions**;
  `GameView` **98.89 / 91.78 / 88.89**; shake **96.88 / 88.46 / 100**;
  camera transforms **96.60 / 93.33 / 90.91**. The existing 80% line gate now
  includes the binding, shake, and transforms; branch/function figures are
  reported separately, not implied by that gate.
- Installed Babel/Worklets compilation: nine serialized worklets inspected.
  UI closures contain shared handles, immutable packets, scalar flags, verified
  worklet callees, and remote RN callback references. They do not capture the
  game/session, camera definition, target object, RN refs, or validators. Leaf
  camera interpolation and alpha projection worklets have empty closures.
- Independent review found no correctness, lifecycle, or security blockers.

Registry audit reports 52 advisories (6 critical, 35 high, 9 moderate, 2 low) on
the unchanged dependency graph. This camera branch changes no manifests or lock
entries. PR CI results are recorded in the PR. Native redraw, gesture scheduling,
and device performance remain unmeasured; React-test-renderer and compilation
checks are not substitutes for that acceptance.

## Native acceptance still required

Use Camera Lab in a release or `debugOptimized` development build on a 60 Hz
Android device and a 120 Hz iPhone/iPad. Record display callbacks, dropped frames,
RN commit time, UI time, allocations, and input latency before/after at the same
scene load. Exercise follow/zoom/rotation/shake, foreground/background, paused
scene and definition cuts, session/presentation replacement, and delayed RN
pointer delivery. Force selector/cut/validation failures before and after first
readiness, then recover. The visible frame and pointer inversion must remain
aligned through every cut and retained failure frame.

Installed stack inspected: RN **0.86.3**, Expo **57.0.25**, Skia **2.11.0**,
Reanimated **4.5.3**, Worklets **0.10.3**, RNGH **3.1.0**. Locked dependency policy
passes. Installed source and official references were used to check
[asynchronous UI scheduling](https://docs.swmansion.com/react-native-worklets/docs/threading/scheduleOnUI/),
[RN callback scheduling](https://docs.swmansion.com/react-native-worklets/docs/threading/scheduleOnRN/),
[shared-value RN read costs](https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/),
and [memoized mutable ownership](https://docs.swmansion.com/react-native-reanimated/docs/advanced/makeMutable/).
`makeMutable` remains an internal presentation-lifetime detail; game state does
not expose it.
