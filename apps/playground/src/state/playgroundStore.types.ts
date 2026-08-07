/**
 * Compile-time contract for the playground shell store: `openGame` accepts
 * only canonical ids, `currentGameId` is the canonical union or null, and the
 * store never carries gameplay objects.
 */
import type { PlaygroundState } from './playgroundStore';
import { createPlaygroundStore } from './playgroundStore';
import type { PlaygroundGameId } from '../catalog/games';

const store = createPlaygroundStore();
store.getState().openGame('brick-breaker');
store.getState().openGame('bootstrap');
// @ts-expect-error openGame accepts only canonical playground game ids
store.getState().openGame('mystery-game');
// @ts-expect-error currentGameId is the canonical union or null
store.getState().currentGameId satisfies 'mystery-game' | null;
store.getState().currentGameId satisfies PlaygroundGameId | null;

declare const state: PlaygroundState;
state.openGame satisfies (id: PlaygroundGameId) => void;
// @ts-expect-error the store must never hold a game session
state.session satisfies unknown;
// @ts-expect-error the store must never hold a render frame
state.frame satisfies unknown;
