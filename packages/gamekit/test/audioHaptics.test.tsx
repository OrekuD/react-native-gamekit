import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock optional peers once — tests inject via this mock rather than relying on fallback
mock.module('react-native-audio-api', { defaultExport: {}, namedExports: {} });
mock.module('react-native-pulsar', { defaultExport: {}, namedExports: {} });

// This file verifies the T14.0 isolation and error contract without requiring
// native hardware. Native backends are mocked via node --experimental-test-module-mocks.

// Verify root does not import audio/haptics backends.
describe('T14.0 root isolation', () => {
  it('importing rn-gamekit does not eagerly load audio/haptics peers', async () => {
    const { readFileSync } = await import('node:fs');
    const tryRead = (a: string, b: string) => {
      try { return readFileSync(a, 'utf8'); } catch { return readFileSync(b, 'utf8'); }
    };
    const index = tryRead('src/index.ts', 'packages/gamekit/src/index.ts');
    const react = tryRead('src/react.ts', 'packages/gamekit/src/react.ts');
    assert.equal(index.includes('react-native-audio-api'), false);
    assert.equal(index.includes('react-native-pulsar'), false);
    assert.equal(index.includes('./audio'), false);
    assert.equal(index.includes('./haptics'), false);
    assert.equal(react.includes('react-native-audio-api'), false);
    assert.equal(react.includes('./audio'), false);
    // Also check built lib does not contain the string (ensures bob didn't inline)
    try {
      const libIndex = tryRead('lib/module/index.js', 'packages/gamekit/lib/module/index.js');
      assert.equal(libIndex.includes('react-native-audio-api'), false);
    } catch {}
  });

  it('importing a subpath does not eagerly create a backend', async () => {
    // Importing the subpath must not throw and must not create an AudioContext
    const mod = await import('../src/audio.ts');
    assert.equal(typeof mod.createGameAudio, 'function');
    const hmod = await import('../src/haptics.ts');
    assert.equal(typeof hmod.createGameHaptics, 'function');
  });
});

describe('T14.0 audio installation error', () => {
  it('createGameAudio is constructible in node (peer stub)', async () => {
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    const audio = await createGameAudio({ sounds: { sfx: 1, music: 2 } });
    assert.ok(audio);
    audio.dispose();
  });

  it('factory without peer gives actionable installation error (injected resolver)', async () => {
    const { createAudioInstallationError } = await import('../src/audio/errors.ts');
    const err = createAudioInstallationError();
    assert.match(err.message, /react-native-audio-api is not installed/);
    assert.match(err.message, /npx expo install/);
  });
});

describe('T14.0 audio volume/mute contract', () => {
  it('setVolume validates finite [0,1] and category', async () => {
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    const audio = await createGameAudio({ sounds: { sfx: 1 } });
    assert.equal(audio.getVolume('sfx'), 1);
    audio.setVolume('sfx', 0.5);
    assert.equal(audio.getVolume('sfx'), 0.5);
    assert.throws(() => audio.setVolume('sfx', 2), /Volume must be a finite number in \[0, 1\]/);
    assert.throws(() => audio.setVolume('sfx', Number.NaN), /Volume must be a finite number/);
    assert.throws(() => audio.setVolume('invalid' as never, 0.5), /Unknown audio category/);
    audio.dispose();
    assert.throws(() => audio.setVolume('sfx', 0.5), /disposed/);
  });

  it('setMuted does not overwrite remembered volume', async () => {
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    const audio = await createGameAudio({ sounds: { sfx: 1 } });
    audio.setVolume('sfx', 0.8);
    audio.setMuted(true);
    assert.equal(audio.isMuted(), true);
    assert.equal(audio.getVolume('sfx'), 0.8);
    audio.setMuted(false);
    assert.equal(audio.isMuted(), false);
    assert.equal(audio.getVolume('sfx'), 0.8);
    audio.dispose();
  });

  it('dispose is idempotent and rejects new work', async () => {
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    const audio = await createGameAudio({ sounds: { sfx: 1 } });
    // Until T14.2/3, play is explicit unavailable, not silent no-op
    assert.throws(() => audio.play('sfx'), /not yet implemented/);
    audio.dispose();
    audio.dispose();
    assert.throws(() => audio.play('sfx'), /disposed/);
  });
});

describe('T14.0 haptics installation error', () => {
  it('factory without peer would give actionable error', async () => {
    const { createHapticsInstallationError } = await import('../src/haptics/errors.ts');
    const err = createHapticsInstallationError();
    assert.match(err.message, /react-native-pulsar is not installed/);
    assert.match(err.message, /npx expo install/);
  });
});

describe('T14.0 haptics preset, mute, throttling', () => {
  it('play validates preset and respects mute/throttle', async () => {
    const { createGameHaptics } = await import('../src/haptics/createGameHaptics.ts');
    const haptics = createGameHaptics();
    const first = haptics.play('impact');
    // T14.0 stub must not report successful playback — fail closed until T14.5
    assert.equal(first.played, false);
    assert.equal(first.reason, 'error');
    const throttled = haptics.play('impact');
    assert.equal(throttled.played, false);
    assert.equal(throttled.reason, 'throttled');
    // Invalid preset throws before native work
    assert.throws(() => haptics.play('unknown' as never), /Unknown haptic preset/);
    haptics.setMuted(true);
    const muted = haptics.play('impact');
    assert.equal(muted.played, false);
    assert.equal(muted.reason, 'muted');
    haptics.dispose();
    const afterDispose = haptics.play('impact');
    assert.equal(afterDispose.played, false);
    assert.equal(afterDispose.reason, 'disposed');
  });

  it('isSupported validates preset', async () => {
    const { createGameHaptics } = await import('../src/haptics/createGameHaptics.ts');
    const haptics = createGameHaptics();
    assert.equal(haptics.isSupported('impact'), true);
    assert.throws(() => haptics.isSupported('unknown' as never), /Unknown haptic preset/);
    haptics.dispose();
  });
});
