/**
 * Injectable resolver for the optional `react-native-pulsar` peer.
 */
export type LoadedPulsar = {
  Presets: {
    System: Record<string, () => void>;
  };
  HapticSupport?: Record<string, number>;
  Pulsar_hapticSupport?: () => number;
  getHapticSupport?: () => number;
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
    HapticSupport?: Record<string, number>;
    Pulsar_hapticSupport?: () => number;
  };
  const Presets = (mod as unknown as { Presets?: LoadedPulsar['Presets'] }).Presets ?? (mod as unknown as LoadedPulsar).Presets;
  if (!Presets) {
    throw new Error('Presets not found in react-native-pulsar — linking may have failed');
  }
  // Try to resolve HapticSupport enum and capability function
  // The TurboModule is available via the same package's NativeRNPulsar
  let HapticSupport: Record<string, number> | undefined;
  let Pulsar_hapticSupport: (() => number) | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativeMod = require('react-native-pulsar/src/NativeRNPulsar') as unknown as { HapticSupport?: Record<string, number>; default?: { HapticSupport?: Record<string, number>; Pulsar_hapticSupport?: ()=>number } };
    HapticSupport = (nativeMod as unknown as { HapticSupport?: Record<string, number> }).HapticSupport ?? (nativeMod as unknown as { default?: { HapticSupport?: Record<string, number> } }).default?.HapticSupport;
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const turbo = require('react-native').TurboModuleRegistry as unknown as { getEnforcing?: (name:string)=>{ Pulsar_hapticSupport?: ()=>number } };
    const spec = turbo?.getEnforcing?.('RNPulsar') as unknown as { Pulsar_hapticSupport?: ()=>number };
    if (spec?.Pulsar_hapticSupport) Pulsar_hapticSupport = spec.Pulsar_hapticSupport.bind(spec);
  } catch {}
  // Also check mod itself
  if (!Pulsar_hapticSupport) {
    const maybe = (mod as unknown as { Pulsar_hapticSupport?: ()=>number }).Pulsar_hapticSupport;
    if (typeof maybe === 'function') Pulsar_hapticSupport = maybe;
  }
  return {
    Presets,
    HapticSupport: HapticSupport ?? (mod as unknown as LoadedPulsar).HapticSupport,
    Pulsar_hapticSupport,
    getHapticSupport: Pulsar_hapticSupport ? () => Pulsar_hapticSupport!() : undefined,
  } as LoadedPulsar;
}
