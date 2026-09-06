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
 * - Each reference token releases exactly once, decrements its captured
 *   entry (never a fresh URI lookup), and only removes the cache mapping
 *   when the mapping still holds that exact entry (GS-ASSET-01/02).
 * - Each acquisition stage has one cleanup owner: a reference transfers to
 *   the attempt only after successful validation, so a failed validation
 *   releases exactly once and never touches another owner's reference.
 * - A failed/abandoned attempt releases every handle it acquired; entries
 *   still leased elsewhere are preserved.
 * - Stale completion after retry/unmount is rejected by the caller's abort
 *   signal and the store's disposed flag; late decodes dispose their own
 *   handle without touching a successor entry.
 * - `AbortSignal` detaches an imperative caller immediately; late results
 *   from the underlying work are ignored.
 * - Abort/disposed state is checked after the final awaited step and before
 *   the lease is published, so an abort racing completion never surfaces
 *   a lease for a cancelled request.
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
  refCount: number;
}

/** References owned by one in-progress acquisition (GS-ASSET-04: no epoch
 * token — staleness is decided by the caller's abort signal, not a counter). */
interface Attempt {
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
  const resources = new Map<string, ResourceEntry>();
  let disposed = false;
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

  /**
   * Drop one reference to the captured entry (GS-ASSET-01/02). The entry
   * object — not a fresh URI lookup — is decremented, and the cache mapping
   * is removed only when it still holds this exact entry, so a stale token
   * can never affect a successor generation for the same URI.
   */
  function dropResourceRef(entry: ResourceEntry): void {
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      if (entry.handle !== undefined) {
        entry.handle.dispose();
      }
      if (resources.get(entry.uri) === entry) {
        resources.delete(entry.uri);
      }
    }
  }

  /**
   * Begin one owned reference to a resource (GS-ASSET-01). Every waiter —
   * cache miss, in-flight share, or completed cache hit — goes through this
   * single accounting path and receives a token bound to the exact entry
   * object. The token releases exactly once: a flag guards the decrement,
   * so a validation failure (released by its stage) followed by attempt
   * cleanup (releasing the attempt's tokens) can never double-release.
   * The caller must either transfer the token to the attempt or let its
   * owning stage release it exactly once; the final release disposes the
   * native handle.
   */
  function beginResourceRef(uri: string): { readonly ref: ResourceRef; readonly entry: ResourceEntry } {
    const existing = resources.get(uri);
    if (existing !== undefined && existing.handle !== undefined) {
      // Completed cache hit.
      existing.refCount += 1;
      return { ref: idempotentRef(existing), entry: existing };
    }
    if (existing !== undefined && existing.inFlight !== undefined) {
      // Shared in-flight decode.
      existing.refCount += 1;
      return { ref: idempotentRef(existing), entry: existing };
    }
    // Cache miss: this waiter starts the decode.
    const entry: ResourceEntry = {
      uri,
      handle: undefined,
      inFlight: undefined,
      refCount: 1,
    };
    resources.set(uri, entry);
    const promise = (async () => {
      const handle = await pipelines.decode(uri);
      // A late completion must never resurrect a disposed store or an entry
      // whose last waiter aborted while the decode was in flight. Identity
      // matters here too: the mapping may now hold a successor entry.
      if (disposed || entry.refCount <= 0) {
        handle.dispose();
        if (entry.refCount <= 0 && resources.get(uri) === entry) {
          resources.delete(uri);
        }
        throw new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted');
      }
      entry.handle = handle;
      return handle;
    })();
    entry.inFlight = promise;
    const cleanup = (): void => {
      if (entry.inFlight === promise) {
        entry.inFlight = undefined;
      }
    };
    promise.then(cleanup, cleanup);
    const ref = idempotentRef(entry);
    return { ref, entry };
  }

  /** One release closure bound to its entry; safe to call repeatedly. */
  function idempotentRef(entry: ResourceEntry): ResourceRef {
    let released = false;
    const ready = async (): Promise<NativeImageHandle> => {
      if (entry.handle !== undefined) {
        return entry.handle;
      }
      const inFlight = entry.inFlight;
      if (inFlight === undefined) {
        throw new AssetStoreError(
          'ASSET_DECODE_FAILED',
          [],
          `resource ${JSON.stringify(entry.uri)} has no decoded handle`,
        );
      }
      return inFlight;
    };
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        dropResourceRef(entry);
      },
      ready,
    };
  }

  /**
   * Acquire one logical asset (GS-ASSET-01). This stage owns its reference
   * until successful validation transfers it to the attempt: on any
   * failure the stage releases exactly once and the token never enters
   * `attempt.acquired`, so attempt cleanup can never release it again.
   * Returns the exact entry backing this asset for the lease table.
   */
  async function acquireOne(
    asset: LogicalAsset,
    attempt: Attempt,
    signal: AbortSignal | undefined,
  ): Promise<ResourceEntry> {
    const uri = await raceWithAbort(pipelines.resolve(asset.descriptor.source), signal);
    // RF5: the reference token exists before any cancellable await; abort
    // can never leave a positive reference behind.
    const { ref, entry } = beginResourceRef(uri);
    try {
      const handle = await raceWithAbort(ref.ready(), signal);
      if (asset.descriptor.kind === 'sprite-sheet') {
        validateFrames(
          [asset.group, asset.name, 'frames'],
          asset.descriptor.frames,
          handle.width(),
          handle.height(),
        );
      }
      // Transfer ownership to the attempt only after validation succeeds.
      attempt.acquired.push(ref);
      return entry;
    } catch (error) {
      // The single owner releases exactly once; surviving owners keep theirs.
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

    const attempt: Attempt = { acquired: [] };

    const loaded = new Map<string, { readonly asset: LogicalAsset; readonly entry: ResourceEntry }>();
    try {
      let completed = 0;
      const total = requested.length;
      for (const asset of requested) {
        throwIfAborted();
        const entry = await acquireOne(asset, attempt, signal);
        loaded.set(asset.key, { asset, entry });
        completed += 1;
        options.onProgress?.(completed / total);
      }
      // GS-ASSET-02: an abort racing the final step must surface instead of
      // publishing a lease for a cancelled request.
      throwIfAborted();
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

  /**
   * Build one validated loaded value from the exact entry that backed the
   * acquisition (GS-ASSET-04). The handle is always present: `ready()` only
   * resolves after the entry's handle is set.
   */
  function loadedValueFor(asset: LogicalAsset, entry: ResourceEntry): LoadedImage | LoadedSpriteSheet {
    const handle = entry.handle;
    if (handle === undefined) {
      // Defensive: reachable only if the store's own accounting is broken.
      // Fail clearly rather than publishing an imageless loaded value.
      throw new AssetStoreError(
        'ASSET_DECODE_FAILED',
        [asset.group, asset.name],
        `resource ${JSON.stringify(entry.uri)} resolved without a decoded handle`,
      );
    }
    if (asset.descriptor.kind === 'image') {
      return {
        descriptor: asset.descriptor,
        width: handle.width(),
        height: handle.height(),
        image: handle,
      };
    }
    return {
      descriptor: asset.descriptor,
      frames: asset.descriptor.frames,
      width: handle.width(),
      height: handle.height(),
      image: handle,
    };
  }

  function createLease(
    loaded: ReadonlyMap<string, { readonly asset: LogicalAsset; readonly entry: ResourceEntry }>,
    onDispose: () => void,
  ): GameAssetLease<TManifest> {
    let leaseDisposed = false;
    // GS-ASSET-04: the lease holds a direct descriptor→validated value
    // table built once from the captured entries. Lookup is a single map
    // hit: no per-get scans of loaded descriptors or resource key sets,
    // and no wrapper allocated per call.
    const table = new Map<ImageDescriptor | SpriteSheetDescriptor, LoadedImage | LoadedSpriteSheet>();
    for (const { asset, entry } of loaded.values()) {
      table.set(asset.descriptor, loadedValueFor(asset, entry));
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
        const value = table.get(descriptor as ImageDescriptor | SpriteSheetDescriptor);
        if (value === undefined) {
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
        return value as TDescriptor extends { readonly kind: 'sprite-sheet' }
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
