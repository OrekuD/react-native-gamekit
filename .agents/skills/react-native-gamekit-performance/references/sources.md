# Official source manifest

Retrieved and reviewed on **2026-08-07**. These notes are distilled from official project documentation and repositories. They are not a verbatim mirror; follow the linked page when an exact signature or version table matters.

## Repository baseline

The GameKit lockfile used during this review resolves:

| Package | Repository version |
| --- | --- |
| React Native | 0.86.2 |
| Expo | 57.0.10 |
| `@shopify/react-native-skia` | 2.6.2 |
| `react-native-reanimated` | 4.5.1 |
| `react-native-worklets` | 0.10.1 |
| `react-native-gesture-handler` | 2.32.0 |

Always re-read the package manifests and lockfile. This table documents the baseline, not a permanent support policy.

## Pinned upstream revisions

| Project | Revision reviewed | Purpose |
| --- | --- | --- |
| [Shopify/react-native-skia at the reviewed revision](https://github.com/Shopify/react-native-skia/tree/923ac2c24c4f18455fbbde31488b819ccb22aa24) | `923ac2c24c4f18455fbbde31488b819ccb22aa24` | Current Skia docs corresponding to the user-supplied pages and related rendering topics |
| [Reanimated 4.5.1 source and docs](https://github.com/software-mansion/react-native-reanimated/tree/04a7c4023bb9ff4c71f25753bd332432da5a6a04) | tag `4.5.1`, commit `04a7c4023bb9ff4c71f25753bd332432da5a6a04` | Reanimated 4.5.1 docs plus the colocated Worklets 0.10-era docs |
| [Reanimated/Worklets forward-looking revision](https://github.com/software-mansion/react-native-reanimated/tree/fb68ce75cbce7494b6a72c5b3db2a0bd5211ce9c) | `fb68ce75cbce7494b6a72c5b3db2a0bd5211ce9c` | Forward-looking comparison for newer Worklets docs; do not assume these APIs exist in the installed version |
| [Gesture Handler RNGH 3 revision](https://github.com/software-mansion/react-native-gesture-handler/tree/73c51c7af6bf8486b2032c27482bc3a43570a3e5) | `73c51c7af6bf8486b2032c27482bc3a43570a3e5` | RNGH 3 migration awareness only |

All three projects use the MIT License. The skill paraphrases documentation and links to the originals rather than vendoring their full text.

## React Native Skia: required set

These are the pages supplied by the user and fully reviewed:

- [Canvas overview](https://shopify.github.io/react-native-skia/docs/canvas/overview)
- [Rendering modes](https://shopify.github.io/react-native-skia/docs/canvas/rendering-modes)
- [Canvas contexts](https://shopify.github.io/react-native-skia/docs/canvas/contexts)
- [Animations](https://shopify.github.io/react-native-skia/docs/animations/animations)
- [Gestures](https://shopify.github.io/react-native-skia/docs/animations/gestures)
- [Animation hooks](https://shopify.github.io/react-native-skia/docs/animations/hooks)
- [Textures](https://shopify.github.io/react-native-skia/docs/animations/textures)

Source files at the pinned Skia revision:

```text
apps/docs/docs/canvas/canvas.md
apps/docs/docs/canvas/rendering-modes.md
apps/docs/docs/canvas/contexts.md
apps/docs/docs/animations/reanimated3.md
apps/docs/docs/animations/gestures.md
apps/docs/docs/animations/hooks.md
apps/docs/docs/animations/textures.md
```

## React Native Skia: performance additions

These are the additional official pages worth keeping in the GameKit corpus:

- [Painting](https://shopify.github.io/react-native-skia/docs/paint/overview)
- [Group and layer effects](https://shopify.github.io/react-native-skia/docs/group)
- [Pictures / immediate mode](https://shopify.github.io/react-native-skia/docs/shapes/pictures)
- [Atlas / batched sprites](https://shopify.github.io/react-native-skia/docs/shapes/atlas)
- [Paths](https://shopify.github.io/react-native-skia/docs/shapes/path)
- [Images and sampling](https://shopify.github.io/react-native-skia/docs/images)
- [Paragraph text](https://shopify.github.io/react-native-skia/docs/text/paragraph)
- [SkSL/runtime shaders](https://shopify.github.io/react-native-skia/docs/shaders/overview)
- [Image shaders](https://shopify.github.io/react-native-skia/docs/shaders/images)
- [Image filters](https://shopify.github.io/react-native-skia/docs/image-filters/overview)
- [RuntimeShader image-filter pixel density](https://shopify.github.io/react-native-skia/docs/image-filters/runtime-shader)
- [Installation and compatibility](https://shopify.github.io/react-native-skia/docs/getting-started/installation)
- [Bundle size](https://shopify.github.io/react-native-skia/docs/getting-started/bundle-size)

Corresponding source paths are listed in `source-manifest.json`.

The textures page contains some older Reanimated terminology. Prefer the installed Worklets scheduling API when its example conflicts with current Software Mansion docs.

## Reanimated 4.5.1: required performance set

These pages come from the official Software Mansion repository at the exact Reanimated 4.5.1 tag:

- [Performance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance)
- [Compatibility](https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility)
- [Worklets guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/worklets)
- [`useSharedValue`](https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue)
- [`useDerivedValue`](https://docs.swmansion.com/react-native-reanimated/docs/core/useDerivedValue)
- [`useFrameCallback`](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useFrameCallback)
- [`useAnimatedReaction`](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useAnimatedReaction)
- [`makeMutable`](https://docs.swmansion.com/react-native-reanimated/docs/advanced/makeMutable)
- [`useTimestamp`](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useTimestamp)
- [`cancelAnimation`](https://docs.swmansion.com/react-native-reanimated/docs/core/cancelAnimation)
- [Gesture handling](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/handling-gestures)
- [Animation modifiers](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/applying-modifiers)
- [`withTiming`](https://docs.swmansion.com/react-native-reanimated/docs/animations/withTiming)
- [`withSpring`](https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring)
- [`withDecay`](https://docs.swmansion.com/react-native-reanimated/docs/animations/withDecay)
- [`useReducedMotion`](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion)
- [Feature flags](https://docs.swmansion.com/react-native-reanimated/docs/guides/feature-flags)
- [Accurate call stacks](https://docs.swmansion.com/react-native-reanimated/docs/debugging/accurate-call-stacks)
- [Logger configuration](https://docs.swmansion.com/react-native-reanimated/docs/debugging/logger-configuration)

The public documentation site may update ahead of this project's packages. For version-sensitive details, inspect the same file under commit `04a7c4023bb9ff4c71f25753bd332432da5a6a04`.

## React Native Worklets 0.10-era set

Worklets documentation lives in the Reanimated monorepo under `docs/docs-worklets/docs/`:

- [Runtime kinds](https://docs.swmansion.com/react-native-worklets/docs/fundamentals/runtimeKinds)
- [Closures](https://docs.swmansion.com/react-native-worklets/docs/fundamentals/closures)
- [Sharing memory](https://docs.swmansion.com/react-native-worklets/docs/fundamentals/sharing-memory)
- [`scheduleOnUI`](https://docs.swmansion.com/react-native-worklets/docs/threading/scheduleOnUI)
- [`scheduleOnRN`](https://docs.swmansion.com/react-native-worklets/docs/threading/scheduleOnRN)
- [`createWorkletRuntime`](https://docs.swmansion.com/react-native-worklets/docs/threading/createWorkletRuntime)
- [`scheduleOnRuntime`](https://docs.swmansion.com/react-native-worklets/docs/threading/scheduleOnRuntime)
- [Call tables](https://docs.swmansion.com/react-native-worklets/docs/guides/call-tables)
- [Bundle Mode overview](https://docs.swmansion.com/react-native-worklets/docs/bundleMode)
- [Compatibility](https://docs.swmansion.com/react-native-worklets/docs/guides/compatibility)
- [Feature flags](https://docs.swmansion.com/react-native-worklets/docs/guides/feature-flags)

Bundle Mode and custom runtime options are evolving. Treat them as opt-in, version-gated architecture work rather than GameKit defaults.

## Gesture Handler 2.32 baseline

The latest RNGH source tree contains RNGH 3 docs, while this project is on RNGH 2. Use the official versioned 2.x site for implementation:

- [RNGH 2 installation](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/fundamentals/installation/)
- [GestureDetector](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/gestures/gesture-detector/)
- [Gesture state and events](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/fundamentals/states-events/)
- [Gesture composition](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/fundamentals/gesture-composition/)
- [Pan gesture](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/gestures/pan-gesture/)
- [Pinch gesture](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/gestures/pinch-gesture/)
- [Rotation gesture](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/gestures/rotation-gesture/)
- [Manual gesture](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/gestures/manual-gesture/)
- [Upgrade from legacy API to RNGH 2](https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/guides/upgrading-to-2/)
- [RNGH 3 migration guide](https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/) — future only

## Refresh procedure

Run the bundled source tool into a new directory:

```bash
python3 .agents/skills/react-native-gamekit-performance/scripts/sync_official_sources.py \
  --output /tmp/gamekit-official-docs
```

It fetches the pinned raw Markdown files and records what was downloaded. Use `--latest` only to audit upstream changes; never replace version-sensitive guidance without checking the repository dependency matrix and tests.
