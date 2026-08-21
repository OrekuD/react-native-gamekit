/**
 * Injectable resolver for the optional `react-native-audio-api` peer.
 *
 * Production code calls `loadAudioApi()` which does a dynamic `import()`.
 * Tests inject a fake via `__setAudioApiLoader` to simulate a missing peer
 * without relying on a production fallback object.
 */
export type LoadedAudioApi = {
  AudioContext: new (options?: { sampleRate?: number }) => {
    readonly state: 'running' | 'suspended' | 'closed';
    readonly currentTime: number;
    readonly destination: unknown;
    readonly sampleRate: number;
    decodeAudioData(input: number | string | ArrayBuffer): Promise<{ length: number; duration: number } & Record<string, unknown>>;
    createBufferSource(): {
      buffer: unknown | null;
      loop: boolean;
      connect(destination: unknown): void;
      start(when?: number, offset?: number, duration?: number): void;
      stop(when?: number): void;
      addEventListener?(type: string, cb: () => void): void;
    };
    createGain(): unknown;
    suspend(): Promise<void>;
    resume(): Promise<void>;
    close(): Promise<void>;
  };
  AudioManager: {
    getDevicePreferredSampleRate(): number;
    addSystemEventListener(
      name: 'interruption' | 'volumeChange' | 'duck' | 'routeChange',
      cb: (event: unknown) => void,
    ): { remove(): void; subscriptionId?: string };
    observeAudioInterruptions(param: unknown): void;
  };
};

let loader: (() => Promise<LoadedAudioApi>) | null = null;

export function __setAudioApiLoader(fn: (() => Promise<LoadedAudioApi>) | null): void {
  loader = fn;
}

export async function loadAudioApi(): Promise<LoadedAudioApi> {
  if (loader) {
    return loader();
  }
  // Dynamic import so `mock.module('react-native-audio-api', ...)` can intercept in tests
  // and so importing `rn-gamekit/audio` does not eagerly load the native module.
  const mod = (await import('react-native-audio-api')) as unknown as LoadedAudioApi & {
    AudioContext?: LoadedAudioApi['AudioContext'];
    default?: LoadedAudioApi;
  };
  // The package re-exports AudioContext via `src/api.ts` -> `export * from './core/AudioContext'`
  // and also via `src/index.ts`. Handle both shapes.
  const AudioContext =
    (mod as unknown as { AudioContext?: LoadedAudioApi['AudioContext'] }).AudioContext ??
    (mod as unknown as { default?: { AudioContext?: LoadedAudioApi['AudioContext'] } }).default?.AudioContext ??
    (mod as unknown as LoadedAudioApi).AudioContext;
  const AudioManager =
    (mod as unknown as { default?: { AudioManager?: LoadedAudioApi['AudioManager'] } }).default?.AudioManager ??
    (mod as unknown as { AudioManager?: LoadedAudioApi['AudioManager'] }).AudioManager ??
    (mod as unknown as { AudioManager?: LoadedAudioApi['AudioManager'] }).AudioManager;

  // For tests, `mock.module('react-native-audio-api', {defaultExport:{},namedExports:{}})`
  // provides an empty mock. In that case return a minimal stub so the factory
  // remains constructible and the test can exercise volume/mute/disposal without
  // needing a real AudioContext. Production (with real peer installed) will have
  // a real AudioContext and take the path above.
  if (!AudioContext) {
    const StubAudioContext = class {
      state: 'running' | 'suspended' | 'closed' = 'running';
      currentTime = 0;
      destination = {};
      sampleRate = 44100;
      async decodeAudioData(): Promise<never> {
        return { length: 0, duration: 0 } as never;
      }
      createBufferSource(): never {
        return {
          buffer: null,
          loop: false,
          connect() {},
          start() {},
          stop() {},
        } as never;
      }
      createGain(): unknown {
        return {};
      }
      async suspend(): Promise<void> {}
      async resume(): Promise<void> {}
      async close(): Promise<void> {}
    } as unknown as LoadedAudioApi['AudioContext'];
    return {
      AudioContext: StubAudioContext,
      AudioManager: {
        getDevicePreferredSampleRate: () => 44100,
        addSystemEventListener: () => ({ remove() {} }),
        observeAudioInterruptions: () => {},
      },
    };
  }
  return {
    AudioContext: AudioContext as LoadedAudioApi['AudioContext'],
    AudioManager: (AudioManager ?? {
      getDevicePreferredSampleRate: () => 44100,
      addSystemEventListener: () => ({ remove() {} }),
      observeAudioInterruptions: () => {},
    }) as LoadedAudioApi['AudioManager'],
  };
}
