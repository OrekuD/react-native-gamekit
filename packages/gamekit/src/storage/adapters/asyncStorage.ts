import type { GameStorageAdapter } from '../types';
import { GameStorageError } from '../errors';

export type LoadedAsyncStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type Loader = () => Promise<LoadedAsyncStorage>;
let loader: Loader | null = null;

export function __setAsyncStorageLoader(fn: Loader | null): void {
  loader = fn;
}

export function __getAsyncStorageLoader(): Loader | null {
  return loader;
}

async function loadAsyncStorage(): Promise<LoadedAsyncStorage> {
  if (loader) return loader();
  try {
    const mod = (await import('@react-native-async-storage/async-storage')) as unknown as {
      default?: LoadedAsyncStorage;
    } & LoadedAsyncStorage;
    const resolved: LoadedAsyncStorage | undefined =
      (mod as LoadedAsyncStorage).getItem !== undefined
        ? (mod as LoadedAsyncStorage)
        : mod.default?.getItem !== undefined
          ? mod.default
          : undefined;
    if (!resolved) {
      throw new Error('AsyncStorage module did not export getItem/setItem/removeItem');
    }
    return resolved;
  } catch (cause) {
    throw new GameStorageError(
      '@react-native-async-storage/async-storage is not installed. Run `npx expo install @react-native-async-storage/async-storage` and rebuild with `npx expo prebuild` (or `expo run:ios` / `expo run:android`). See https://react-native-async-storage.github.io/async-storage/docs/install/',
      {
        code: 'BACKEND_READ_FAILED',
        cause,
      },
    );
  }
}

/**
 * RN adapter backed by AsyncStorage.
 *
 * Importing `rn-gamekit/storage` does not eagerly import AsyncStorage —
 * the dynamic import happens on the first read/write/remove.
 */
export function createGameStorageAdapter(): GameStorageAdapter {
  let cached: LoadedAsyncStorage | null = null;
  const get = async (): Promise<LoadedAsyncStorage> => {
    if (cached) return cached;
    cached = await loadAsyncStorage();
    return cached;
  };

  return {
    async read(key: string): Promise<string | undefined> {
      const storage = await get();
      const value = await storage.getItem(key);
      return value === null ? undefined : value;
    },
    async write(key: string, value: string): Promise<void> {
      const storage = await get();
      await storage.setItem(key, value);
    },
    async remove(key: string): Promise<void> {
      const storage = await get();
      await storage.removeItem(key);
    },
  };
}
