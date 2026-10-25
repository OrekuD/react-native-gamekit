# React Native GameKit

> **🚧 Work in Progress** — This project is under active development. APIs, documentation, and examples are subject to change without notice and are not yet recommended for production use.

A headless 2D game toolkit for React Native and Expo. Everything a 2D game
needs, running headless: scenes, input, physics-grade collision, cameras,
audio. Bring your own renderer or use Skia.

This repository is a pnpm + Turborepo monorepo containing three projects:

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/gamekit` | `rn-gamekit` | The publishable TypeScript library: fixed-step sessions, 2D game systems, and React/Skia presentation. |
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

## Dependency maintenance

Native versions live in `catalogs.native` in `pnpm-workspace.yaml`.
Run `pnpm deps:check` to validate manifests, the lockfile, and installed native
resolutions; `pnpm deps:docs` updates compatibility tables and installation recipes.
See the [contributing guide](apps/docs/content/docs/advanced/contributing.mdx)
for grouped upgrades, Expo exceptions, and native validation.

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
- Bounded particle effects, chunked tilemaps, platformer movement helpers,
  versioned saves, migrations, and ordered storage adapters.
- Opt-in audio and haptics through dedicated package subpaths.

The React entry (`rn-gamekit/react`) adds:

- `GameView` — mounts a Skia canvas, resolves the viewport from the mounted
  surface, binds `AppState`, and never renders per-frame React state.
- `GamePointerInput` — Gesture Handler adapter that feeds logical coordinates
  through the shared viewport.
- `GameButtonPad` and `GameButton` — multi-touch-safe semantic button input.
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
- `TileMapLayer2D` — bounded Atlas presentation for chunked tilemap layers.

The playground includes reference games and labs for sessions, sprites,
collision, cameras, particles, tilemaps, audio, haptics, storage, and
performance. See the docs for walkthroughs.

Physics simulation, broader input adapters, and 3D remain future work.

## Compatibility

The native workspace versions and published support ranges are shown below.
Audio, haptics, and persistent storage peers are optional.

<!-- deps:table:start -->
| Package | Workspace version | Supported peer range |
| --- | --- | --- |
| `@react-native-async-storage/async-storage` | `2.2.0` | `^2.2.0` |
| `@shopify/react-native-skia` | `2.11.0` | `2.11.0` |
| `expo` | `57.0.25` | `~57.0.25` |
| `expo-asset` | `57.0.18` | `~57.0.18` |
| `react` | `19.2.3` | `^19.2.3` |
| `react-native` | `0.86.3` | `~0.86.3` |
| `react-native-audio-api` | `0.13.3` | `^0.13.3` |
| `react-native-gesture-handler` | `3.1.0` | `~3.1.0` |
| `react-native-pulsar` | `1.7.0` | `^1.7.0` |
| `react-native-reanimated` | `4.5.3` | `4.5.3` |
| `react-native-worklets` | `0.10.3` | `0.10.3` |
<!-- deps:table:end -->

See `apps/docs/content/docs/introduction/supported-platforms.mdx` for the
documented compatibility page.

## Credits

The playground demo games use third-party asset packs (not part of the `rn-gamekit` package). Follow each pack's license terms if you redistribute them:

- [Mossy Cavern](https://maaot.itch.io/mossy-cavern) by maaot
- [Pixel Adventure 1](https://pixelfrog-assets.itch.io/pixel-adventure-1) by Pixel Frog
- [Brackeys' Platformer Bundle](https://brackeysgames.itch.io/brackeys-platformer-bundle) by Brackeys Games
- [Mixkit Game Sound Effects](https://mixkit.co/free-sound-effects/game/) — free SFX for the audio demos (see [mixkit.co/license](https://mixkit.co/license/))
