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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-pulsar') as unknown as LoadedPulsar & {
    default?: LoadedPulsar;
    Presets?: LoadedPulsar['Presets'];
  };
  const Presets = (mod as unknown as { Presets?: LoadedPulsar['Presets'] }).Presets ?? (mod as unknown as LoadedPulsar).Presets;
  if (!Presets) {
    throw new Error('Presets not found in react-native-pulsar — linking may have failed');
  }
  return { Presets } as LoadedPulsar;
}
