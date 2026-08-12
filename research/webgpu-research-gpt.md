# WebGPU / TypeGPU Research for React Native GameKit

**Status:** Architectural research; not approved as a v1 renderer  
**Last reviewed:** 2026-08-08  
**Scope:** React Native WebGPU, TypeGPU, Skia interoperability, advanced 2D, and future 3D

## Executive decision

React Native WebGPU is a credible future rendering technology for GameKit, and
TypeGPU is a useful typed layer over it. Neither should replace Skia or become a
dependency of the v1 GameKit core.

The recommended direction is:

- Keep the GameKit core renderer-independent.
- Keep Skia as the default v1 2D renderer.
- Introduce WebGPU later as an optional renderer package for advanced 2D,
  compute-heavy effects, and future 3D.
- Keep authoritative gameplay and deterministic physics on the CPU.
- Validate WebGPU on physical iPhone, Android, and iPad hardware before making
  any public API commitment.

This agrees with Task 6's current decision to exclude Skia Graphite and WebGPU
backends from the v1 renderer work.

## What the technologies provide

### React Native WebGPU

[`react-native-webgpu`](https://github.com/wcandillon/react-native-webgpu)
brings the standard WebGPU API to React Native through Dawn. Its documented
platform support includes iOS, Android, macOS, and visionOS.

Relevant properties for GameKit:

- It exposes WebGPU through `navigator.gpu`.
- It supports Expo projects through a config plugin and Expo prebuild.
- It requires React Native's New Architecture.
- Its documented React Native minimum is 0.81.
- WebGPU work can run on the main JavaScript runtime, UI runtime, or a dedicated
  Worklet runtime.
- WebGPU objects can be transferred to a Worklet runtime.
- Native Metal and Vulkan swapchains back the React Native canvas.
- React Native canvases require an explicit `context.present()` after command
  submission.

GameKit does not require Expo Go, so the need for Expo prebuild is not a
constraint for this project.

### TypeGPU

[`TypeGPU`](https://github.com/software-mansion/TypeGPU) is a type-safe toolkit
on top of WebGPU. It helps define:

- GPU buffer layouts and alignment
- Bind groups and resources
- Render and compute pipelines
- Shader functions authored in TypeScript
- Typed interaction with raw WebGPU resources

TypeGPU has first-party React Native integration through
`react-native-webgpu`. It remains interoperable with raw WebGPU, so GameKit can
use it incrementally and unwrap native WebGPU resources when necessary.

TypeGPU shader functions marked with `"use gpu"` require the TypeGPU build
transform. Raw WGSL does not require that transform. This distinction matters
for the eventual public GameKit API:

- Built-in GameKit shaders can be compiled as part of publishing the renderer.
- Users should not need extra shader build configuration for normal games.
- User-authored TypeGPU shaders can be an advanced opt-in API that documents
  the required Babel integration.

## Compatibility with the current repository

At the time of this review, the playground uses:

- React Native 0.86.2
- Expo 57.0.10
- React Native Skia 2.6.2
- Reanimated 4.5.1
- React Native Worklets 0.10.1
- React Native New Architecture
- Expo prebuild and native development builds

These versions meet React Native WebGPU's documented broad minimums: React
Native 0.81 or newer, the New Architecture, and Worklets 0.7.2 or newer for
off-JavaScript rendering. This is not proof that a particular set of package
versions builds together. A spike must lock exact versions and verify iOS,
Android, CocoaPods, Gradle, Expo prebuild, release builds, and device behavior.

## Where WebGPU fits in GameKit

### 1. Future 3D renderer

This is the strongest use case. WebGPU can provide the lower-level foundation
for:

- Mesh and material rendering
- Perspective and orthographic cameras
- Depth and stencil buffers
- Instancing
- Skeletal animation
- Lighting and shadows
- Physically based rendering
- Render-to-texture
- Post-processing pipelines
- GPU culling and level-of-detail selection

GameKit would still need to build or adopt higher-level systems for models,
materials, scene graphs, cameras, animation, asset loading, and shader
management. WebGPU is a rendering foundation, not a complete 3D engine.

### 2. High-volume 2D rendering

WebGPU may help scenes containing thousands of dynamic objects, including:

- Instanced sprites
- Large dynamic tile layers
- Particle systems
- Bullet-hell projectiles
- Procedurally generated geometry
- Large crowds or visual agents

An instanced sprite renderer could keep per-sprite data in compact GPU buffers
and draw many sprites in very few draw calls.

WebGPU should not be assumed to outperform Skia for ordinary 2D games. A small
scene such as the current Brick Breaker example is unlikely to justify WebGPU's
pipeline, buffer, command-encoding, and resource-management overhead. Skia
retained mode, `Atlas`, or `Picture` should be evaluated first.

### 3. GPU compute and visual simulation

Compute shaders are suitable for:

- Particles
- Boids and crowd motion
- Fluid, smoke, fire, and water effects
- Cloth-like visual effects
- Procedural textures
- Visibility and GPU culling
- Light clustering
- Visual terrain generation

These systems should normally produce visual state rather than authoritative
gameplay state. GPU floating-point behavior and execution ordering can vary,
and reading results back to the CPU can stall the graphics pipeline. Collision,
scoring, deterministic replay, and authoritative physics should remain in the
headless GameKit simulation unless a future feature explicitly accepts those
tradeoffs.

### 4. Lighting, shaders, and post-processing

WebGPU is a strong fit when an effect needs several render passes, depth,
compute, or large persistent buffers. Examples include:

- Bloom
- Color grading
- Dynamic 2D lighting
- Fog
- Distortion and heat haze
- Water rendering
- Full-screen transitions
- Procedural backgrounds

Simple 2D effects should continue to use Skia runtime shaders where they are
easier to implement and maintain.

### 5. Native textures and generated assets

React Native WebGPU supports native texture import. Potential GameKit uses
include GPU-generated textures, camera/video texture effects, and render
targets shared with other native graphics systems. These are advanced features,
not core v1 requirements.

## Recommended package architecture

```text
react-native-gamekit
  deterministic simulation, timing, scenes, input, lifecycle, snapshots
                     |
                     +-- @react-native-gamekit/skia
                     |     default 2D renderer
                     |
                     +-- @react-native-gamekit/webgpu
                           advanced 2D and rendering primitives
                                      |
                                      +-- future @react-native-gamekit/3d
```

Package responsibilities should be separated as follows:

### `react-native-gamekit`

- No Skia or WebGPU implementation dependency
- Headless and deterministic
- Owns the fixed-step simulation contract
- Produces renderer-neutral snapshots or render data
- Does not expose GPU objects in core APIs

### `@react-native-gamekit/skia`

- Default 2D path
- Simple installation and API
- Retained, immediate, and hybrid Skia techniques selected internally
- Remains sufficient for the majority of 2D games

### `@react-native-gamekit/webgpu`

- Optional native renderer
- Owns WebGPU devices, contexts, pipelines, buffers, textures, and recovery
- Converts renderer-neutral GameKit data into GPU buffers
- May use TypeGPU internally
- Provides explicit feature detection and fallback behavior

`react-native-webgpu` should be a peer dependency of this optional renderer,
not a dependency of the main GameKit package. This prevents every 2D GameKit
consumer from carrying an unused native module and follows the repository's
native singleton dependency policy.

TypeGPU can be a normal implementation dependency if it remains internal. If
public GameKit APIs accept or expose TypeGPU resources, TypeGPU should instead
be treated as a peer-facing part of the renderer contract and versioned
carefully.

## Proposed runtime model

The authoritative simulation and renderer should not become one GPU-driven
loop.

```text
Fixed-step GameKit simulation
          |
          | compact commits / numeric render data
          v
WebGPU presentation runtime
          |
          | interpolate previous and current commits
          v
Persistent GPU buffers -> render/compute passes -> submit -> present
```

Recommended behavior:

1. GameKit advances authoritative state at its configured fixed-step rate.
2. It publishes only when simulation state advances.
3. The renderer receives compact numeric data, not a large React object tree.
4. A UI or dedicated Worklet runtime presents at the display refresh rate.
5. The renderer interpolates between adjacent simulation snapshots.
6. Buffers, pipelines, bind groups, samplers, and textures are created once and
   reused whenever possible.
7. A single GameKit-owned presentation clock drives rendering. A second React
   or TypeGPU animation loop should not compete with it.

React Native WebGPU documents that device-loss and error events are delivered
on the main JavaScript runtime. The GPU device should normally be created there
and then sent to the selected render runtime.

## Skia interoperability

### Current Skia releases

The standard React Native Skia releases use Ganesh. React Native WebGPU and
Skia can coexist in an application, but they do not share a device or provide
automatic zero-copy texture interoperability in this configuration.

A current hybrid could use separate surfaces or layer a React Native/Skia HUD
over a WebGPU view. This requires device testing, particularly on Android,
where WebGPU Canvas can use `SurfaceView` or `TextureView` and transparency or
z-order affects composition.

### Future Skia Graphite option

Skia's Graphite `@next` builds can share Dawn, a GPU instance, devices, and
textures with React Native WebGPU. This makes a future zero-copy hybrid
possible:

- WebGPU renders a 3D scene or compute-generated texture.
- Skia consumes the texture and renders 2D overlays or effects.
- Skia provides HUD, typography, and familiar 2D primitives.

Graphite and React Native WebGPU must use compatible Dawn revisions. A mismatch
can fail the native build. Because this integration currently depends on
pre-release Skia builds and lockstep native versions, it should not be a v1
foundation.

## iPad and tablet considerations

WebGPU Canvas separates logical React Native layout dimensions from the
physical drawing-buffer size. The renderer must account for `PixelRatio` and
update the physical buffer when any of the following changes:

- Device rotation
- Window resizing
- iPad split view or stage management
- External display changes
- Render-resolution scaling

Rendering an iPad's complete high-DPI buffer can become fill-rate intensive.
Advanced scenes may need a configurable resolution scale while keeping React
Native layout, input coordinates, camera projection, and GPU viewport mappings
correct.

## Important constraints and risks

### WebGPU does not fix the current frame drops automatically

Replacing Skia drawing with WebGPU would not fix unnecessary JavaScript frame
publication, JS-to-UI crossings, deep freezing, mapper fan-out, React HUD
updates, or input traffic. The Task 5 and Task 6 architecture work remains the
first priority.

### Complexity increases materially

A production renderer must handle:

- Adapter and feature discovery
- Device creation and device loss
- Shader compilation errors
- Buffer alignment and lifetime
- Texture formats and uploads
- Surface resize and presentation
- Runtime synchronization
- Application backgrounding
- Resource cleanup
- Driver and device differences
- Thermal pressure and memory budgets

TypeGPU reduces some type and layout mistakes but does not remove these
responsibilities.

### Physical-device profiling is mandatory

Android emulators can fall back to software rendering, and simulator behavior
does not represent mobile GPU performance. Decisions must be based on release
builds running on physical iPhone, Android, and iPad hardware.

### Readback should be avoided

GPU-to-CPU readback can synchronize and stall the pipeline. GameKit should
prefer one-way publication of simulation data to the renderer. GPU results
should stay on the GPU across passes whenever possible.

### Fallback behavior is required

The optional renderer should detect missing adapters or required features. A
game must be able to declare whether it can:

- Fall back to the Skia renderer
- Disable a specific visual effect
- Reduce rendering quality
- Show an unsupported-device message

## Validation spike

Do not install WebGPU into the main GameKit package for this experiment. Add it
only to the playground and an unpublished experimental renderer.

### Experiment A: integration baseline

- Add the React Native WebGPU Expo config plugin.
- Complete clean Expo prebuilds for iOS and Android.
- Render a TypeGPU triangle.
- Verify debug and release builds.
- Verify Fast Refresh and full reload behavior.
- Verify cleanup across repeated mount/unmount cycles.

### Experiment B: advanced 2D comparison

Implement equivalent dynamic scenes using:

1. Skia retained mode
2. Skia `Atlas` or `Picture`, as appropriate
3. WebGPU instanced sprites

Suggested loads are 1,000, 10,000, and 50,000 moving sprites or particles.
Measure CPU frame time, GPU frame time, JS and UI frame stability, memory,
startup cost, input latency, and battery/thermal behavior.

### Experiment C: runtime placement

Compare:

- Main JavaScript runtime rendering
- UI Worklet rendering
- Dedicated Worklet runtime rendering

GameKit should choose the simplest runtime that meets the target. A dedicated
runtime should only be adopted when measurements justify the synchronization
and lifecycle complexity.

### Experiment D: tablet lifecycle

Test:

- iPad portrait and landscape
- Split view resizing
- 60 Hz and 120 Hz displays
- Background/foreground cycles
- Resolution scaling
- Memory pressure
- Fifty renderer open/close cycles

### Decision gates

Proceed to an optional public renderer only if the spike demonstrates:

- A repeatable advantage for at least one target GameKit workload
- No regression in input responsiveness
- Stable lifecycle and resource cleanup
- Acceptable installation and Expo prebuild complexity
- A renderer-neutral core API that does not leak WebGPU concerns
- A documented Skia fallback or unsupported-device policy

## Final recommendation

Continue with Skia and complete the existing v1 performance work. Preserve the
renderer boundary so a WebGPU adapter can be added without changing simulation,
input, scenes, or game definitions.

Treat WebGPU as the likely foundation for future custom 3D and as an optional
acceleration path for a measured set of advanced 2D workloads. Treat TypeGPU as
an implementation tool that makes WebGPU safer and more approachable, not as a
replacement for GameKit's simple public API.

## Primary sources

- [React Native WebGPU installation](https://wcandillon.github.io/react-native-webgpu/docs/getting-started/installation)
- [React Native WebGPU with Expo](https://wcandillon.github.io/react-native-webgpu/docs/getting-started/expo)
- [React Native WebGPU Canvas](https://wcandillon.github.io/react-native-webgpu/docs/getting-started/canvas)
- [React Native WebGPU native API and threading](https://wcandillon.github.io/react-native-webgpu/docs/getting-started/native-api)
- [React Native WebGPU Worklets integration](https://wcandillon.github.io/react-native-webgpu/docs/integrations/worklets)
- [React Native WebGPU TypeGPU integration](https://wcandillon.github.io/react-native-webgpu/docs/integrations/typegpu)
- [React Native WebGPU and React Native Skia integration](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-native-skia)
- [TypeGPU documentation](https://docs.swmansion.com/TypeGPU/)
- [TypeGPU React Native integration](https://docs.swmansion.com/TypeGPU/integration/react-native/)
- [TypeGPU WebGPU interoperability](https://docs.swmansion.com/TypeGPU/integration/webgpu-interoperability/)
