/**
 * GS-SCENE-03 — the supported snapshot domain is enforced at publication.
 *
 * Snapshots must contain only plain records, arrays, and scalar values.
 * Functions, symbols, bigints, and class instances (Map, Set, Date, custom
 * classes, …) fail with an actionable path before publication — never a
 * half-published commit. Cycles, structural sharing, and ownership transfer
 * (state references frozen into the snapshot) keep working.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDeepFreeze, SnapshotDomainError } from '../src/core/session/deepFreeze';
import { createGameSessionWithDriver } from '../src/core/session/createGameSession.ts';
import { defineGame, defineScene } from '../src/index.ts';
import { ManualFrameDriver } from './helpers/ManualFrameDriver.ts';

const viewport = {
  logicalSize: { width: 320, height: 180 },
  mode: 'fit',
} as const;

describe('GS-SCENE-03 snapshot domain', () => {
  it('rejects a Map value with its path', () => {
    const freezer = createDeepFreeze();
    const thrown = ((): unknown => {
      try {
        freezer({ bricks: [new Map([['a', 1]])] });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    assert.ok(thrown instanceof SnapshotDomainError);
    assert.equal(thrown.path, 'bricks[0]');
    assert.match(thrown.message, /Map instances are not part of the snapshot domain/);
  });

  it('rejects function, symbol, bigint, and class-instance values with paths', () => {
    const freezer = createDeepFreeze();
    class Enemy {
      hp = 3;
    }
    const cases: { readonly value: unknown; readonly path: string; readonly detail: RegExp }[] = [
      { value: { fn: () => 1 }, path: 'fn', detail: /functions are not part of the snapshot domain/ },
      { value: [Symbol('tag')], path: '[0]', detail: /symbols are not part of the snapshot domain/ },
      { value: { big: 10n }, path: 'big', detail: /bigints are not part of the snapshot domain/ },
      { value: { enemy: new Enemy() }, path: 'enemy', detail: /Enemy instances are not part of the snapshot domain/ },
      { value: { when: new Date(0) }, path: 'when', detail: /Date instances are not part of the snapshot domain/ },
      { value: { nested: { deep: [new Set([1])] } }, path: 'nested.deep[0]', detail: /Set instances/ },
    ];
    for (const { value, path, detail } of cases) {
      const thrown: unknown = (() => {
        try {
          freezer(value);
        } catch (error) {
          return error;
        }
        return undefined;
      })();
      assert.ok(thrown instanceof SnapshotDomainError, `expected a domain error for ${path}`);
      assert.equal((thrown as SnapshotDomainError).path, path);
      assert.match((thrown as SnapshotDomainError).message, detail);
    }
  });

  it('still accepts plain records, arrays, scalars, cycles, and shared subtrees', () => {
    const freezer = createDeepFreeze();
    const shared = { x: 1 };
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    const frame = freezer({
      count: 3,
      label: 'level',
      active: true,
      missing: null,
      absent: undefined,
      tags: ['a', 'b'],
      shared,
      again: shared,
      cyclic,
    });
    assert.equal(Object.isFrozen(frame), true);
    assert.equal(frame.again, frame.shared, 'structural sharing is preserved');
    assert.equal(
      (frame.cyclic as Record<string, unknown>).self,
      frame.cyclic,
      'cycles are preserved',
    );
  });

  it('a state reference returned by the snapshot transfers into immutable snapshot ownership', () => {
    const driver = new ManualFrameDriver();
    const items = [{ x: 1 }, { x: 2 }];
    const game = defineGame({
      viewport,
      input: {},
      scenes: {
        main: defineScene({
          actions: [],
          create: () => ({ items }),
          update: ({ state }: { state: { readonly items: { readonly x: number }[] } }) => ({
            items: state.items,
          }),
          snapshot: ({ state }: { state: { readonly items: { readonly x: number }[] } }) => ({
            items: state.items,
          }),
        }),
      },
      initialScene: 'main',
    });
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.start();
    driver.fireNext(0);
    driver.fireNext(16);
    const frame = session.getRenderFrame().current as unknown as {
      readonly items: { readonly x: number }[];
    };
    assert.equal(frame.items, items, 'no copy: the snapshot shares the state reference');
    assert.equal(Object.isFrozen(items), true, 'ownership transferred into the immutable snapshot');
    assert.equal(Object.isFrozen(items[0]), true);
    session.dispose();
  });

  it('an unsupported snapshot fails before publication: no tick advance, no commit, intact frame', () => {
    const driver = new ManualFrameDriver();
    let commits = 0;
    let failSnapshots = false;
    const game = defineGame({
      viewport,
      input: {},
      scenes: {
        main: defineScene({
          actions: [],
          create: () => ({ count: 0 }),
          update: ({ state }: { state: { readonly count: number } }) => ({
            count: state.count + 1,
          }),
          snapshot: ({ state }: { state: { readonly count: number } }) =>
            failSnapshots
              ? { count: state.count, lookup: new Map<string, number>() }
              : { count: state.count },
        }),
      },
      initialScene: 'main',
    });
    const session = createGameSessionWithDriver(game, { frameDriver: driver, fixedStepMs: 10 });
    session.addCommitListener(() => {
      commits += 1;
    });
    session.start();
    driver.fireNext(0);
    const baselineTick = session.getRenderFrame().tick;
    const baselineCommits = commits;
    failSnapshots = true;
    assert.throws(
      () => driver.fireNext(16),
      (error: unknown) =>
        error instanceof SnapshotDomainError && error.path === 'lookup',
      'the domain error carries the actionable path',
    );
    assert.equal(session.getRenderFrame().tick, baselineTick, 'no tick advanced');
    assert.equal(commits, baselineCommits, 'no commit published');
    assert.equal(session.status, 'paused', 'the honest terminal policy applies');
    session.dispose();
  });
});
