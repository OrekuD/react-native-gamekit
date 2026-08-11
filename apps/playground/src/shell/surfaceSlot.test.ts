import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

import {
  loadingSlotFor,
  publishReadySlot,
  slotReadyWith,
  ownedSessions,
  type SurfaceSlot,
} from './surfaceSlot.ts';

// The slot functions treat sessions opaquely; stub sessions via the require
// shim so no game module is evaluated.
const require = createRequire(import.meta.url);
type SessionStub = { readonly marker: string };

function session(marker: string): SessionStub {
  return { marker };
}

const entry = {
  renderer: (() => null) as never,
  content: (() => null) as never,
};

function asSlot(slot: SurfaceSlot): SurfaceSlot {
  return slot as unknown as SurfaceSlot;
}

describe('surface slot transitions (RF3/RF1)', () => {
  it('a loading slot has no assets, no pointer, and a neutral session', () => {
    const neutral = session('neutral');
    const slot = asSlot(loadingSlotFor('sprite-field', neutral as never, entry));
    assert.equal(slot.status, 'loading');
    assert.equal(slot.pointer, false, 'pointer disabled while loading');
    assert.equal(slot.assets, undefined, 'no lease before readiness');
    assert.equal(slot.generation, 0);
    assert.deepEqual(ownedSessions(slot), [neutral]);
  });

  it('readiness publishes session + exact lease + pointer in one generation', () => {
    const neutral = session('neutral');
    const real = session('real');
    const loading = asSlot(loadingSlotFor('sprite-field', neutral as never, entry));
    const assets = { descriptor: 'the-exact-lease' };
    const ready = publishReadySlot(loading, real as never, assets);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.generation, 1);
    assert.equal(ready.session, real, 'the real session, not the neutral one');
    assert.equal(ready.assets, assets, 'the exact lease object');
    assert.equal(ready.pointer, true, 'pointer activates with readiness');
    assert.ok(slotReadyWith(ready, real as never), 'renderer/content/pointer agree on one session');
    assert.deepEqual(ready.retiring, [neutral], 'the neutral session retires');
    assert.deepEqual(ownedSessions(ready), [real, neutral]);
  });

  it('never pairs ready assets with the neutral session', () => {
    const neutral = session('neutral');
    const real = session('real');
    const loading = asSlot(loadingSlotFor('sprite-field', neutral as never, entry));
    const ready = publishReadySlot(loading, real as never, { descriptor: 'lease' });
    assert.ok(
      !(ready.status === 'ready' && (ready.session as unknown as SessionStub) === neutral),
      'the ready slot must reference the real session',
    );
  });

  it('rapid replacements keep the owner set bounded (retiring drains)', () => {
    let slot = asSlot(loadingSlotFor('game', session('s0') as never, entry));
    const real = [session('r1'), session('r2'), session('r3')];
    for (const r of real) {
      slot = publishReadySlot(slot, r as never, { descriptor: 'lease' });
    }
    assert.deepEqual(ownedSessions(slot).map((s) => (s as unknown as SessionStub).marker), [
      'r3',
      'r2',
      'r1',
      's0',
    ]);
    assert.equal(slot.retiring.length, 3, 'bounded retiring set: only the retired generations');
  });

  it('reopening never reuses the previous real session', () => {
    const first = publishReadySlot(
      asSlot(loadingSlotFor('sprite-field', session('neutral') as never, entry)),
      session('first-real') as never,
      { descriptor: 'lease' },
    );
    const reopen = asSlot(loadingSlotFor('sprite-field', session('fresh-neutral') as never, entry, [
      first.session,
      ...first.retiring,
    ]));
    assert.equal(reopen.status, 'loading');
    assert.notEqual(reopen.session, first.session, 'a fresh request never presents the old session');
  });
});
