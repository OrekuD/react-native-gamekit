# React Native GameKit

A headless-first 2D game toolkit for React Native and Expo, built for phones
and tablets.

> **0.1 preview:** React Native GameKit is usable for small 2D games and
> prototypes, but its API may change before 1.0.

## What is included

- deterministic fixed-step game sessions;
- immutable functional scenes and scene transitions;
- semantic button and multi-touch-safe pointer input;
- phone, tablet, rotation, and split-view viewport mapping;
- React Native Skia rendering with Reanimated interpolation;
- typed local images, sprite sheets, animation clips, and asset loading;
- retained sprites and Atlas-backed sprite batching;
- a native-free root entry for headless tests.

## Requirements

Version 0.1 targets the Expo SDK 57 compatibility set:

| Package | Supported version |
| --- | --- |
| React Native | `~0.86.2` |
| React | `^19.2.3` |
| Expo | `~57.0.10` |
| React Native Skia | `2.11.0` |
| Gesture Handler | `~3.1.0` |
| Reanimated | `4.5.3` |
| Worklets | `0.10.3` |

Expo Go is not required or supported. Use an Expo development build and
`expo prebuild`, or a bare React Native app configured with Expo Modules.

## Installation

```sh
npm install rn-gamekit
npx expo install expo-asset @shopify/react-native-skia react-native-gesture-handler react-native-reanimated react-native-worklets
npx expo prebuild
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

`rn-gamekit` is one npm package. Paths like `rn-gamekit/collision2d` are package export subpaths — they are not separately versioned or published, they share the same `rn-gamekit` version, peer policy, and `exports` map, and they ship in the same tarball.

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

See the [repository documentation](https://github.com/OrekuD/rn-gamekit/tree/main/apps/docs/content/docs)
and [Expo playground](https://github.com/OrekuD/rn-gamekit/tree/main/apps/playground)
for complete examples.

See the [repository documentation](https://github.com/OrekuD/rn-gamekit/tree/main/apps/docs/content/docs)
and [Expo playground](https://github.com/OrekuD/rn-gamekit/tree/main/apps/playground)
for complete examples.

## Current scope

The 0.1 release focuses on performant 2D foundations. Physics and 3D rendering are not yet
part of the public package; tilemaps, audio, haptics, events, particles, and versioned storage are now included.

## License

MIT

## Credits

The playground demo games use third-party asset packs (not part of the `rn-gamekit` package). Follow each pack's license terms if you redistribute them:

- [Mossy Cavern](https://maaot.itch.io/mossy-cavern) by maaot
- [Pixel Adventure 1](https://pixelfrog-assets.itch.io/pixel-adventure-1) by Pixel Frog
- [Brackeys' Platformer Bundle](https://brackeysgames.itch.io/brackeys-platformer-bundle) by Brackeys Games
