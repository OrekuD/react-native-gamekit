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

`rn-gamekit` contains the headless definition, session, viewport,
asset-manifest, and animation APIs. `rn-gamekit/react` contains the
Skia renderer, native pointer adapter, asset loader, sprites, and sprite
batching. `rn-gamekit/testing` contains deterministic frame drivers
for Node tests.

See the [repository documentation](https://github.com/OrekuD/rn-gamekit/tree/main/apps/docs/content/docs)
and [Expo playground](https://github.com/OrekuD/rn-gamekit/tree/main/apps/playground)
for complete examples.

## Current scope

The 0.1 release focuses on performant 2D foundations. Physics, tilemaps,
audio, haptics, game-level navigation, save data, and 3D rendering are not yet
part of the public package.

## License

MIT
