# Viewport implementation review

Reviewed 2026-10-27 against merged `main` at `939a5f5`, on
`fix/core-viewport-review`. This is system 05 in the [review order](README.md).
The [original viewport brief](05-viewport.md) remains historical evidence.

## Ownership and scope

The host owns the mounted surface and safe-area layout. On the RN runtime,
`ViewportBinding` resolves the immutable game configuration against measured
surface dimensions. `GameView` publishes that mapping to the UI runtime;
rendering and pointer containment use the same mapping, while accepted
pointer packets use its inverse on RN. A layout revision invalidates an
active pointer stream. Simulation state does not depend on native layout.

The existing three modes, immutable data, and layout-frequency resolution
remain appropriate. The earlier disposal clarification is already present:
`dispose()` clears current binding subscribers without making subsequent
calls inert. Its existing tests remain in place. Camera implementation
review is system 06.

Installed dependencies remain RN 0.86.3, Expo 57.0.25, Skia 2.11.0,
Reanimated 4.5.3, Worklets 0.10.3, and Gesture Handler 3.1.0. The repository
dependency policy check passes; no dependency updates are part of this review.

## Reproduced defects and acceptance

| Trigger / before | After / regression |
| --- | --- |
| Fit a 360-point logical width into a 393-point surface. Multiplication rounds the content width below 393, leaving an offset of about `2.84e-14`. A begin at `x = 0` is rejected. | Preserve exactly zero offset and the measured extent on the axis determining the scale. Both content edges accept input; points outside still fail, without adding an epsilon to the hit area. Cover both axes and matching fractional aspect ratios in all three modes. |
| An unknown authored mode is passed with a zero, negative, or non-finite surface. The resolver returns `undefined` until usable layout arrives, hiding the configuration error. | Validate authored mode before inspecting surface readiness, consistently with authored logical dimensions. Valid configurations still return `undefined` for unusable surface sizes. |
| Binding resolution throws after storing the attempted surface size. Retrying that same measurement silently returns without resolving or reporting the error. | Compute the next resolved value before committing the measurement or revision. A failed resolution leaves the previous binding state intact and does not suppress a retry. |
| Native layout reports the same dimensions repeatedly. Binding resolution is already skipped, but `GameView` still assigns its shared viewport value for every event. | Publish only for a changed layout revision. Preserve active input and the existing viewport object on unchanged measurements. |

The constrained-axis fix also keeps visible logical bounds exact on that
axis for `fill` and `extend-world`. Scale selection and unconstrained-axis
math retain their existing behavior. This is a fix for ordinary dimensions,
not a new arbitrary-precision numeric contract.

## API before, after, and proposals

No public signatures or exports change in this PR.

**Included: validation and numeric contract.** Previously, the docs mentioned
invalid dimensions but did not explain unknown modes, non-finite surface
sizes, or the trusted conversion boundary. They now describe configuration
errors independently of layout readiness, conversions that do not clamp or
revalidate every point, and floating-point limits. Ordinary device-size
round trips remain covered with `1e-6` tolerance; finite inputs at extreme
numeric magnitudes are not guaranteed to produce finite results.

**Included: distinguish viewport coordinates from camera coordinates.**
Previously, the viewport guide said cameras were future work and used
`surfaceToWorld` without explaining that it performs only viewport inversion.
It now distinguishes logical coordinates from world coordinates and points
to the implemented Camera2D composition:

```ts
// Viewport inversion only; world and logical coincide without a camera.
const logical = surfaceToWorld(viewport, surfacePoint);

// Viewport plus the camera that was presented at input time.
if (sampledCut !== undefined) {
  const world = surfaceToWorld2D(surfacePoint, viewport, sampledCut.camera);
}
```

Built-in `GamePointerInput` already owns this composition. This clarification
helps custom consumers choose the correct existing helper without creating
an independent input transform.

**Proposal for the Camera2D API review, not implemented:** add explicit
`surfaceToLogical(viewport, point)` and `logicalToSurface(viewport, point)`
aliases for the viewport-only helpers, keeping existing names compatible.
Compared with the current `surfaceToWorld` / `surfaceToWorld2D` distinction,
the names would state which coordinate space each function reaches. Review
argument ordering and exports together with the camera helpers before
adding aliases. A consumer can already use a local import alias for clarity.

## Performance evidence and limits

Viewport work remains proportional to layout changes, not simulation ticks,
display refresh rate, or entity count. There is no new clock, worker,
per-frame React state, or per-point validation. Extra caching and a new
layout abstraction have no demonstrated benefit here.

The installed Reanimated native shared-value setter schedules work on the
UI runtime. Avoiding the assignment on an unchanged measurement removes
that request before crossing runtimes; it does not depend on a UI-side
equality check. Mounted regression tests count viewport assignments and
verify that real resizes still publish. Two duplicate layout events previously
made two extra assignments; they now make zero assignments and zero shared
value reads. A real resize still publishes once. This is deterministic work reduction,
not a measured FPS or Hermes/GPU speedup. Device performance is unmeasured.

## Native acceptance procedure

Use the existing playground Performance Lab and Camera Lab in a release or
`debugOptimized` development build on a 60 Hz Android phone, a 120 Hz iPhone,
and an iPad:

1. Drag over the visible content and its edges. Repeat with portrait and
   landscape layouts; fit letterbox space must reject a new gesture.
2. Rotate while holding a finger, then resize iPad split view. The old
   stream must cancel; a fresh down must align with the resized content.
3. Hide the surface to zero size and restore it. Input must stay neutral
   while layout is unavailable and recover on a fresh down.
4. Replace the game with a different logical size while retaining the same
   native surface dimensions. Rendering and input must use the replacement
   mapping without requiring another layout event.
5. Repeat with a presented camera to verify composition, and compare the
   same no-camera scenario at 60 and 120 Hz. Record publications separately
   from simulation ticks and display callbacks.

Mounted mocks verify the wiring but cannot certify native event scheduling,
gesture arbitration, edge delivery, or frame pacing. No native E2E or device
performance pass is claimed.

## Validation

Test-first evidence: the math regressions produced 10 failures alongside 24
passing existing tests. The publication/binding set produced four failures:
three duplicate-publication paths and one swallowed repeat validation error.
All pass after the fixes. The mounted suite also exercises an exact-edge
down through the real pointer adapter's UI containment and RN inversion.

| Check | Result |
| --- | --- |
| `pnpm check` | Passed: workspace lint/typecheck, 1,139 library tests, 309 playground tests, 61 dependency-tooling tests, library declarations/ESM, docs production build, and playground iOS bundle export. |
| `pnpm --filter rn-gamekit typecheck:api` | Passed against rebuilt public declarations. |
| `pnpm --filter rn-gamekit test:coverage:gate` | Passed the full existing library coverage gate. |
| Focused changed-module coverage | 84 tests passed; every changed runtime file exceeds 80% for lines, branches, and functions. Results below. |
| Independent review and `git diff --check` | No runtime blockers. Corrected the documentation example to unwrap `CameraCut2D.camera` before using the composed camera helpers. |
| `pnpm audit --json` | Existing dependency graph reports 51 advisories: 6 critical, 35 high, 9 moderate, 1 low. No package or lockfile changes. |
| Native E2E / device performance | Not run; follow the acceptance procedure above. |

| Changed runtime module | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| Viewport math | 98.65% | 97.10% | 100.00% |
| Viewport binding | 98.17% | 94.59% | 100.00% |
| GameView | 99.53% | 89.66% | 91.18% |
