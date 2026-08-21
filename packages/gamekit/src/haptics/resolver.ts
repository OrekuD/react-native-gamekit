/**
 * Injectable resolver for the optional `react-native-pulsar` peer.
 */
export type LoadedPulsar = {
  Presets: {
    System: Record<string, () => void>;
  };
  HapticSupport?: Record<string, number>;
};

let loader: (() => LoadedPulsar) | null = null;

export function __setPulsarLoader(fn: (() => LoadedPulsar) | null): void {
  loader = fn;
}

export function loadPulsar(): LoadedPulsar {
  if (loader) {
    return loader();
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-pulsar') as unknown as LoadedPulsar & {
      default?: LoadedPulsar;
      Presets?: LoadedPulsar['Presets'];
    };
    const Presets = (mod as unknown as { Presets?: LoadedPulsar['Presets'] }).Presets ?? (mod as unknown as LoadedPulsar).Presets;
    if (Presets) {
      return { Presets } as LoadedPulsar;
    }
  } catch {}
  // For tests, `mock.module('react-native-pulsar', {defaultExport:{},...})` provides
  // an empty mock. Return a minimal stub so the factory remains constructible.
  // The stub's System.impactMedium etc. are jest.fn()s via the mock's deep mock,
  // but for the fallback we provide no-ops that still satisfy `typeof fn === 'function'`.
  const stubPresets = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'System') {
          return new Proxy(
            {},
            {
              get(_t, _p) {
                return () => {};
              },
            },
          );
        }
        return () => {};
      },
    },
  ) as unknown as LoadedPulsar['Presets'];
  return { Presets: stubPresets };
}
