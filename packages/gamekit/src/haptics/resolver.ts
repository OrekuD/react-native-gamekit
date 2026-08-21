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
  // Resolve public HapticSupport enum from package root (not deep import)
  const HapticSupport =
    (mod as unknown as { HapticSupport?: Record<string, number> }).HapticSupport ??
    (mod as unknown as { default?: { HapticSupport?: Record<string, number> } }).default?.HapticSupport ??
    (mod as unknown as LoadedPulsar).HapticSupport;

  // Resolve capability function from verified native adapter (TurboModule)
  let Pulsar_hapticSupport: (() => number) | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const turbo = require('react-native').TurboModuleRegistry as unknown as { getEnforcing?: (name:string)=>{ Pulsar_hapticSupport?: ()=>number } };
    const spec = turbo?.getEnforcing?.('RNPulsar') as unknown as { Pulsar_hapticSupport?: ()=>number } | undefined;
    if (spec?.Pulsar_hapticSupport) Pulsar_hapticSupport = spec.Pulsar_hapticSupport.bind(spec);
  } catch {}
  if (!Pulsar_hapticSupport) {
    const maybe = (mod as unknown as { Pulsar_hapticSupport?: ()=>number }).Pulsar_hapticSupport;
    if (typeof maybe === 'function') Pulsar_hapticSupport = maybe;
    else {
      const maybeDefault = (mod as unknown as { default?: { Pulsar_hapticSupport?: ()=>number } }).default?.Pulsar_hapticSupport;
      if (typeof maybeDefault === 'function') Pulsar_hapticSupport = maybeDefault;
    }
  }
  return {
    Presets,
    HapticSupport,
    Pulsar_hapticSupport,
    getHapticSupport: Pulsar_hapticSupport ? () => Pulsar_hapticSupport!() : undefined,
  } as LoadedPulsar;
}
