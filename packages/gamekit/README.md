# react-native-gamekit

A headless-first 2D game toolkit for React Native and Expo, built for mobile
and tablet.

> **Status: early runtime.** The package now includes a provisional fixed-step
> session, functional scenes, button input snapshots, and a Skia `GameView`.
> The API remains provisional until reference games validate it.

## Install

```sh
pnpm add react-native-gamekit
```

React, React Native, Expo, Skia, Reanimated, Gesture Handler, Worklets, Safe
Area Context, and required Expo modules are native peer dependencies. The
application owns them and must contain exactly one compatible copy of each.

## Define and run a game

```ts
import { createGameSession, defineGame, defineScene } from 'react-native-gamekit';

const definition = defineGame({
  viewport: {
    logicalSize: { width: 320, height: 180 },
    scale: 'fit',
    overflow: 'letterbox',
  },
  assets: [],
  input: {
    boost: { type: 'button' },
  },
  scenes: {
    play: defineScene({
      actions: ['boost'],
      create: () => ({ x: 0 }),
      update: ({ state, input, deltaSeconds }) => ({
        x: state.x + (input.button('boost').held ? 180 : 60) * deltaSeconds,
      }),
      snapshot: ({ state }) => ({ x: state.x }),
    }),
  },
  initialScene: 'play',
});

const game = createGameSession(definition);
game.start();
game.input.press('boost');
game.input.release('boost');
game.pause();
game.dispose();
```

The simulation advances at a fixed 60 Hz by default. Presentation frequency
is independent, so a 120 Hz iPad can draw more often without changing game
speed. Input is sampled once into an immutable frame for each simulation tick.

## Mount Skia

`GameView` is isolated in the React/native entry point so the main package can
still be imported by headless Node tests:

```ts
import { GameView } from 'react-native-gamekit/react';
```

It accepts an externally owned session and a stable Skia renderer component.
Presentation frames arrive through Reanimated shared values; React is not the
per-frame store. See the repository playground for the complete moving-circle
example.

## Current boundary

This slice intentionally does not include scene transitions, assets, ECS,
physics, gesture mappings, axes/pointers, audio, haptics, or generalized
viewport conversion.

## License

MIT
