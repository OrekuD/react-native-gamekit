import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock optional peers once — tests inject via this mock rather than relying on fallback
mock.module('react-native-audio-api', {
  defaultExport: {
    AudioContext: class {
      state: 'running' | 'suspended' | 'closed' = 'running';
      currentTime = 0;
      destination = {};
      sampleRate = 44100;
      async decodeAudioData() { return { length: 0, duration: 0 } as never; }
      createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {}, addEventListener() {} } as never; }
      createGain() { return {} as never; }
      async suspend() {}
      async resume() {}
      async close() {}
    },
    AudioManager: {
      getDevicePreferredSampleRate: () => 44100,
      addSystemEventListener: () => ({ remove() {} }),
      observeAudioInterruptions: () => {},
    },
  },
  namedExports: {
    AudioContext: class {
      state: 'running' | 'suspended' | 'closed' = 'running';
      currentTime = 0;
      destination = {};
      sampleRate = 44100;
      async decodeAudioData() { return { length: 0, duration: 0 } as never; }
      createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {}, addEventListener() {} } as never; }
      createGain() { return {} as never; }
      async suspend() {}
      async resume() {}
      async close() {}
    },
    AudioManager: {
      getDevicePreferredSampleRate: () => 44100,
      addSystemEventListener: () => ({ remove() {} }),
      observeAudioInterruptions: () => {},
    },
  },
});
mock.module('react-native-pulsar', {
  defaultExport: {
    Presets: {
      System: {
        impactLight: () => {},
        impactMedium: () => {},
        impactHeavy: () => {},
        selection: () => {},
        notificationSuccess: () => {},
        notificationWarning: () => {},
        notificationError: () => {},
      },
    },
  },
  namedExports: {
    Presets: {
      System: {
        impactLight: () => {},
        impactMedium: () => {},
        impactHeavy: () => {},
        selection: () => {},
        notificationSuccess: () => {},
        notificationWarning: () => {},
        notificationError: () => {},
      },
    },
  },
});
// expo-asset is not mocked via mock.module — production code resolves via
// explicit asset-input seam (__setAssetInputLoader). This keeps file:// and
// numeric IDs from being treated as test signals.

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
  it('createGameAudio is constructible in node (peer mocked)', async () => {
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    const audio = await createGameAudio({ sounds: { sfx: 1, music: 2 } });
    assert.ok(audio);
    audio.dispose();
  });

  it('factory without peer gives actionable installation error (via injectable seam)', async () => {
    const { __setAudioApiLoader } = await import('../src/audio/resolver.ts');
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    // Inject a loader that simulates missing peer
    __setAudioApiLoader(async () => {
      throw new Error('missing');
    });
    await assert.rejects(
      () => createGameAudio({ sounds: { sfx: 1 } }),
      (err: unknown) => {
        assert.match((err as Error).message, /react-native-audio-api is not installed/);
        assert.match((err as Error).message, /npx expo install/);
        return true;
      },
    );
    // Restore
    __setAudioApiLoader(null);
    // Verify it works again with mock
    const audio = await createGameAudio({ sounds: { sfx: 1 } });
    assert.ok(audio);
    audio.dispose();
  });

  it('default resolver with malformed module shape fails closed', async () => {
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    // Mock the peer to a malformed shape (no AudioContext) via the resolver seam
    const { __setAudioApiLoader } = await import('../src/audio/resolver.ts');
    __setAudioApiLoader(async () => ({} as never));
    await assert.rejects(
      () => createGameAudio({ sounds: { sfx: 1 } }),
      (err: unknown) => {
        assert.match((err as Error).message, /react-native-audio-api is not installed/);
        return true;
      },
    );
    __setAudioApiLoader(null);
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
    // With real implementation, play is fire-and-forget and does not throw when not disposed
    assert.doesNotThrow(() => audio.play('sfx'));
    audio.dispose();
    audio.dispose();
    assert.throws(() => audio.play('sfx'), /disposed/);
  });
});

describe('T14.0 haptics installation error', () => {
  it('factory without peer gives actionable error via seam', async () => {
    const { __setPulsarLoader } = await import('../src/haptics/resolver.ts');
    const { createGameHaptics } = await import('../src/haptics/createGameHaptics.ts');
    __setPulsarLoader(() => {
      throw new Error('missing');
    });
    assert.throws(
      () => createGameHaptics(),
      (err: unknown) => {
        assert.match((err as Error).message, /react-native-pulsar is not installed/);
        assert.match((err as Error).message, /npx expo install/);
        return true;
      },
    );
    __setPulsarLoader(null);
    // Verify it works again with mock
    const haptics = createGameHaptics();
    assert.ok(haptics);
    haptics.dispose();
  });

  it('default resolver with malformed module shape fails closed', async () => {
    const { __setPulsarLoader } = await import('../src/haptics/resolver.ts');
    const { createGameHaptics } = await import('../src/haptics/createGameHaptics.ts');
    __setPulsarLoader(() => ({} as never));
    assert.throws(
      () => createGameHaptics(),
      (err: unknown) => {
        assert.match((err as Error).message, /react-native-pulsar is not installed/);
        return true;
      },
    );
    __setPulsarLoader(null);
  });
});

describe('T14.0 haptics preset, mute, throttling', () => {
  it('play validates preset and respects mute/throttle', async () => {
    const { createGameHaptics } = await import('../src/haptics/createGameHaptics.ts');
    const haptics = createGameHaptics();
    const first = haptics.play('impact');
    // With real Presets.System.impactMedium (mocked as jest.fn), first play succeeds
    assert.equal(first.played, true);
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
describe('T14-RF3 asset loader seam and file:// handling', () => {
  it('production-shaped file:// asset reaches decodeAudioData via explicit seam', async () => {
    const { __setAudioApiLoader } = await import('../src/audio/resolver.ts');
    const { __setAssetInputLoader } = await import('../src/audio/createGameAudio.ts');
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    const decodedInputs: unknown[] = [];
    __setAudioApiLoader(async () => ({
      AudioContext: class {
        state: 'running' | 'suspended' | 'closed' = 'running';
        currentTime = 0;
        destination = {};
        sampleRate = 44100;
        async decodeAudioData(input: unknown) {
          decodedInputs.push(input);
          return { length: 1, duration: 0.01 } as never;
        }
        createBufferSource() {
          return { buffer: null, loop: false, connect() {}, start() {}, stop() {}, addEventListener() {} } as never;
        }
        createGain() { return {} as never; }
        async suspend() {}
        async resume() {}
        async close() {}
      },
      AudioManager: {
        getDevicePreferredSampleRate: () => 44100,
        addSystemEventListener: () => ({ remove() {} }),
        observeAudioInterruptions: () => {},
      },
    } as never));
    __setAssetInputLoader(async (assetId: number) => `file:///tmp/production-${assetId}.wav`);
    const audio = await createGameAudio({ sounds: { sfx: 42, music: 7 } });
    // Both file:// URIs must have been passed directly to decodeAudioData, not swallowed as dummy buffers
    assert.equal(decodedInputs.length, 2);
    assert.ok(decodedInputs.includes('file:///tmp/production-42.wav'));
    assert.ok(decodedInputs.includes('file:///tmp/production-7.wav'));
    audio.dispose();
    __setAssetInputLoader(null);
    __setAudioApiLoader(null);
  });

  it('numeric asset IDs are not treated as test signals and still decode via seam', async () => {
    const { __setAudioApiLoader } = await import('../src/audio/resolver.ts');
    const { __setAssetInputLoader } = await import('../src/audio/createGameAudio.ts');
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    const decodedInputs: unknown[] = [];
    __setAudioApiLoader(async () => ({
      AudioContext: class {
        state: 'running' | 'suspended' | 'closed' = 'running';
        currentTime = 0;
        destination = {};
        sampleRate = 44100;
        async decodeAudioData(input: unknown) {
          decodedInputs.push(input);
          return { length: 2, duration: 0.02 } as never;
        }
        createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {}, addEventListener() {} } as never; }
        createGain() { return {} as never; }
        async suspend() {}
        async resume() {}
        async close() {}
      },
      AudioManager: {
        getDevicePreferredSampleRate: () => 44100,
        addSystemEventListener: () => ({ remove() {} }),
        observeAudioInterruptions: () => {},
      },
    } as never));
    // Simulate Metro small numeric IDs (1, 2) but via explicit seam — must still reach decoder
    __setAssetInputLoader(async (assetId: number) => assetId);
    const audio = await createGameAudio({ sounds: { sfx: 1, music: 2 } });
    assert.equal(decodedInputs.length, 2);
    assert.ok(decodedInputs.includes(1));
    assert.ok(decodedInputs.includes(2));
    audio.dispose();
    __setAssetInputLoader(null);
    __setAudioApiLoader(null);
  });

  it('resolution and decode failures reject createGameAudio (no dummy fallback)', async () => {
    const { __setAudioApiLoader } = await import('../src/audio/resolver.ts');
    const { __setAssetInputLoader } = await import('../src/audio/createGameAudio.ts');
    const { createGameAudio } = await import('../src/audio/createGameAudio.ts');
    // Resolver success but loader throws
    __setAudioApiLoader(async () => ({
      AudioContext: class {
        state: 'running' | 'suspended' | 'closed' = 'running';
        currentTime = 0;
        destination = {};
        sampleRate = 44100;
        async decodeAudioData() { return { length: 0, duration: 0 } as never; }
        createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {}, addEventListener() {} } as never; }
        createGain() { return {} as never; }
        async suspend() {}
        async resume() {}
        async close() {}
      },
      AudioManager: {
        getDevicePreferredSampleRate: () => 44100,
        addSystemEventListener: () => ({ remove() {} }),
        observeAudioInterruptions: () => {},
      },
    } as never));
    __setAssetInputLoader(async () => { throw new Error('resolve boom'); });
    await assert.rejects(() => createGameAudio({ sounds: { sfx: 1 } }), /resolve boom/);
    // Loader succeeds but decode fails
    __setAssetInputLoader(async (id: number) => `file:///tmp/fail-${id}.wav`);
    __setAudioApiLoader(async () => ({
      AudioContext: class {
        state: 'running' | 'suspended' | 'closed' = 'running';
        currentTime = 0;
        destination = {};
        sampleRate = 44100;
        async decodeAudioData() { throw new Error('decode boom'); }
        createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {}, addEventListener() {} } as never; }
        createGain() { return {} as never; }
        async suspend() {}
        async resume() {}
        async close() {}
      },
      AudioManager: {
        getDevicePreferredSampleRate: () => 44100,
        addSystemEventListener: () => ({ remove() {} }),
        observeAudioInterruptions: () => {},
      },
    } as never));
    await assert.rejects(() => createGameAudio({ sounds: { sfx: 1 } }), /Failed to decode audio asset "sfx": decode boom/);
    __setAssetInputLoader(null);
    __setAudioApiLoader(null);
  });
});

