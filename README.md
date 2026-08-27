# React Native GameKit

> **🚧 Work in Progress** — This project is under active development. APIs, documentation, and examples are subject to change without notice and are not yet recommended for production use.

A headless 2D game toolkit for React Native and Expo. Everything a 2D game
needs, running headless: scenes, input, physics-grade collision, cameras,
audio. Bring your own renderer or use Skia.

This repository is a pnpm + Turborepo monorepo containing three projects:

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/gamekit` | `rn-gamekit` | The publishable TypeScript library: fixed-step headless session, named scenes and transitions, button/pointer input, viewport math, and a React/Skia adapter. |
| `apps/playground` | `@react-native-gamekit/playground` | Expo development-build playground for iOS, iPadOS, and Android with shape, Brick Breaker, sprite, and performance examples. |
| `apps/docs` | `@react-native-gamekit/docs` | Fumadocs (Next.js) documentation site. |

## Requirements

- Node.js `>=22.13.0`
- pnpm 11 (pinned via `packageManager` in the root `package.json`)

## Getting started

```sh
pnpm install
```

### Development builds (not Expo Go)

The playground targets local native development builds. Expo Go is not a supported requirement.

```sh
# generate native projects once (continuous native generation)
pnpm expo:prebuild

# run on a simulator/emulator
pnpm ios
pnpm android
```

Generated `apps/playground/ios` and `apps/playground/android` directories are untracked. Regenerate them from scratch with `pnpm expo:prebuild:clean` and review them only when CNG changes are intentional.

If Expo reports that it cannot replace React Native's `HMRClient` with
`expo/src/async-require/hmr.ts`, stop any existing Metro process before
restarting the playground with a clean cache:

```sh
pnpm --filter @react-native-gamekit/playground exec expo start --dev-client --clear
```

Then press `i` in the Expo terminal to open the installed iOS development
build. Do not reuse a Metro server started with `CI=true` for an interactive
development session.

### Docs

```sh
pnpm dev:docs   # http://localhost:3000
pnpm build:docs
```

## Current API surface (provisional)

The headless entry (`rn-gamekit`) imports nothing native and runs in
Node for deterministic tests:

- `defineGame` / `defineScene` — static, type-checked game definitions with
  inferred scene, snapshot, action, and transition types.
- `createGameSession` — one authoritative fixed-step session. Named scenes,
  deterministic transitions and restarts, monotonic global time with
  scene-local time, and scene-discriminated render frames.
- `InputFrame` button and pointer actions with immutable per-tick sampling,
  one-tick edges, ownership, and cancellation.
- `Viewport2D` headless math — `fit`, `fill`, and `extend-world` modes;
  `resolveViewport2D`, `worldToSurface`, `surfaceToWorld`,
  `containsSurfacePoint`.
- Typed local assets, sprite-sheet clips, and deterministic animation state.
- `Camera2D` helpers — world/surface transforms, follow behavior, clamped
  bounds, shake sampling, interpolation, and view culling.
- Geometry primitives (`Point2D`, `Vector2D`, `Aabb2D`, `Circle2D`,
  `Segment2D`) and 2D collision detection — intersection tests, segment hits,
  swept collisions, manifolds, broad-phase spatial hashing, and collision
  filters.
- Typed game events via `defineGameEvents` / `gameEvent` with typed
  envelopes, payload limits, and deterministic seeding.

The React entry (`rn-gamekit/react`) adds:

- `GameView` — mounts a Skia canvas, resolves the viewport from the mounted
  surface, binds `AppState`, and never renders per-frame React state.
- `GamePointerInput` — Gesture Handler adapter that feeds logical coordinates
  through the shared viewport.
- `useGameSession` and `useGameSessionStatus` — React bindings for observing
  and driving a session without owning the frame loop.
- `useGameAssets`, `Sprite`, `GameSprite`, and `SpriteBatch` — reference-counted
  loading and retained/Atlas-backed sprite rendering.
- `GameWorld2D` and `GameLayer2D` — a retained Skia scene graph with parallax
  layers.
- `defineGameCamera2D` — one `GameView`-owned presented camera that drives
  rendering and pointer input through the same generation.
- `ParticleView` and `useParticlePresentation` — presentation-only Skia
  rendering of headless particle systems.

The playground includes a moving-shape bootstrap, Brick Breaker, Paddle,
Sprite Field, Collision Lab, Camera Lab, Particle Lab, and the Performance
Lab. See the docs for walkthroughs.

Physics simulation, broader input adapters, tilemaps, and 3D remain future
work.

## Compatibility

The first supported line (validated in the playground):

| Dependency | Version |
| --- | --- |
| Expo | SDK 57 (`~57.0.10`) |
| React Native | `0.86.2` |
| React | `19.2.3` |
| React Native Skia | `2.11.0` |
| React Native Gesture Handler | `~3.1.0` |
| React Native Reanimated | `4.5.3` |
| React Native Worklets | `0.10.3` |
| Expo Asset | `~57.0.8` |

See `apps/docs/content/docs/compatibility.mdx` for the documented compatibility page.

## Credits

The playground demo games use third-party asset packs (not part of the `rn-gamekit` package). Follow each pack's license terms if you redistribute them:

- [Mossy Cavern](https://maaot.itch.io/mossy-cavern) by maaot
- [Pixel Adventure 1](https://pixelfrog-assets.itch.io/pixel-adventure-1) by Pixel Frog
- [Brackeys' Platformer Bundle](https://brackeysgames.itch.io/brackeys-platformer-bundle) by Brackeys Games
