# React Native GameKit

A headless-first 2D game toolkit for React Native and Expo, built for phones
and tablets.

> **0.2 preview:** React Native GameKit is usable for small 2D games and
> prototypes, but its API may change before 1.0.

## What is included

- deterministic fixed-step game sessions;
- immutable functional scenes and scene transitions;
- semantic button and multi-touch-safe pointer input;
- phone, tablet, rotation, and split-view viewport mapping;
- React Native Skia rendering with Reanimated interpolation;
- typed local images, sprite sheets, animation clips, and asset loading;
- retained sprites and Atlas-backed sprite batching;
- geometry, Collision2D, Camera2D, and deterministic game events;
- bounded particles, tilemaps, and platformer movement helpers;
- opt-in audio, haptics, and versioned storage;
- a native-free root entry for headless tests.

## Requirements

Version 0.2 targets Expo SDK 57. Workspace versions are exact development pins;
supported peer ranges are the library's consumer contract. Audio, haptics, and
persistent storage peers are optional.

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

Expo Go is not required or supported. Use an Expo development build and
`expo prebuild`, or a bare React Native app configured with Expo Modules.

## Installation

<!-- deps:install:start -->
```sh
npm install rn-gamekit
npx expo install @shopify/react-native-skia@2.11.0 expo-asset@57.0.18 react-native-gesture-handler@3.1.0 react-native-reanimated@4.5.3 react-native-worklets@0.10.3
```
<!-- deps:install:end -->

Merge these exclusions into your application's `package.json`. These four
libraries use GameKit's selected native versions rather than Expo's defaults;
review their compatibility before changing them or running `expo install --fix`.

<!-- deps:excludes:start -->
```json
{
  "expo": {
    "install": {
      "exclude": [
        "@shopify/react-native-skia",
        "react-native-gesture-handler",
        "react-native-reanimated",
        "react-native-worklets"
      ]
    }
  }
}
```
<!-- deps:excludes:end -->

Install optional native peers only for the systems you use: audio uses
`react-native-audio-api`, haptics uses `react-native-pulsar`, and persistent
storage uses `@react-native-async-storage/async-storage`.

<!-- deps:optional:start -->
```sh
npx expo install @react-native-async-storage/async-storage@2.2.0
npx expo install react-native-audio-api@0.13.3
npx expo install react-native-pulsar@1.7.0
```
<!-- deps:optional:end -->

Then regenerate and build the native projects:

```sh
npx expo prebuild
npx expo run:ios
npx expo run:android
```

Wrap the application with Gesture Handler's root view:

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Your application */}
    </GestureHandlerRootView>
  );
}
```

Native libraries are peer dependencies. The application owns them so there is
exactly one native copy, while GameKit releases declare the versions they were
validated against.

## Define a game

```ts
import {
  createGameSession,
  defineGame,
  defineScene,
} from 'rn-gamekit';

const game = defineGame({
  viewport: {
    logicalSize: { width: 320, height: 480 },
    mode: 'fit',
  },
  input: {
    move: { type: 'pointer' },
  },
  scenes: {
    play: defineScene({
      actions: ['move'],
      create: () => ({ x: 160, y: 240 }),
      update: ({ state, input }) => {
        const pointer = input.pointer('move');
        return pointer.active && pointer.position !== undefined
          ? { x: pointer.position.x, y: pointer.position.y }
          : state;
      },
      snapshot: ({ state }) => state,
    }),
  },
  initialScene: 'play',
});

const session = createGameSession(game);
session.start();
```

In React, own the session with `useGameSession` and hand it to the native
entry point:

```tsx
import {
  GamePointerInput,
  GameView,
  useGameSession,
} from 'rn-gamekit/react';

function GameScreen() {
  const session = useGameSession(game);

  if (session === undefined) {
    return null;
  }

  return (
    <GameView game={session} renderer={GameRenderer}>
      <GamePointerInput game={session} action="move" />
    </GameView>
  );
}
```

The hook creates the session, disposes it exactly once on replacement or
unmount, and is safe under Strict Mode. `GameView` borrows the session: it
starts it while mounted, pauses it on unmount and backgrounding, and never
disposes it. For headless tests and non-React owners, keep the imperative
`createGameSession()` / `try/finally dispose()` path shown above.

Pause and resume are the same commands everywhere: `session.pause()` freezes
the simulation and holds the last frame, `session.start()` resumes with a
fresh clock baseline, gameplay input is cancelled and rejected while paused,
and `useGameSessionStatus(session)` drives pause UI without a second state
source.

`rn-gamekit` is one npm package. Paths like `rn-gamekit/collision2d` are
package export subpaths. They aren't separately versioned or published; they
share the same version, peer policy, exports map, and tarball.

### Entry points (one package, one install)

| Entry point | What lives there | Must not load |
| --- | --- | --- |
| `rn-gamekit` | Game & scene definitions, session creation, viewport contracts, and compatibility re-exports for all headless systems | — |
| `rn-gamekit/geometry` | Points, vectors, AABBs, circles, segments, immutable geometry helpers, `GeometryError` | React / Skia / native peers |
| `rn-gamekit/collision2d` | Predicates, manifolds, sweeps, filters, colliders, spatial hash, debug projections | React / Skia / physics backends |
| `rn-gamekit/camera2d` | Pure camera values, transforms, follow, clamp, shake, interpolation, visibility | React hooks / Skia / Reanimated |
| `rn-gamekit/events` | `defineGameEvents` / `gameEvent`, envelopes, `PAYLOAD_LIMITS`, `seedGameEvent`, `GameEventError` | Effect consumers / React / native peers |
| `rn-gamekit/assets` | `defineAssets` / `image` / `spriteSheet`, descriptor & loaded-value types, `GameAssetError` | React hooks / Skia decoding / Expo Asset |
| `rn-gamekit/sprites` | `sampleSpriteClip*` & playback-state helpers (`start/advance/…SpriteAnimation`) | React components / Skia Atlas |
| `rn-gamekit/storage` | Versioned settings and save projections (`defineGameSave`, `createGameSaveStore`, `createMemoryStorageAdapter` / `createGameStorageAdapter`, `GameStorageError`, `STORAGE_LIMITS`) | React / Skia / native peers except optional `async-storage` peer |
| `rn-gamekit/react` | `GameView`, `GameWorld2D`, `Sprite`, `GameSprite`, `SpriteBatch`, `defineGameCamera2D`, asset/particle/tilemap rendering, pointer input, hooks | — |
| `rn-gamekit/audio` · `rn-gamekit/haptics` · `rn-gamekit/particles` · `rn-gamekit/tilemap` | Audio, haptics, particle effects, tilemaps (existing ownership) | — |
| `rn-gamekit/testing` | Deterministic frame drivers for Node tests (test-only, never production) | — |

Headless entries (`geometry`, `collision2d`, `camera2d`, `events`, `assets`, `sprites`, `storage`) import no React, React Native, Skia, Reanimated, Worklets, Expo Asset, or optional native peers. `rn-gamekit/react` is the only entry that loads Skia/Reanimated/Gesture Handler.

**Preferred imports (new code):**

```ts
import type { Aabb2D } from 'rn-gamekit/geometry';
import { collideCircleAabb2D } from 'rn-gamekit/collision2d';
import { createCamera2D } from 'rn-gamekit/camera2d';
import { defineGameEvents, gameEvent } from 'rn-gamekit/events';
import { defineAssets, image, spriteSheet } from 'rn-gamekit/assets';
import { sampleSpriteClipFrame, startSpriteAnimation } from 'rn-gamekit/sprites';
import { createGameSaveStore, defineGameSave } from 'rn-gamekit/storage';
import { GameView, GameWorld2D, Sprite } from 'rn-gamekit/react';
```

**Compatibility:** `import { collideCircleAabb2D } from 'rn-gamekit'` and other existing root imports continue to work. Root and subpath exports reference the same underlying symbols (`===` and `instanceof` preserved, no duplicate state). No deprecation or removal is announced in this release — the new subpaths are the preferred organization, not a breaking change.

See the [repository documentation](https://github.com/OrekuD/react-native-gamekit/tree/main/apps/docs/content/docs)
and [Expo playground](https://github.com/OrekuD/react-native-gamekit/tree/main/apps/playground)
for complete examples.

## Current scope

The 0.2 release focuses on performant 2D foundations and the core systems
needed by small games. Physics simulation and 3D rendering aren't part of the
public package. Tilemaps, audio, haptics, events, particles, and versioned
storage are included.

## License

MIT

## Credits

The playground demo games use third-party asset packs (not part of the `rn-gamekit` package). Follow each pack's license terms if you redistribute them:

- [Mossy Cavern](https://maaot.itch.io/mossy-cavern) by maaot
- [Pixel Adventure 1](https://pixelfrog-assets.itch.io/pixel-adventure-1) by Pixel Frog
- [Brackeys' Platformer Bundle](https://brackeysgames.itch.io/brackeys-platformer-bundle) by Brackeys Games
- [Mixkit Game Sound Effects](https://mixkit.co/free-sound-effects/game/) — free SFX for the audio demos (see [mixkit.co/license](https://mixkit.co/license/))
