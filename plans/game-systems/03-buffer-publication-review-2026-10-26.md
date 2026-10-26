# Batch buffer publication review

System 03, GS-REACT-03. Base: merged `main` at `5ca2f17`; branch:
`fix/core-buffer-publication`. This PR is independent of the
[React ownership PR #4](https://github.com/OrekuD/react-native-gamekit/pull/4).
Native redraw acceptance remains pending; the implementation and mock
regressions do not establish a native performance pass.

## Ownership and evidence

The headless session and particle system remain authoritative. React owns
mounts and source bindings; UI reactions own fixed-capacity presentation
slots. Skia receives notifications after slot updates. No new per-frame
React state, scheduler, worker runtime, or public refresh API is introduced.

Installed source inspected: Skia 2.11.0, Reanimated 4.5.3, Worklets 0.10.3,
React Native 0.86.3, Expo 57.0.25, React 19.2.3, Gesture Handler 3.1.0.
Dependencies and GitHub Actions are unchanged.

Skia's `external/reanimated/buffers.ts` initializes buffers and notifies after
its own modifier runs. GameKit's separate writers were outside that path.
The native renderer subscribes to SharedValues and converts Atlas rects,
transforms, and colors into native vectors. Mutating a host rect alone does
not establish that its converted vector or canvas has been updated.

The correction uses the public
[SharedValue.modify API](https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/)
and [useAnimatedReaction](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useAnimatedReaction/).
Preparation reads incoming state; the reaction writes output buffers, then
calls `.modify(undefined, true)` on each. Output buffers and mutable request
guards are excluded from preparation, avoiding self-invalidating writers.
No private Skia notifier or `_value` access is used.

## Before and after

| Trigger | Before | After |
| --- | --- | --- |
| Sprite, tile, or particle input changes | Host slots mutate without the writer notifying Skia. | Each completed writer publishes rects/transforms and, for particles, colors. |
| React rerenders an idle batch | Skia restarts its buffer modifiers; constant reset callbacks can erase visible slots. | Stable no-op modifiers preserve slots; only the presentation writer updates them. |
| Tile source generation changes or viewport disappears | Previously populated slots can remain visible while no valid replacement is available. | Clear and publish the hidden slots. |
| Camera leaves a transferred tile window | Old slots can survive while the next bounded window is requested. | Hide until the matching window is delivered; the pending guard still coalesces requests. |
| Sprite particle fades | Atlas defaults to `dstOver` for sprite-color blending, which does not implement the intended white/alpha multiplication. | Explicit `colorBlendMode="modulate"` multiplies the texture by sampled slot alpha. |
| Existing Buffer Probe runs | One canvas and a changing world transform can mask missing notifications; particles receive an asset wrapper as image. | Three independent canvases, stationary transforms, manual deterministic phases, and the decoded image handle. |

The [Atlas API](https://wcandillon.github.io/react-native-skia/v2/docs/shapes/atlas/)
distinguishes `colorBlendMode` from the paint's canvas-compositing `blendMode`.
The fix changes the former, leaving canvas compositing at its default.

## API review

Keep the existing `SpriteBatch`, `TileMapLayer2D`, and `ParticleView` prop
shapes. Buffer notification is the renderer's responsibility; exposing a
`refresh()` method would force applications to coordinate implementation
details after every update.

The sprite guide previously showed nonexistent `count` and `buffer.set`
usage plus an author-owned frame callback. The corrected example uses the
implemented contract:

```tsx
<SpriteBatch
  scene="play" commit={frame} alpha={alpha} source={coins} capacity={64}
  select={({ current }) => {
    'worklet';
    return current.coins;
  }}
  write={(slots, coin, index) => {
    'worklet';
    slots.set(index, coin.frame, coin.x, coin.y, 0, 1);
  }}
/>
```

Before, following the guide required inventing a buffer and scheduling API.
After, the selected array defines active count and the mounted batch owns
updates, hiding, and publication. Asset readiness is checked before rendering.
For particle sources, pass `loadedSheet.image`, not `loadedSheet`.

## Work and performance limits

Per completed update, sprite/tile writers publish two buffers and particle
writers publish three. This adds required notification work that was missing;
it is not evidence of a faster frame. Buffers retain their identity/capacity.
Removing reset callbacks removes their rect/transform setters and particle
color resets on rerender, although Skia still iterates its modifier slots.
Preparation records and helper results still allocate temporary objects.
The docs no longer claim zero per-frame allocation.

The installed Worklets Babel transform confirms preparation closure keys:

| Renderer | Captures |
| --- | --- |
| SpriteBatch | `commit`, `alpha`, `cullCamera`, `cullViewport` |
| TileMapLayer2D | `camera`, `viewportSV`, `windowSV` |
| Particle sprite slots | `registry`, `clock`, `camera`, `viewport` |

Tile reactions capture scalar dimensions instead of the full layer/map.
The mounted tests separately observe every publication after all writes;
they check buffer identity and that preparation does not read outputs or
guards. Neither check measures Hermes/UI/GPU frame cost. Physical 60/120 Hz
FPS, latency, and allocation measurements remain unmeasured.

## Native reproduction and remaining gate

The revised [Buffer Probe flow](../task-20-device-smoke.md#gs-react-03--buffer-probe-slot-publication)
defines expected positions, frames, alpha, and empty states for Initial,
Move, Hide, Reappear, and Fade. Rerender and Remount must preserve the phase;
exit/reopen must reset it. Repeat on iOS and Android with the same probe on
baseline and corrected renderer code. The probe's internal world-context
import is confined to the development harness to avoid an incidental Group
transform; it is not a new supported package API.

Native attempts on October 25 did not reach the app:

- Android AVD `React_Native_Showcase_API_35` refused to launch with
  `Not enough disk space available`.
- iPhone 17 Pro / iOS 26.5 simulator booted. The Expo development build was
  stopped during its first CocoaPods artifact download after disk inspection
  showed only 3.1 GiB free on the data volume and 7.3 GiB on the external
  Xcode volume. This is an incomplete build, not a demonstrated build error.
- The task's iOS build processes were stopped and its simulator shut down.
  No native directories were committed and no user caches were removed.

There is no baseline/after recording. Source evidence and mock regressions
justify the patch, but actual redraw and cross-buffer native draw coherence
remain acceptance work. The three batch systems must not yet be labeled
native-validated.

## Validation

Initial mounted writer suite: five failures before implementation. Additional
regressions caught stale tile generations/windows and the color-blend prop.
The revised probe had two failing wiring tests before its implementation.

- Frozen install passed; dependency files unchanged.
- `pnpm check` passed: dependency policy/docs checks, lint, workspace
  typecheck, 47 tooling tests, 1,044 library tests, 309 playground tests,
  library ESM/declarations, docs production build, and iOS Expo export.
- Full library LCOV run passed with four modified runtime modules gated at
  80% line coverage: SpriteBatch 93.6%, TileMapLayer2D 97.5%,
  tilePresentation 98.4%, ParticleView 95.2%. Respective branch coverage:
  72.2%, 86.8%, 88.8%, 73.7%. This is a module line gate, not an 80% branch
  or repository-wide coverage claim.
- Probe wiring LCOV: screen 99.3%, input fixtures 100% lines; both passed
  the 80% module line gate. Public API fixtures passed against rebuilt declarations.
- Independent code review and installed Babel closure inspection passed.
- `pnpm audit --json` still reports 51 advisories on the unchanged graph
  (6 critical, 35 high, 9 moderate, 1 low). Existing online Expo compatibility
  drift is outside this PR; the Actions workflow is unchanged.
