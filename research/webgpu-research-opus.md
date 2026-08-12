# WebGPU / TypeGPU for React Native GameKit — independent review

**Status:** Architectural research. Not a v1 renderer recommendation.
**Date:** 2026-08-08
**Relationship to `webgpu-research-gpt.md`:** independent second pass. Where we
agree, this file says so briefly and does not restate the argument. Its value is
in the parts that were **verified against the actual published packages** rather
than documentation, plus four material corrections.

## Method, and why it matters here

Everything below was checked by unpacking the real npm tarballs and reading the
shipped code, types, podspec, and Gradle files:

- `react-native-webgpu@0.8.2`
- `@shopify/react-native-skia@2.11.0` and `2.12.0-next.1`
- `typegpu@0.11.9`, `unplugin-typegpu@0.11.6`
- `expo@57.0.10`'s `bundledNativeModules.json`

This matters because a web search on this topic returned a confident,
mostly-correct summary that was **wrong on one load-bearing fact** (see
Correction 1). Docs and blog posts on a fast-moving native package are not a
substitute for reading the artifact you would actually install.

## Bottom line

Agreed with the existing doc: **keep Skia for v1, keep the core
renderer-neutral, treat WebGPU as a future optional renderer package.** Nothing
found here changes that.

What this review adds:

1. The Skia↔WebGPU interop story is **further along than the other doc states** —
   it is in Skia **stable**, not `@next`.
2. There is a **hard, undocumented-in-our-notes version coupling** (Dawn
   `chrome-m152`) that is currently, and coincidentally, satisfiable.
3. The install cost is **170 MB on disk** — a real developer-experience cost the
   other doc does not quantify.
4. TypeGPU has a **concrete API friction point** on React Native
   (`configureContext` requires `HTMLCanvasElement`) with a specific workaround.
5. There is a **narrow, high-value near-term use** for WebGPU **compute** that is
   more defensible than the "advanced 2D" framing.

---

## Corrections to `webgpu-research-gpt.md`

### Correction 1 — Skia interop is in stable, not `@next`

The other doc says the Graphite sharing path "currently depends on pre-release
Skia builds." That is no longer true at the JS/API layer.

Verified in the **stable `2.11.0`** tarball:

```
lib/typescript/src/skia/types/Skia.d.ts:94              getNativeDevice(): bigint;
lib/typescript/src/skia/types/Image/ImageFactory.d.ts:97  MakeImageFromNativeTexture(pointer: bigint): SkImage;
lib/typescript/src/skia/types/Image/ImageFactory.d.ts:109 MakeNativeTextureFromImage(image: SkImage): bigint;
```

Our installed **2.6.2 has none of these** — I grepped and confirmed absence. So
this capability arrived in the window between our pinned version and current
stable.

The precise, and still-correct, caveat is a **build-time** one, from the shipped
type docs: *"only available when the Graphite backend is enabled."* Graphite is
selected by a marker file, not a JS flag —
`react-native-skia.podspec:9`:

```ruby
use_graphite = File.exist?(File.join(__dir__, 'libs', '.graphite'))
```

So: **the API is stable; the backend is still an opt-in native build variant.**
That is a meaningfully different risk profile from "pre-release only" — it means
a spike can target stable Skia and flip a native build flag, rather than tracking
a `@next` channel.

### Correction 2 — the Dawn lockstep is a real, sharp constraint

The other doc mentions Dawn compatibility in passing. The podspec shows it is
enforced by a **hard build failure**, and I verified both sides of the version
pin:

| Artifact | Dawn / milestone |
| --- | --- |
| `react-native-webgpu@0.8.2` → `package.json.dawn` | `chrome-m152` |
| `react-native-skia-graphite-apple-ios` latest | `152.0.0` |
| Skia `2.11.0` release note | "upgrade to m152" |

These align **today**. The podspec logic (`:86-100`) also shows the coupling is
bidirectional and version-sniffed: when `react-native-webgpu` is present, Skia
*defers* to its Dawn copy to avoid a CocoaPods duplicate-framework error, then
compares `libs/.dawn-version` against webgpu's `dawn` field and `raise`s on
mismatch — including an explicit error for a webgpu version that "predates
shared-Dawn support."

**Implication:** adopting the hybrid path couples our Skia and WebGPU upgrade
cadence permanently. Two independently-versioned native packages must move
together or the iOS build breaks. That is a maintenance commitment, not a
one-time integration, and it argues for keeping WebGPU in a separate optional
package with its own tested version matrix — exactly as the other doc's package
split proposes, but for a sharper reason.

### Correction 3 — install cost is 170 MB, and should be stated

Neither doc quantified this. Measured from the unpacked tarball:

| Component | Size |
| --- | --- |
| `libs/apple/libwebgpu_dawn.xcframework` (all slices) | 102 MB |
| `libs/android/*` (4 ABIs) | 66 MB |
| **Total unpacked package** | **170 MB** |
| npm-reported `unpackedSize` | 176.8 MB |

Per-slice, closer to real app impact: iOS device `ios-arm64` is 20 MB; Android
`arm64-v8a` is 17 MB. These are **unstripped static libraries**, so final app
growth after dead-stripping is substantially smaller — but it must be
*measured*, not assumed. For calibration, Skia itself documents roughly 6 MB
iOS / 4 MB Android.

This is the same trap the research doc already flagged for React Native
Filament (~400 MB install, ~4 MB app impact). The lesson transfers: **install
footprint and app footprint are different numbers, and both belong in the
decision.** A 170 MB dependency is a genuine cost for CI cache, clone time, and
contributor onboarding even if the shipped binary delta is modest.

### Correction 4 — TypeGPU's canvas API does not fit React Native as-is

The other doc says TypeGPU "has first-party React Native integration." True, but
there is a specific rough edge worth recording before anyone writes a spike.

`typegpu@0.11.9`, `core/root/rootTypes.d.ts:467-471`:

```ts
type ConfigureContextOptions = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  format?: GPUTextureFormat;
} & Omit<GPUCanvasConfiguration, 'device' | 'format'>;
```

React Native has neither type. So the idiomatic TypeGPU entry point —
`root.configureContext({ canvas })` — is not directly usable.

The viable path, verified present:

```ts
// core/root/init.d.ts:71
declare function initFromDevice(options: InitFromDeviceOptions): TgpuRoot;
```

So a spike should: get the device from `react-native-webgpu`, wrap it with
`tgpu.initFromDevice({ device })`, and obtain the canvas context from
`react-native-webgpu`'s own `Canvas` ref (`getContext("webgpu")`) rather than
through TypeGPU. Encouragingly, TypeGPU itself has **no DOM dependency** — I
grepped the bundle for `document.`/`HTMLCanvasElement` and found zero runtime
uses. The constraint is purely in that one type signature.

Also note the build requirement: `'use gpu'` shader functions need
`unplugin-typegpu`, which does ship a **`./babel`** entry — the Metro-compatible
path. Raw WGSL strings need no transform. This confirms the other doc's
recommendation to precompile built-in shaders and treat user-authored TypeGPU
shaders as advanced opt-in.

---

## Verified capability notes

Two things are better than I expected and worth recording precisely.

### WebGPU objects can cross runtime boundaries

`react-native-webgpu` registers a Worklets custom serializer
(`external/reanimated/registerWebGPUForReanimated.js`):

```js
registerCustomSerializable({
  name: "WebGPU",
  determine: (value) => { "worklet"; return __webgpuIsWebGPUObject(value); },
  pack:      (value) => { "worklet"; return __webgpuBox(value); },
  unpack:    (boxed) => { "worklet"; return boxed.unbox(); },
});
```

Plus `installWebGPU()` (`install.js:48`), a `"worklet"`-marked function that
installs the flag constants onto whichever runtime calls it, because worklet
runtimes start without them.

This is architecturally significant for GameKit: **a WebGPU renderer could own
its presentation entirely on the UI or a dedicated worklet runtime**, which is
precisely the ownership split Task 6 Finding 2 is driving toward. It aligns with,
rather than fights, the direction we already chose.

Caveat from the docs: `device.lost` / `uncapturederror` fire only on the main JS
runtime, so device creation and error handling stay there.

### Provenance reduces integration risk

`react-native-webgpu` is authored by **wcandillon**, the React Native Skia
author, and the Skia podspec contains first-class awareness of it. This is not
two unrelated projects being forced together; the interop is deliberate on both
sides. That materially lowers the odds of the ecosystem-fragmentation problem the
research doc worried about for R3F/Expo GL.

---

## Where WebGPU would actually earn its place in GameKit

I agree with the other doc's five categories. I would **re-rank** them, because
"high-volume 2D" is the weakest near-term argument and "compute" is the
strongest.

### Strongest: GPU compute for visual-only simulation

This is where WebGPU does something Skia genuinely **cannot**, at any entity
count: run thousands of parallel updates without touching the JS runtime.

Concretely, against our own numbers from Task 6: `deepFreeze` plus snapshot
construction is `O(nodes)` per tick on the JS thread, measured at ~14 ms/sec of
JS time at 1,000 entities and ~29 ms/sec at 2,000. A particle field or boids
crowd routed through a compute shader **never enters that accounting at all** —
it has no snapshot, no freeze, no mapper, and no commit.

That is a structural escape from our measured bottleneck, not a constant-factor
win. The constraint is that such systems must be **visual-only**: no scoring, no
collision, no replay dependency. GPU float behaviour and execution order vary
across drivers, and readback stalls the pipeline. Authoritative state stays in
the headless simulation.

### Strong: future 3D

Agreed, and unchanged from the other doc and the original research: WebGPU is the
credible foundation, and it is a *foundation*, not an engine. Scene graph,
materials, animation, asset pipeline, and culling all remain to be built or
adopted.

### Conditional: high-volume 2D

I would state this more sceptically than the other doc. Skia 2.11.0's `Atlas`
plus the new `select()` primitive (which Task 6 Finding 9 shows collapses our
renderer's animated-value registrations 138 → 4) raises Skia's ceiling
considerably. **The Skia path should be pushed to its measured limit before
WebGPU is proposed for 2D sprites.** Our current reference game draws 35 shapes;
we have no evidence we are anywhere near Skia's wall.

### Conditional: multi-pass effects and post-processing

Reasonable, but Skia runtime shaders cover a lot of this more simply. Justify per
effect, with a measurement.

### Niche: native texture import

Real capability (`importSharedTextureMemory`, `importExternalTexture`), genuinely
useful for camera/video-driven games. Not a v1 concern.

---

## What WebGPU explicitly does not fix

Restating because it is the most important point in both documents: **none of
our measured Task 6 findings are rendering-backend problems.**

| Task 6 finding | Fixed by WebGPU? |
| --- | --- |
| 1. `deepFreeze` dominates the JS step (~97% of snapshot stage) | **No** — our code |
| 2. Display-rate publish; JS-owned alpha | **No** — our code |
| 3. `Canvas onSize` polls `measure()` every frame | **No** — verified still present in Skia 2.11.0 |
| 4. 134 of 138 mappers dirty per publish | **No** — fixed by Skia `select()` |
| 5. Pointer moves cross UI→JS per raw sample | **No** — our adapter |
| 6. Reference game copies static geometry per tick | **No** — example code |
| 7. HUD selector runs at display rate | **No** — our screen |

A WebGPU renderer would inherit every one of these. Swapping backends before
fixing the pipeline would convert a diagnosable problem into an undiagnosable
one, on an unfamiliar stack.

---

## If we spike it

I endorse the other doc's Experiments A–D. Three additions, from what the
tarballs revealed:

- [ ] **Measure app-size delta, not install size.** Build release IPA/APK with
      and without the dependency, after stripping. The 170 MB install figure is
      the developer cost; the binary delta is the user cost. Report both.
- [ ] **Test the Dawn-mismatch failure deliberately.** Install a deliberately
      mismatched `react-native-webgpu` / Graphite pair and confirm the build
      fails loudly and legibly. We need to know what a future upgrade skew looks
      like before it happens in CI.
- [ ] **Prove the `initFromDevice` + native-canvas-context path first.** Before
      any rendering work, confirm TypeGPU initialises from a
      `react-native-webgpu` device and renders to its `Canvas`, given the
      `HTMLCanvasElement` gap in Correction 4. If that seam is awkward, prefer
      raw WGSL and drop TypeGPU from the spike.

Sequencing: **the spike must not start until Task 6 Findings 1–4 are landed and
measured.** Otherwise the baseline is contaminated and any WebGPU comparison is
meaningless.

Also: none of `react-native-webgpu`, `react-native-wgpu`, or `typegpu` is in
Expo SDK 57's `bundledNativeModules.json` — I checked. They are outside Expo's
validated matrix, so `expo install --check` will not vet them. That is
acceptable (the package ships an `app.plugin.js` config plugin and we already
use prebuild), but it means version compatibility is **our** responsibility.

## Note on `react-native-wgpu`

If you search for this name, note that `react-native-wgpu@0.5.17` is now only a
shim: *"Shim that re-exports react-native-webgpu under its previous package
name."* The real package is **`react-native-webgpu`**. Don't add both.

---

## Recommendation

Unchanged from the existing research: **Skia for v1; core stays
renderer-neutral; WebGPU as a future optional package.**

Refined by this review:

1. Finish Task 6 Findings 1–4 first. They are the actual frame-drop causes.
2. Upgrade Skia to 2.11.0 for `select()` — it addresses Finding 4 directly and
   is far cheaper than a new backend.
3. Push Skia (`Atlas`, `select`, retained mode) to a *measured* limit before
   accepting any 2D WebGPU argument.
4. When a spike happens, aim it at **GPU compute for visual-only systems**
   (particles, crowds, procedural effects). That is the defensible case, because
   it structurally bypasses the `O(nodes)` JS snapshot cost we measured.
5. Keep `react-native-webgpu` a **peer** dependency of an optional renderer
   package, never a dependency of `react-native-gamekit` — per invariant 3 and
   because of the Dawn lockstep in Correction 2.
6. Revisit the Skia-Graphite hybrid once Graphite is a default rather than a
   marker-file build variant.

## Primary sources

Verified locally by unpacking published tarballs (authoritative for this review):

- `react-native-webgpu@0.8.2` — `install.js`, `Canvas.js`, `importDevice.js`,
  `external/reanimated/registerWebGPUForReanimated.js`, `package.json.dawn`,
  `libs/`
- `@shopify/react-native-skia@2.11.0` — `Skia.d.ts`, `ImageFactory.d.ts`,
  `react-native-skia.podspec`
- `typegpu@0.11.9` — `core/root/rootTypes.d.ts`, `core/root/init.d.ts`
- `unplugin-typegpu@0.11.6` — `package.json` exports
- `expo@57.0.10` — `bundledNativeModules.json`

Official documentation:

- [React Native WebGPU](https://wcandillon.github.io/react-native-webgpu/) —
  [installation](https://wcandillon.github.io/react-native-webgpu/docs/getting-started/installation),
  [native API & threading](https://wcandillon.github.io/react-native-webgpu/docs/getting-started/native-api),
  [Skia integration](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-native-skia),
  [device extensions](https://wcandillon.github.io/react-native-webgpu/api/gpu-device-extensions)
- [TypeGPU docs](https://docs.swmansion.com/TypeGPU/) ·
  [React Native integration](https://docs.swmansion.com/TypeGPU/integration/react-native/) ·
  [WebGPU interoperability](https://docs.swmansion.com/TypeGPU/integration/webgpu-interoperability/)
- [wcandillon/react-native-webgpu](https://github.com/wcandillon/react-native-webgpu) ·
  [known issue: Android background/foreground black canvas](https://github.com/wcandillon/react-native-webgpu/issues/135)
- [Skia PR #3751 — `DawnContext::getRecorder()` public](https://github.com/Shopify/react-native-skia/pull/3751) ·
  [PR #2632 — WebGPU Canvas demo](https://github.com/Shopify/react-native-skia/pull/2632)

Internal:

- [`research/webgpu-research-gpt.md`](./webgpu-research-gpt.md) — the doc this
  reviews
- [`plans/task-6.md`](../plans/task-6.md) — measured performance findings
- [`REACT_NATIVE_GAMEKIT_RESEARCH.md`](../REACT_NATIVE_GAMEKIT_RESEARCH.md) —
  renderer-boundary direction
