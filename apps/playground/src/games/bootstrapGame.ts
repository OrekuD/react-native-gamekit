import { defineGame } from 'react-native-gamekit';

/**
 * The bootstrap game: the smallest valid `defineGame` configuration.
 *
 * It exists to prove that the playground can consume the local
 * `react-native-gamekit` package through the workspace protocol. No session,
 * rendering, or input runtime exists yet — `defineGame` only validates and
 * returns this definition.
 */
export const bootstrapGame = defineGame({
  viewport: {
    logicalSize: { width: 390, height: 844 },
    scale: 'fit',
    overflow: 'letterbox',
  },
  assets: [],
  input: {},
  scenes: {
    menu: {},
  },
  initialScene: 'menu',
});
