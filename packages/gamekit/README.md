# react-native-gamekit

A headless-first 2D game toolkit for React Native and Expo, built for mobile and tablet.

> **Status: bootstrap.** This package currently exposes only the provisional
> `defineGame` definition contract. The runtime (session, scenes, rendering,
> input) is implemented in later tasks. The API shape is provisional until
> reference games validate it.

## Install

```sh
pnpm add react-native-gamekit
```

This package has no runtime dependencies of its own. It declares `react`,
`react-native`, and `expo` as peer dependencies; your application must contain
exactly one compatible copy of every native peer.

## Usage

```ts
import { defineGame } from 'react-native-gamekit';

const game = defineGame({
  viewport: {
    logicalSize: { width: 390, height: 844 },
    scale: 'fit',
    overflow: 'letterbox',
  },
  assets: [],
  input: {},
  scenes: {
    menu: {},
    level1: {},
  },
  initialScene: 'menu',
});
```

`defineGame` validates the definition at the type level (scene names are
inferred so `initialScene` must be one of the `scenes` keys) and preserves and
returns the supplied definition. It does not start a scheduler, allocate a
session, or load assets.

## License

MIT
