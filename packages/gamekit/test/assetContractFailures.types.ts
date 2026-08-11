/**
 * Compile-time fixture: expected contract violations.
 *
 * Type-checked by `pnpm typecheck`. Every `@ts-expect-error` below documents
 * a violation the type layer must reject. If any expectation stops erroring,
 * the contract has loosened and this fixture must be updated (or the
 * regression fixed). The violations cover:
 *
 * - unknown group and clip names;
 * - access to an unknown asset/frame property on the typed manifest;
 * - retrieval through the wrong manifest or by a duplicated string key;
 * - string/URL sources, which are rejected in Task 7;
 * - the old placeholder `assets: [...]` array form, which is replaced.
 *
 * Reserved-separator keys, invalid rectangles, empty clips, and duration
 * ranges are runtime validations (T7.2) and are intentionally absent here.
 */
import { defineAssets, defineGame, defineScene, image, spriteSheet, startSpriteAnimation } from '../src/index';
import { useGameAssets } from '../src/react';

import { gameAssets, otherAssets } from './assetsManifest.types';

const handle = require('./assets/logo.png') as number;

// --- Unknown group names ----------------------------------------------------

// @ts-expect-error unknown group in the loading selection
useGameAssets(gameAssets, { groups: ['boot', 'missing'] });

// --- Unknown asset / frame properties ---------------------------------------

// @ts-expect-error an unknown asset property on a known group is not defined
void gameAssets.boot.missing;

// @ts-expect-error an unknown frame property on a known sheet is not defined
void gameAssets.gameplay.player.frames['missing-frame'];

// --- Unknown clip names ------------------------------------------------------

spriteSheet(handle, {
  frames: {
    'idle-0': { x: 0, y: 0, width: 32, height: 32 },
  },
  animations: {
    idle: {
      // @ts-expect-error a clip frame must reference a declared frame name
      frames: ['idle-0', 'missing-frame'],
      frameDurationMs: 140,
      mode: 'loop',
    },
  },
});

spriteSheet(handle, {
  frames: {
    'idle-0': { x: 0, y: 0, width: 32, height: 32 },
  },
  animations: {
    idle: {
      frames: ['idle-0'],
      frameDurationMs: 140,
      // @ts-expect-error animation mode is the discriminated 'loop' | 'once'
      mode: 'ping-pong',
    },
  },
});

startSpriteAnimation(
  gameAssets.gameplay.player,
  // @ts-expect-error the clip must exist on the descriptor
  'dash',
);

// --- String/URL sources are rejected ----------------------------------------

// @ts-expect-error a remote URL string must not become a network fetch
image('https://example.com/logo.png');

// @ts-expect-error a file-path string is not a static module handle
image('./assets/logo.png');

// @ts-expect-error spriteSheet sources are static module handles only
spriteSheet('https://example.com/player.png', {
  frames: {
    'idle-0': { x: 0, y: 0, width: 32, height: 32 },
  },
  animations: {},
});

// --- Retrieval by descriptor reference only ---------------------------------

declare const loaded: { get(descriptor: unknown): unknown };

// @ts-expect-error retrieving through the wrong manifest is rejected
loaded.get(otherAssets.elsewhere.logo);

// @ts-expect-error a duplicated string key is never a valid lookup
loaded.get('gameplay.player');

// --- The old placeholder array form is replaced ------------------------------

defineGame({
  viewport: { logicalSize: { width: 320, height: 480 }, mode: 'fit' } as const,
  // @ts-expect-error the placeholder `assets: [...]` array is replaced by the manifest
  assets: [{ id: 'local-image', source: 42 }],
  input: {},
  scenes: {
    play: defineScene({
      actions: [],
      create: () => ({}),
      update: ({ state }) => state,
      snapshot: () => null,
    }),
  },
  initialScene: 'play',
});
