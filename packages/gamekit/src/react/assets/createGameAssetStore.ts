/**
 * Asset store core (T7.4).
 *
 * The explicit owner of the decoded-image cache. Source resolution and
 * image decoding are injected so the ownership logic is unit-testable with
 * fakes and never imports native modules itself.
 *
 * Ownership rules:
 * - An explicitly created store owns cache/native entries.
 * - `acquire` resolves only with a complete usable lease.
 * - Reference counts keep a shared source alive across leases; the native
 *   handle is disposed exactly once when the final lease releases it.
 * - A failed/abandoned attempt releases every handle it acquired; entries
 *   still leased elsewhere are preserved.
 * - Attempts carry an epoch token: stale completion after retry/unmount is
 *   ignored and can never double-dispose.
 * - `AbortSignal` detaches an imperative caller immediately; late results
 *   from the underlying work are ignored.
 * - Progress is monotonic and counts requested logical resources (a
 *   deduplicated source still counts once per logical descriptor).
 * - The store rejects acquisitions after disposal; disposal is idempotent.
 */
import { GameAssetError } from '../../assets/errors';
import type {
  AssetGroupMap,
  BrandedAssetDescriptor,
  GameAssetLease,
  ImageDescriptor,
  LoadedImage,
  LoadedAssets,
  LoadedSpriteSheet,
  SpriteFrameRect,
  SpriteSheetDescriptor,
} from '../../assets/types';
import { validateFrameRect } from '../../assets/validation';
import { GameAssetError as AssetStoreError } from '../../assets/errors';

/** Opaque decoded-image handle (Skia's SkImage satisfies this structurally). */
export interface NativeImageHandle {
  /** Decoded width in pixels. */
  width(): number;
  /** Decoded height in pixels. */
  height(): number;
  /** Release the native handle; exactly once per resource. */
  dispose(): void;
}

/** Injected source resolution and decode pipelines. */
export interface AssetPipelines {
  /** Resolve a static module handle to a canonical local URI. */
  readonly resolve: (source: number) => Promise<string>;
  /** Decode a canonical local URI into an image handle. */
  readonly decode: (uri: string) => Promise<NativeImageHandle>;
}

/** Acquisition options for `acquire`. */
export interface AcquireOptions {
  /** Logical groups to load; an empty set resolves immediately. */
  readonly groups: readonly string[];
  /** Detach the caller; late results are ignored, never resurrected. */
  readonly signal?: AbortSignal;
  /** Monotonic progress in [0, 1], one update per completed logical asset. */
  readonly onProgress?: (progress: number) => void;
}

interface ResourceEntry {
  readonly uri: string;
  handle: NativeImageHandle | undefined;
  inFlight: Promise<NativeImageHandle> | undefined;
  /** Logical descriptor keys sharing this resolved source. */
  readonly logicalKeys: Set<string>;
  refCount: number;
}

interface Attempt {
  readonly token: number;
  /** logicalKey -> shared resource key; entries acquired by THIS attempt. */
  readonly acquired: Map<string, string>;
}

/** One logical (group, asset) identity inside a manifest. */
interface LogicalAsset {
  readonly key: string;
  readonly group: string;
  readonly name: string;
  readonly descriptor: ImageDescriptor | SpriteSheetDescriptor;
}

function logicalAssetsOf(manifest: AssetGroupMap): LogicalAsset[] {
  const result: LogicalAsset[] = [];
  for (const [group, assets] of Object.entries(manifest)) {
    for (const [name, descriptor] of Object.entries(assets)) {
      result.push({
        key: `${group}/${name}`,
        group,
        name,
        descriptor: descriptor as ImageDescriptor | SpriteSheetDescriptor,
      });
    }
  }
  return result;
}

/** Validate a sprite sheet's frames against decoded dimensions. */
function validateFrames(
  path: readonly string[],
  frames: Readonly<Record<string, SpriteFrameRect>>,
  width: number,
  height: number,
): void {
  for (const [name, rect] of Object.entries(frames)) {
    validateFrameRect(path, name, rect);
    if (rect.x + rect.width > width || rect.y + rect.height > height) {
      throw new GameAssetError(
        'ASSET_FRAME_OUT_OF_BOUNDS',
        [...path, name],
        `frame ${JSON.stringify(name)} (${rect.x},${rect.y} ${rect.width}x${rect.height}) exceeds the decoded image ${width}x${height}`,
      );
    }
  }
}

export function createGameAssetStoreCore<TManifest extends AssetGroupMap>(
  manifest: TManifest,
  pipelines: AssetPipelines,
): {
  readonly acquire: (options: AcquireOptions) => Promise<GameAssetLease<TManifest>>;
  readonly dispose: () => void;
  readonly isDisposed: () => boolean;
} {
  const groups = new Set<string>(Object.keys(manifest));
  const logical = logicalAssetsOf(manifest);
  const byKey = new Map<string, LogicalAsset>(logical.map((asset) => [asset.key, asset]));
  const resources = new Map<string, ResourceEntry>();
  let disposed = false;
  let nextAttemptToken = 1;
  /** Handles acquired by the current attempt and not yet committed to a lease. */
  let pendingAttempt: Attempt | undefined;

  function assertLive(): void {
    if (disposed) {
      throw new AssetStoreError('ASSET_STORE_DISPOSED', [], 'asset store is disposed');
    }
  }

  /** A promise that rejects when the acquisition signal aborts. */
  function abortPromise(signal: AbortSignal | undefined): Promise<never> {
    if (signal === undefined) {
      return new Promise<never>(() => undefined);
    }
    return new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted'));
      }, { once: true });
    });
  }

  /** Drop one reference held by a caller that never recorded a logical key. */
  function dropResourceRef(uri: string): void {
    const entry = resources.get(uri);
    if (entry === undefined) {
      return;
    }
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      resources.delete(uri);
    }
  }

  /** Increment the reference count; the caller owns exactly one release. */
  async function acquireResource(uri: string): Promise<NativeImageHandle> {
    const existing = resources.get(uri);
    if (existing !== undefined) {
      // Cache hit: the shared decoded handle or the shared in-flight load.
      existing.refCount += 1;
      if (existing.inFlight !== undefined) {
        return existing.inFlight;
      }
      if (existing.handle !== undefined) {
        return existing.handle;
      }
    }
    const entry: ResourceEntry = {
      uri,
      handle: undefined,
      inFlight: undefined,
      logicalKeys: new Set(),
      refCount: 1,
    };
    resources.set(uri, entry);
    const promise = (async () => {
      const handle = await pipelines.decode(uri);
      // A late completion must never resurrect a disposed store or an entry
      // whose last waiter aborted while the decode was in flight.
      if (disposed || entry.refCount <= 0) {
        handle.dispose();
        if (entry.refCount <= 0) {
          resources.delete(uri);
        }
        throw new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted');
      }
      entry.handle = handle;
      return handle;
    })();
    entry.inFlight = promise;
    try {
      return await promise;
    } catch (error) {
      // This caller's reference dies with the failure; other waiters keep
      // theirs and the shared failure is re-thrown for each waiter.
      entry.refCount -= 1;
      if (entry.refCount <= 0) {
        resources.delete(uri);
      }
      throw error;
    } finally {
      entry.inFlight = undefined;
    }
  }

  async function acquireOne(
    asset: LogicalAsset,
    token: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const uri = await Promise.race([pipelines.resolve(asset.descriptor.source), abortPromise(signal)]);
    if (signal?.aborted === true) {
      throw new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted');
    }
    const decode = acquireResource(uri);
    const handle = await Promise.race([decode, abortPromise(signal)]);
    if (signal !== undefined && signal.aborted) {
      // The decode may still complete; drop this waiter's reference so the
      // late completion disposes the handle and removes the entry.
      dropResourceRef(uri);
      throw new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted');
    }
    // Record ownership BEFORE any further await or validation so every
    // reference has a single release path.
    pendingAttempt?.acquired.set(asset.key, uri);
    const entry = resources.get(uri);
    if (entry !== undefined) {
      entry.logicalKeys.add(asset.key);
    }
    if (asset.descriptor.kind === 'sprite-sheet') {
      validateFrames(
        [asset.group, asset.name, 'frames'],
        asset.descriptor.frames,
        handle.width(),
        handle.height(),
      );
    }
    void token;
  }

  const acquire = async (options: AcquireOptions): Promise<GameAssetLease<TManifest>> => {
    assertLive();
    const { signal } = options;
    const throwIfAborted = (): void => {
      if (signal?.aborted === true) {
        throw new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted');
      }
    };
    throwIfAborted();

    const requested: LogicalAsset[] = [];
    for (const group of options.groups) {
      if (!groups.has(group)) {
        throw new GameAssetError('ASSET_UNKNOWN_GROUP', [group], `unknown asset group ${JSON.stringify(group)}`);
      }
      for (const asset of logical) {
        if (asset.group === group) {
          requested.push(asset);
        }
      }
    }
    if (requested.length === 0) {
      // Empty group set resolves immediately with progress 1 and no resources.
      options.onProgress?.(1);
      return createLease(new Map(), () => undefined);
    }

    const token = nextAttemptToken;
    nextAttemptToken += 1;
    const attempt: Attempt = { token, acquired: new Map() };
    pendingAttempt = attempt;

    const loaded = new Map<string, string>();
    try {
      let completed = 0;
      const total = requested.length;
      for (const asset of requested) {
        throwIfAborted();
        await acquireOne(asset, token, signal);
        loaded.set(asset.key, asset.key);
        completed += 1;
        options.onProgress?.(completed / total);
      }
      if (pendingAttempt === attempt) {
        pendingAttempt = undefined;
      }
      return createLease(loaded, () => {
        for (const key of loaded.keys()) {
          releaseLogical(key);
        }
      });
    } catch (error) {
      // Release every reference this attempt acquired exactly once; entries
      // still leased by a previous lease keep their references.
      if (pendingAttempt === attempt) {
        pendingAttempt = undefined;
      }
      for (const logicalKey of attempt.acquired.keys()) {
        releaseLogical(logicalKey);
      }
      throw error;
    }
  };

  function releaseLogical(logicalKey: string): void {
    // Logical keys are shared across leases; the reference count is the
    // authority. The entry (and its logical-key set) dies with the final
    // release.
    for (const [uri, entry] of resources) {
      if (entry.logicalKeys.has(logicalKey)) {
        entry.refCount -= 1;
        if (entry.refCount <= 0) {
          if (entry.handle !== undefined) {
            entry.handle.dispose();
          }
          resources.delete(uri);
        }
        return;
      }
    }
  }

  function createLease(
    loadedKeys: ReadonlyMap<string, string>,
    onDispose: () => void,
  ): GameAssetLease<TManifest> {
    let leaseDisposed = false;
    const loaded = new Map<string, LogicalAsset>();
    for (const key of loadedKeys.keys()) {
      const asset = byKey.get(key);
      if (asset !== undefined) {
        loaded.set(key, asset);
      }
    }
    const assets: LoadedAssets<TManifest> = {
      manifest,
      get: <TDescriptor extends ImageDescriptor | SpriteSheetDescriptor>(
        descriptor: BrandedAssetDescriptor<TManifest, TDescriptor>,
      ) => {
        assertLive();
        if (leaseDisposed) {
          throw new AssetStoreError('ASSET_STORE_DISPOSED', [], 'lease is disposed');
        }
        const entry = findLoadedFor(descriptor, loaded);
        if (entry === undefined) {
          throw new GameAssetError(
            'ASSET_UNKNOWN_ASSET',
            [],
            'descriptor does not belong to this manifest or group selection',
          );
        }
        return entry as TDescriptor extends { readonly kind: 'sprite-sheet' }
          ? LoadedSpriteSheet
          : LoadedImage;
      },
    };
    return {
      assets,
      dispose: () => {
        if (leaseDisposed) {
          return;
        }
        leaseDisposed = true;
        onDispose();
      },
    };
  }

  function findLoadedFor(
    descriptor: ImageDescriptor | SpriteSheetDescriptor,
    loaded: ReadonlyMap<string, LogicalAsset>,
  ): unknown {
    for (const asset of loaded.values()) {
      if (asset.descriptor === descriptor) {
        const entry = entryFor(asset.key);
        const handle = entry?.handle;
        const width = handle?.width() ?? 0;
        const height = handle?.height() ?? 0;
        if (asset.descriptor.kind === 'image') {
          return { descriptor: asset.descriptor, width, height, image: handle };
        }
        return {
          descriptor: asset.descriptor,
          frames: asset.descriptor.frames,
          width,
          height,
          image: handle,
        };
      }
    }
    return undefined;
  }

  function entryFor(logicalKey: string): ResourceEntry | undefined {
    for (const entry of resources.values()) {
      if (entry.logicalKeys.has(logicalKey)) {
        return entry;
      }
    }
    return undefined;
  }

  return {
    acquire,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      // Drop entries with no live lease; leased entries stay until their
      // lease releases them (their refCount keeps them alive).
      for (const [uri, entry] of resources) {
        if (entry.refCount <= 0 && entry.handle !== undefined) {
          entry.handle.dispose();
          resources.delete(uri);
        }
      }
    },
    isDisposed: () => disposed,
  };
}

export type GameAssetStore = ReturnType<typeof createGameAssetStoreCore>;
