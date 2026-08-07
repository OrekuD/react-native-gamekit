# AGENTS.md

Project invariants for agents and humans working in this repository. Read before changing anything.

## Canonical workspace commands

Run from the repository root. Use Turborepo filters rather than pnpm recursion.

```sh
pnpm install        # workspace install, one shared lockfile
pnpm dev            # docs + playground development tasks (persistent)
pnpm dev:docs       # Fumadocs only
pnpm dev:playground # Expo/Metro only
pnpm ios            # build + run the playground on iOS (not cached by turbo)
pnpm android        # build + run the playground on Android (not cached by turbo)
pnpm expo:prebuild      # generate native playground projects (CNG)
pnpm expo:prebuild:clean # regenerate from a clean state
pnpm build          # workspace builds + docs production build
pnpm lint           # lint all workspaces
pnpm typecheck      # type-check all workspaces
pnpm test           # run all workspace tests
pnpm test:coverage  # tests with coverage where supported
pnpm check          # lint -> typecheck -> test -> build, in that order
```

## Invariants

1. **No per-frame React state.** React props configure or observe a game session; they never become the per-frame store. Game state advances through the headless session, not through React re-renders.
2. **Generated native directories stay untracked.** `apps/playground/ios` and `apps/playground/android` are produced by Expo Continuous Native Generation and must never be committed. Change native configuration through `app.json` and config plugins only.
3. **Native singleton dependency policy.** Native singleton packages (Skia, Gesture Handler, Reanimated/Worklets, Expo modules, Safe Area Context) live in the playground's `dependencies`, the library's `peerDependencies`, and the library's exact `devDependencies`. They must never be placed in the library's normal `dependencies`. Applications must contain exactly one compatible copy of every native peer.
4. **Test-first changes.** Write the failing test and/or compile-time fixture before the implementation that makes it pass.
5. **Expo Go is not a supported requirement.** The playground uses local native development builds via `expo prebuild` and `expo run:ios`/`expo run:android`.
6. **One lockfile.** `apps/*` and `packages/*` share the root pnpm workspace with a single lockfile. Never initialize a nested package manager.
7. **Framework-owned TypeScript configs.** Expo and Next.js extend their framework-owned base configs. The root `tsconfig.base.json` applies only to non-framework packages.
8. **Documented provisional API only.** The `defineGame`, `defineScene`, `createGameSession`, and `GameView` shapes remain provisional until reference games validate them. Document only implemented runtime methods; scene transitions, `setScene`, `restart`, and a separate `resume` method do not exist yet.

## Repository layout

- `packages/gamekit` — the only publishable package (`react-native-gamekit`). Built with React Native Builder Bob; ESM output to `lib/`, TypeScript declarations included. `src/` contains the library, `test/` contains tests.
- `apps/playground` — Expo SDK 57 dev-build playground (iOS/iPadOS/Android), tablet enabled, both orientations.
- `apps/docs` — Fumadocs/Next.js documentation site. Must never import React Native, Skia, or the native GameKit runtime into the Next.js server bundle.
- `plans/` — task plans. Task boundaries are authoritative; do not implement later tasks' scope ahead of time.
