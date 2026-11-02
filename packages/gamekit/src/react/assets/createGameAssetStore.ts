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
 * - Abort/disposed state is checked after every awaited step and before
 *   the lease is published, so an abort racing completion never surfaces
 *   a lease for a cancelled request.
 * - Progress is monotonic and counts requested logical resources (a
 *   deduplicated source still counts once per logical descriptor).
 * - The store rejects acquisitions after disposal; disposal is idempotent.
 * - Cleanup attempts every reference even if native disposal throws. A
 *   single failure is rethrown; multiple failures use AggregateError, with
 *   the acquisition failure first when cleanup follows a failed attempt.
 */
import { GameAssetError } from '../../assets/errors';
import type {
  AssetGroupMap,
  AssetGroupName,
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
export interface AcquireOptions<TGroup extends string = string> {
  /** Logical groups to load; an empty set resolves immediately. */
  readonly groups: readonly TGroup[];
  /** Detach the caller; late results are ignored, never resurrected. */
  readonly signal?: AbortSignal;
  /** Monotonic progress in [0, 1], one update per completed logical asset. */
  readonly onProgress?: (progress: number) => void;
}

interface DecodedImage {
  readonly handle: NativeImageHandle;
  readonly width: number;
  readonly height: number;
}

interface ResourceEntry {
  readonly uri: string;
  decoded: DecodedImage | undefined;
  inFlight: Promise<DecodedImage> | undefined;
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
  readonly ready: () => Promise<DecodedImage>;
}

/** Native disposal must not prevent unrelated references from releasing. */
function releaseAll(
  refs: readonly Pick<ResourceRef, 'release'>[],
  initialErrors: readonly unknown[] = [],
): void {
  const errors = [...initialErrors];
  for (const ref of refs) {
    try {
      ref.release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'asset acquisition or cleanup failed');
}

/** One logical (group, asset) identity inside a manifest. */
interface LogicalAsset {
  readonly key: string;
  readonly group: string;
  readonly name: string;
  readonly descriptor: ImageDescriptor | SpriteSheetDescriptor;
}

/** Index once so each acquisition visits only its selected groups' assets. */
function logicalAssetsByGroup(manifest: AssetGroupMap): ReadonlyMap<string, readonly LogicalAsset[]> {
  const result = new Map<string, readonly LogicalAsset[]>();
  for (const [group, assets] of Object.entries(manifest)) {
    const logical: LogicalAsset[] = [];
    for (const [name, descriptor] of Object.entries(assets)) {
      logical.push({
        key: `${group}/${name}`,
        group,
        name,
        descriptor: descriptor as ImageDescriptor | SpriteSheetDescriptor,
      });
    }
    result.set(group, logical);
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
  readonly acquire: (options: AcquireOptions<AssetGroupName<TManifest>>) => Promise<GameAssetLease<TManifest>>;
  readonly dispose: () => void;
  readonly isDisposed: () => boolean;
} {
  const groups = logicalAssetsByGroup(manifest);
  const resources = new Map<string, ResourceEntry>();
  let disposed = false;
  /** Per-attempt ownership is explicit: the attempt object is passed through
   * every resolve/decode/validate operation; no shared singleton (R4). */

  function assertLive(): void {
    if (disposed) {
      throw new AssetStoreError('ASSET_STORE_DISPOSED', [], 'asset store is disposed');
    }
  }

  /** Disposal invalidates work already in progress just like cancellation. */
  function assertActive(signal: AbortSignal | undefined): void {
    if (disposed || signal?.aborted === true) {
      throw new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted');
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
        signal.removeEventListener('abort', onAbort);
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
      // A pipeline may synchronously abort before returning its promise.
      // Attach both settlement handlers first so its late rejection is owned.
      if (signal.aborted) onAbort();
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
      const decoded = entry.decoded;
      entry.decoded = undefined;
      if (resources.get(entry.uri) === entry) {
        resources.delete(entry.uri);
      }
      // Unlink before calling native/user code: a throw or reentrant acquire
      // can never reuse a handle whose disposal has already been attempted.
      decoded?.handle.dispose();
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
    if (existing !== undefined && existing.decoded !== undefined) {
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
      decoded: undefined,
      inFlight: undefined,
      refCount: 1,
    };
    resources.set(uri, entry);
    const promise = (async () => {
      const handle = await pipelines.decode(uri);
      // A late completion must never resurrect a disposed store or an entry
      // whose last waiter aborted while the decode was in flight. Identity
      // matters here too: the mapping may now hold a successor entry.
      try {
        assertActive(undefined);
        if (entry.refCount <= 0) {
          throw new AssetStoreError('ASSET_ABORTED', [], 'asset acquisition aborted');
        }
        // Read native dimensions once for this decode, before caching it.
        const width = handle.width();
        const height = handle.height();
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
          throw new AssetStoreError('ASSET_DECODE_FAILED', [], 'decoded image dimensions must be positive finite numbers');
        }
        assertActive(undefined);
        const decoded = { handle, width, height };
        entry.decoded = decoded;
        return decoded;
      } catch (error) {
        if (resources.get(uri) === entry) resources.delete(uri);
        releaseAll([{ release: () => handle.dispose() }], [error]);
        throw error;
      }
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
    const ready = async (): Promise<DecodedImage> => {
      if (entry.decoded !== undefined) {
        return entry.decoded;
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
    assertActive(signal);
    // RF5: the reference token exists before any cancellable await; abort
    // can never leave a positive reference behind.
    const { ref, entry } = beginResourceRef(uri);
    try {
      const decoded = await raceWithAbort(ref.ready(), signal);
      assertActive(signal);
      if (asset.descriptor.kind === 'sprite-sheet') {
        validateFrames(
          [asset.group, asset.name, 'frames'],
          asset.descriptor.frames,
          decoded.width,
          decoded.height,
        );
      }
      // Transfer ownership to the attempt only after validation succeeds.
      attempt.acquired.push(ref);
      return entry;
    } catch (error) {
      // The single owner releases exactly once; surviving owners keep theirs.
      releaseAll([ref], [error]);
      throw error;
    }
  }


  const acquire = async (
    options: AcquireOptions<AssetGroupName<TManifest>>,
  ): Promise<GameAssetLease<TManifest>> => {
    assertLive();
    const { signal } = options;
    assertActive(signal);

    // RF5: normalize groups at the public boundary (dedupe) and use the
    // same list for the progress total and acquisition.
    const groupsNormalized = [...new Set(options.groups)];
    const requested: LogicalAsset[] = [];
    for (const group of groupsNormalized) {
      const logical = groups.get(group);
      if (logical === undefined) {
        throw new GameAssetError('ASSET_UNKNOWN_GROUP', [group], `unknown asset group ${JSON.stringify(group)}`);
      }
      for (const asset of logical) {
        requested.push(asset);
      }
    }
    if (requested.length === 0) {
      // Empty group set resolves immediately with progress 1 and no resources.
      options.onProgress?.(1);
      assertActive(signal);
      return createLease(new Map(), () => undefined);
    }

    const attempt: Attempt = { acquired: [] };

    const loaded = new Map<string, { readonly asset: LogicalAsset; readonly entry: ResourceEntry }>();
    try {
      let completed = 0;
      const total = requested.length;
      for (const asset of requested) {
        assertActive(signal);
        const entry = await acquireOne(asset, attempt, signal);
        assertActive(signal);
        loaded.set(asset.key, { asset, entry });
        completed += 1;
        options.onProgress?.(completed / total);
        assertActive(signal);
      }
      // GS-ASSET-02: an abort racing the final step must surface instead of
      // publishing a lease for a cancelled request.
      assertActive(signal);
      return createLease(loaded, () => {
        releaseAll(attempt.acquired);
      });
    } catch (error) {
      // Release every reference this attempt acquired exactly once; entries
      // still leased by a previous lease keep their references.
      releaseAll(attempt.acquired, [error]);
      throw error;
    }
  };

  /**
   * Build one validated loaded value from the exact entry that backed the
   * acquisition (GS-ASSET-04). The handle is always present: `ready()` only
   * resolves after the entry's validated image is set.
   */
  function loadedValueFor(asset: LogicalAsset, entry: ResourceEntry): LoadedImage | LoadedSpriteSheet {
    const decoded = entry.decoded;
    if (decoded === undefined) {
      // Defensive: reachable only if the store's own accounting is broken.
      // Fail clearly rather than publishing an imageless loaded value.
      throw new AssetStoreError(
        'ASSET_DECODE_FAILED',
        [asset.group, asset.name],
        `resource ${JSON.stringify(entry.uri)} resolved without a decoded handle`,
      );
    }
    if (asset.descriptor.kind === 'image') {
      return Object.freeze({
        descriptor: asset.descriptor,
        width: decoded.width,
        height: decoded.height,
        image: decoded.handle,
      });
    }
    return Object.freeze({
      descriptor: asset.descriptor,
      frames: asset.descriptor.frames,
      width: decoded.width,
      height: decoded.height,
      image: decoded.handle,
    });
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
      // Every entry is owned by a lease or in-progress attempt. Their
      // tokens release it; late decodes dispose their own native handles.
    },
    isDisposed: () => disposed,
  };
}

/** Explicit store annotations retain their manifest's groups and descriptors. */
export type GameAssetStore<TManifest extends AssetGroupMap = AssetGroupMap> =
  ReturnType<typeof createGameAssetStoreCore<TManifest>>;
