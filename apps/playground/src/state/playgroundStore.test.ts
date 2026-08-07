import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPlaygroundStore } from './playgroundStore.ts';
import { PLAYGROUND_GAMES, type PlaygroundGameId } from '../catalog/games.ts';

function storeIds(): PlaygroundGameId[] {
  return PLAYGROUND_GAMES.map((game) => game.id);
}

describe('playground store contract', () => {
  it('starts on the home catalog with no game selected', () => {
    const store = createPlaygroundStore();
    assert.equal(store.getState().currentGameId, null);
  });

  it('opens each declared game', () => {
    const store = createPlaygroundStore();
    for (const id of storeIds()) {
      store.getState().openGame(id);
      assert.equal(store.getState().currentGameId, id);
    }
  });

  it('treats repeated selection of the current game as idempotent', () => {
    const store = createPlaygroundStore();
    store.getState().openGame('brick-breaker');
    const first = store.getState();
    store.getState().openGame('brick-breaker');
    assert.equal(store.getState().currentGameId, 'brick-breaker');
    assert.equal(store.getState(), first, 'no-op selection keeps the same state object');
  });

  it('switches the selected id', () => {
    const store = createPlaygroundStore();
    store.getState().openGame('brick-breaker');
    store.getState().openGame('bootstrap');
    assert.equal(store.getState().currentGameId, 'bootstrap');
  });

  it('treats close as idempotent and returns to the catalog', () => {
    const store = createPlaygroundStore();
    store.getState().closeGame();
    assert.equal(store.getState().currentGameId, null);
    const home = store.getState();
    store.getState().closeGame();
    assert.equal(store.getState(), home, 'closing while home keeps the same state object');

    store.getState().openGame('bootstrap');
    store.getState().closeGame();
    assert.equal(store.getState().currentGameId, null);
  });

  it('keeps store instances fully isolated', () => {
    const first = createPlaygroundStore();
    const second = createPlaygroundStore();
    first.getState().openGame('brick-breaker');
    assert.equal(first.getState().currentGameId, 'brick-breaker');
    assert.equal(second.getState().currentGameId, null);
  });

  it('fails clearly when an untyped caller passes an invalid id', () => {
    const store = createPlaygroundStore();
    assert.throws(() => store.getState().openGame('mystery-game' as PlaygroundGameId), {
      message: /Unknown playground game: mystery-game/,
    });
    assert.equal(store.getState().currentGameId, null);
  });

  it('stores only shell data and actions, never gameplay objects', () => {
    const store = createPlaygroundStore();
    const state = store.getState();
    assert.deepEqual(Object.keys(state).sort(), ['closeGame', 'currentGameId', 'openGame']);
    assert.equal(state.currentGameId, null);
    assert.equal(typeof state.openGame, 'function');
    assert.equal(typeof state.closeGame, 'function');
    // A session-like object must never appear anywhere in the snapshot.
    assert.equal('session' in state, false);
    assert.equal('frame' in state, false);
    assert.equal('pointer' in state, false);
  });

  it('notifies subscribers only when the selection actually changes', () => {
    const store = createPlaygroundStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    store.getState().openGame('brick-breaker');
    assert.equal(notifications, 1);
    store.getState().openGame('brick-breaker');
    assert.equal(notifications, 1, 'idempotent selection does not notify');
    store.getState().closeGame();
    assert.equal(notifications, 2);
    store.getState().closeGame();
    assert.equal(notifications, 2, 'idempotent close does not notify');
  });
});
