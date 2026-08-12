# React Native GameKit

A React Native game toolkit for mobile and tablet, built on Expo. This repository is a pnpm + Turborepo monorepo containing three projects:

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/gamekit` | `react-native-gamekit` | The publishable TypeScript library: fixed-step headless session, named scenes and transitions, button/pointer input, viewport math, and a React/Skia adapter. |
| `apps/playground` | `@react-native-gamekit/playground` | Expo development-build playground for iOS, iPadOS, and Android with shape, Brick Breaker, sprite, and performance examples. |
| `apps/docs` | `@react-native-gamekit/docs` | Fumadocs (Next.js) documentation site. |

Product and architecture research lives in [`REACT_NATIVE_GAMEKIT_RESEARCH.md`](./REACT_NATIVE_GAMEKIT_RESEARCH.md).

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

The headless entry (`react-native-gamekit`) imports nothing native and runs in
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

The React entry (`react-native-gamekit/react`) adds:

- `GameView` — mounts a Skia canvas, resolves the viewport from the mounted
  surface, binds `AppState`, and never renders per-frame React state.
- `GamePointerInput` — Gesture Handler adapter that feeds logical coordinates
  through the shared viewport.
- `useGameAssets`, `Sprite`, `GameSprite`, and `SpriteBatch` — reference-counted
  loading and retained/Atlas-backed sprite rendering.

The playground includes a moving-shape bootstrap, Brick Breaker, a sprite-field
and animation showcase, and the Performance Lab. See the docs for walkthroughs.

Physics, audio, haptics, broader input adapters, tilemaps, and 3D are explicitly
future work.

## Workspace commands

Run these from the repository root. They use Turborepo filters to cover all participating workspaces.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start persistent development tasks (docs + playground). |
| `pnpm dev:docs` | Start only Fumadocs. |
| `pnpm dev:playground` | Start only Expo/Metro. |
| `pnpm ios` | Build and run the playground on iOS. |
| `pnpm android` | Build and run the playground on Android. |
| `pnpm expo:prebuild` | Generate native playground projects. |
| `pnpm expo:prebuild:clean` | Regenerate native playground projects from a clean state. |
| `pnpm build` | Build workspace packages and production-build the docs. |
| `pnpm lint` | Lint all participating workspaces. |
| `pnpm typecheck` | Type-check all participating workspaces. |
| `pnpm test` | Run all workspace tests. |
| `pnpm test:coverage` | Run tests with coverage where supported. |
| `pnpm check` | Run lint, typecheck, tests, and builds in that order. |

`ios`, `android`, and `expo:prebuild*` alter or compile native projects and are intentionally not cached by Turborepo.

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
