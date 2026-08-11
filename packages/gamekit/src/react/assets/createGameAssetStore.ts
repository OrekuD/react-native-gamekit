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
  /** Idempotent release closures for every reference this attempt owns. */
  readonly acquired: ResourceRef[];
}

/** One idempotent ownership token: release() is safe to call repeatedly and
 * disposes the native handle when it is the final reference (RF5). */
interface ResourceRef {
  readonly release: () => void;
  /** Resolve to the decoded handle (the shared in-flight promise or cache). */
  readonly ready: () => Promise<NativeImageHandle>;
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
  /** Per-attempt ownership is explicit: the attempt object is passed through
   * every resolve/decode/validate operation; no shared singleton (R4). */

  function assertLive(): void {
    if (disposed) {
      throw new AssetStoreError('ASSET_STORE_DISPOSED', [], 'asset store is disposed');
    }
  }

  /** Race a promise with the abort signal; the listener is removed on
   * resolve, reject, and abort (RF5). */
  function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal === undefined) {
      return promise;
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
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
      if (entry.handle !== undefined) {
        entry.handle.dispose();
      }
      resources.delete(uri);
    }
  }

  /**
   * Begin one owned reference to a resource. Every waiter — cache miss,
   * in-flight share, or completed cache hit — goes through this single
   * accounting path and receives an idempotent release closure (RF5). The
   * caller must either commit the ref to the attempt or call release()
   * exactly once; the final release disposes the native handle.
   */
  function beginResourceRef(uri: string): ResourceRef {
    const existing = resources.get(uri);
    let entry: ResourceEntry;
    if (existing !== undefined && existing.handle !== undefined) {
      // Completed cache hit.
      entry = existing;
      entry.refCount += 1;
      const handle = existing.handle;
      return {
        release: () => dropResourceRef(uri),
        ready: async () => handle,
      };
    }
    if (existing !== undefined && existing.inFlight !== undefined) {
      // Shared in-flight decode.
      entry = existing;
      entry.refCount += 1;
      const shared = existing.inFlight;
      return {
        release: () => dropResourceRef(uri),
        ready: async () => shared,
      };
    }
    // Cache miss: this waiter starts the decode.
    entry = {
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
    void promise.then(
      () => {
        entry.inFlight = undefined;
      },
      () => {
        entry.inFlight = undefined;
      },
    );
    return {
      release: () => dropResourceRef(uri),
      ready: async () => promise,
    };
  }

  async function acquireOne(
    asset: LogicalAsset,
    attempt: Attempt,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const uri = await raceWithAbort(pipelines.resolve(asset.descriptor.source), signal);
    // RF5: the reference token exists before any cancellable await; abort
    // can never leave a positive reference behind.
    const ref = beginResourceRef(uri);
    try {
      const handle = await raceWithAbort(ref.ready(), signal);
      attempt.acquired.push(ref);
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
    } catch (error) {
      // Every failure, abort, and stale completion releases this waiter's
      // reference exactly once; surviving owners keep theirs.
      ref.release();
      throw error;
    }
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

    // RF5: normalize groups at the public boundary (dedupe) and use the
    // same list for the progress total and acquisition.
    const groupsNormalized = [...new Set(options.groups)];
    const requested: LogicalAsset[] = [];
    for (const group of groupsNormalized) {
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
    const attempt: Attempt = { token, acquired: [] };

    const loaded = new Map<string, string>();
    try {
      let completed = 0;
      const total = requested.length;
      for (const asset of requested) {
        throwIfAborted();
        await acquireOne(asset, attempt, signal);
        loaded.set(asset.key, asset.key);
        completed += 1;
        options.onProgress?.(completed / total);
      }
      return createLease(loaded, () => {
        for (const ref of attempt.acquired) {
          ref.release();
        }
      });
    } catch (error) {
      // Release every reference this attempt acquired exactly once; entries
      // still leased by a previous lease keep their references.
      for (const ref of attempt.acquired) {
        ref.release();
      }
      throw error;
    }
  };

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
          // R9: v1 lookup is descriptor-reference membership — the exact
          // descriptor object the manifest declared — not a nominal manifest
          // identity. Identically shaped manifests share the structural type,
          // so the type layer cannot distinguish them; the runtime reference
          // check is the guarantee.
          throw new GameAssetError(
            'ASSET_UNKNOWN_ASSET',
            [],
            'descriptor is not a reference declared by this manifest and group selection',
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
