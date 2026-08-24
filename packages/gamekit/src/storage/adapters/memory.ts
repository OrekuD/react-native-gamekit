import type { GameStorageAdapter } from '../types';

/**
 * In-memory adapter for tests and apps that own storage elsewhere.
 * Each instance owns its map.
 */
export function createMemoryStorageAdapter(initial?: Record<string, string>): GameStorageAdapter {
  const map = new Map<string, string>(initial ? Object.entries(initial) : []);

  return {
    async read(key: string): Promise<string | undefined> {
      return map.get(key);
    },
    async write(key: string, value: string): Promise<void> {
      map.set(key, value);
    },
    async remove(key: string): Promise<void> {
      map.delete(key);
    },
  };
}

/**
 * Programmable failure adapter for tests — wraps another adapter and injects failures.
 */
export function createFailingStorageAdapter(
  inner: GameStorageAdapter,
  opts: {
    failRead?: (key: string) => Error | null;
    failWrite?: (key: string, value: string) => Error | null;
    failRemove?: (key: string) => Error | null;
    delayMs?: number;
  } = {},
): GameStorageAdapter {
  const delay = async (): Promise<void> => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  };
  return {
    async read(key: string): Promise<string | undefined> {
      await delay();
      const err = opts.failRead?.(key) ?? null;
      if (err) throw err;
      return inner.read(key);
    },
    async write(key: string, value: string): Promise<void> {
      await delay();
      const err = opts.failWrite?.(key, value) ?? null;
      if (err) throw err;
      return inner.write(key, value);
    },
    async remove(key: string): Promise<void> {
      await delay();
      const err = opts.failRemove?.(key) ?? null;
      if (err) throw err;
      return inner.remove(key);
    },
  };
}
