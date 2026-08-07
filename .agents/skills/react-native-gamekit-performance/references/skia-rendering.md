# Skia rendering for games

## Render-mode decision

### Retained mode: default

Use normal Canvas components when the draw-tree shape is stable and props change over time. React Native Skia creates a display list and can update supported animated properties with very low overhead.

Good fits:

- a player, a modest number of enemies, and fixed HUD decoration
- paths whose trim, color, transform, or opacity changes
- stable layers with shared/derived Reanimated values

Keep node count and effect cost visible in profiling. Retained mode is not automatically free when thousands of React/Skia nodes exist.

### Atlas: shared texture, many instances

Use `Atlas` for sprite batches and tile fields where many instances share one image. Prepare:

- source rectangles within the atlas
- per-instance `RSXform` transforms
- optional per-instance colors

Use the Skia buffer hooks supported by the installed release to update transforms on the UI runtime. Keep sprite metadata stable. Prefer one or a few atlases grouped by sampling/blend requirements over one node per tile.

Atlas is the first escalation for particles, crowds, tilemaps, and sprite-heavy scenes.

### Picture: command list

Use `Picture` when the number or order of draw commands changes each frame, or when an immutable command list will be replayed many times.

A picture is immutable after recording. Re-recording a large picture every frame can simply move the bottleneck, so measure recording and playback separately.

Serialized pictures are tied to the Skia version that created them. Do not use them as a long-lived cross-version game asset format.

### Texture hooks: render then reuse

Use texture hooks when a UI-runtime drawing can be converted to an image and reused efficiently, for example a generated sprite sheet, cached procedural tile, or intermediate render target.

Texture creation/upload consumes time and memory. Reuse the result and release obsolete textures. Do not rebuild a texture because an unrelated React component rendered.

Some Skia texture documentation still uses Reanimated 2-era `runOnUI` language. In a current Worklets project, follow the installed API and prefer `scheduleOnUI` for an explicit RN-to-UI hop.

## Animation bridge

Pass `SharedValue` and `DerivedValue` objects directly to Skia props that support them. Do not wrap Skia nodes with `createAnimatedComponent`, and do not add `useAnimatedProps` merely to bridge a shared value.

Use a derived object when several visual props change together. Skia's `select` helper can bind several properties to one object-shaped shared value with one subscription. Confirm installed-version support before making it a public GameKit primitive.

Use `interpolateColors` for Skia color interpolation. Reanimated's generic `interpolateColor` representation is not interchangeable in all Skia paths.

Nested animation modifiers have API limitations; for example, a nested `withTiming` value inside an object is not supported by Skia's direct property integration. Animate scalar shared values and assemble the object in a derived value.

## Expensive effects

### Layers

`Group layer` rasterizes children into an offscreen bitmap before applying paint effects. This is necessary for some blur/filter/compositing results, but costs an extra render target and pixels.

- bound the layer to the smallest practical area
- avoid full-screen layers inside other full-screen layers
- cache static filtered content where possible
- measure on high-density tablets, where pixel count rises quickly

Paragraph, Picture, Skottie, and SVG content may require a layer for group effects. Treat that as an explicit cost.

### Blur and image filters

Filter cost follows pixels and passes, not entity count alone. Downsample intermediate content when fidelity permits. Prefer a small localized glow over a full-screen blur.

### Runtime shaders

Compile a `RuntimeEffect` once and reuse it. Keep uniforms compact and derive them on the UI runtime. Avoid creating strings, arrays, points, or effect objects per frame.

RuntimeShader image filters do not automatically account for device pixel density. Use the documented supersampling technique when the output is soft, then profile the higher pixel workload.

### Transparency and overdraw

Large overlapping translucent layers can become fill-rate bound even when JavaScript and simulation timings look excellent. Reduce invisible coverage, clip deliberately, and avoid drawing offscreen entities.

## Resource preparation

- Treat `useImage()` returning `null` as the normal loading state.
- Decode/preload images before a timed game begins.
- Reuse image, font, path, paragraph, paint, and shader objects.
- Build paragraph layouts outside the frame loop; font loading is asynchronous.
- Prefer atlas-friendly dimensions and sampling choices decided by the asset pipeline.
- Dispose or dereference scene-owned native resources on scene exit.

## Paths and text

Do not rebuild a complex path from SVG text each frame. Create it once, then animate transforms, trim values, or compatible path interpolation.

Use Paragraph for wrapped or multi-style text. For a rapidly changing score, consider a digit atlas or pre-shaped glyph strategy only after Paragraph/text measurement is shown to be a bottleneck.

Keep accessibility and semantic controls in React Native overlays when needed; Canvas content is not a substitute for accessible native controls.

## Canvas context boundary

The Skia Canvas uses its own reconciler. Context from the surrounding React tree is not automatically available inside it. Prepare theme, viewport, and asset handles outside the Canvas or explicitly re-provide context within the Canvas tree.

Do not make a frame callback repeatedly traverse an app context or Zustand store to retrieve drawing data.

## Installation and platform floor

At the pinned Skia documentation revision:

- React Native 0.79+ and React 19+ are required by current Skia releases.
- Native Reanimated integration requires Reanimated 4+ and Worklets 0.7+.
- iOS 14 and Android API 21 are the general floor; Skia video needs Android API 26.
- Approximate app download growth documented by Skia is 6 MB on Apple platforms and 4 MB on Android.

Always confirm against the installed version. Experimental Graphite/WebGPU features are not the default GameKit v1 renderer.
