/**
 * Injectable resolver for the optional `react-native-pulsar` peer
 * (GS-HAPTICS-02).
 *
 * The adapter surface is the package's PUBLIC entry — `Presets`,
 * `Settings.getHapticsSupportLevel()`, and the `HapticSupport` enum —
 * verified against installed react-native-pulsar 1.7.0. No TurboModule
 * digging, no private root functions: capability queries go through the
 * single Settings adapter, and a missing method fails closed downstream.
 */
export type LoadedPulsar = {
  Presets: {
    System: Record<string, () => void>;
  };
  Settings: {
    getHapticsSupportLevel(): number;
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
    Settings?: LoadedPulsar['Settings'];
    HapticSupport?: Record<string, number>;
  };
  const Presets =
    (mod as unknown as { Presets?: LoadedPulsar['Presets'] }).Presets ??
    (mod as unknown as LoadedPulsar).Presets;
  if (!Presets) {
    throw new Error('Presets not found in react-native-pulsar — linking may have failed');
  }
  // Resolve public Settings + HapticSupport from the package root (not deep imports).
  const Settings =
    (mod as unknown as { Settings?: LoadedPulsar['Settings'] }).Settings ??
    (mod as unknown as { default?: { Settings?: LoadedPulsar['Settings'] } }).default?.Settings ??
    (mod as unknown as LoadedPulsar).Settings;
  const HapticSupport =
    (mod as unknown as { HapticSupport?: Record<string, number> }).HapticSupport ??
    (mod as unknown as { default?: { HapticSupport?: Record<string, number> } }).default?.HapticSupport ??
    (mod as unknown as LoadedPulsar).HapticSupport;
  return {
    Presets,
    Settings: Settings as LoadedPulsar['Settings'],
    HapticSupport,
  } as LoadedPulsar;
}
