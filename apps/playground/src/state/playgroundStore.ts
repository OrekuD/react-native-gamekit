import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { PLAYGROUND_GAME_IDS, type PlaygroundGameId } from '../catalog/games.ts';

/**
 * Low-frequency playground shell state.
 *
 * This store holds exactly one selected game id (or `null` for the catalog)
 * and the two actions that change it. It never holds a `GameSession`, render
 * frame, pointer position, shared value, Skia object, or React component.
 */
export interface PlaygroundState {
  /** The selected game, or `null` when the home catalog is showing. */
  readonly currentGameId: PlaygroundGameId | null;
  /** Select a known game. Selecting the current game is an idempotent no-op. */
  readonly openGame: (id: PlaygroundGameId) => void;
  /** Return to the catalog. Idempotent. */
  readonly closeGame: () => void;
}

/**
 * Create a fresh isolated store.
 *
 * Tests always create their own store rather than resetting shared module
 * state.
 */
export function createPlaygroundStore(): StoreApi<PlaygroundState> {
  return createStore<PlaygroundState>()((set) => ({
    currentGameId: null,
    openGame: (id) => {
      if (!PLAYGROUND_GAME_IDS.includes(id)) {
        throw new Error(`Unknown playground game: ${String(id)}`);
      }
      set((state) => (state.currentGameId === id ? state : { currentGameId: id }));
    },
    closeGame: () => {
      set((state) => (state.currentGameId === null ? state : { currentGameId: null }));
    },
  }));
}

/** The app-wide singleton store. */
export const playgroundStore = createPlaygroundStore();

/**
 * Read the singleton store through a narrow selector.
 *
 * Components re-render only when the selected value changes.
 */
export function usePlaygroundStore<T>(selector: (state: PlaygroundState) => T): T {
  return useStore(playgroundStore, selector);
}
