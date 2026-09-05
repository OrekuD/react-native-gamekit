/**
 * The playground's single surface/session owner (T8.4).
 *
 * One `SurfaceController` owns the active slot, the pending asset request,
 * the Performance Lab attachment, the retirement handoff, and final
 * disposal. Navigation creates a unique request; the controller constructs
 * every session and retires every superseded session; gameplay content,
 * `GameView`, and `GamePointerInput` only borrow the published slot.
 *
 * The controller is framework-free (no React imports) so the production
 * shell and the headless tests drive the identical allocation, transition,
 * and disposal code paths.
 */
import type { ComponentType } from 'react';
import type { GameSession } from 'rn-gamekit';
import type { GameRendererProps , GameCamera2DDefinition } from 'rn-gamekit/react';

import type { PlaygroundGameContentProps } from './PlaygroundGameContentProps.ts';
import {
  neutralSlot,
  reduceSurfaceState,
  type RunSurfaceAttachment,
  type RunSurfaceEvent,
  type SlotAssets,
  type SurfaceEvent,
  type SurfacePresentationBinding,
  type SurfaceSlot,
} from './surfaceSlot.ts';


/** One catalogued game: how the controller opens, renders, and binds it. */
/**
 * One asset-backed catalog entry's acquisition declaration (T16-RF3).
 * `manifest` is a Gamekit asset manifest value; `groups` names the groups
 * the shell waits for before publishing the ready slot.
 */
export interface SlotAssetRequest {
  readonly manifest: unknown;
  readonly groups: readonly string[];
}

/**
 * What one session preparation receives (T20.2): the matched asset lease
 * when the entry is asset-backed, an abort signal fired on close, retry,
 * replacement, and shell disposal, and the active request identity.
 */
export interface GameSessionPrepareContext {
  readonly assets: SlotAssets | undefined;
  readonly signal: AbortSignal;
  readonly requestId: number;
}

export interface SurfaceGameEntry {
  readonly renderer: ComponentType<GameRendererProps<never>>;
  readonly content: ComponentType<PlaygroundGameContentProps>;
  /**
   * Create the fresh gameplay session for one open request. Synchronous
   * entries keep the fast path; async entries return a promise and are
   * resolved by the controller's hostile-ordering preparation rules.
   */
  readonly createSession: (context: GameSessionPrepareContext) => GameSession | Promise<GameSession>;
  /**
   * T20G-R2: derive the validated durable projection a just-created session
   * hydrated from. The factory closure that loaded the save registers it
   * against the session (a per-entry WeakMap keyed by session identity);
   * the controller publishes the result on the ready slot so content can
   * initialize its durable baseline BEFORE event listeners register.
   * Returning undefined (fresh run) keeps the content-side recovery path.
   * A throw follows the binder rules: dispose, abort, retryable error.
   */
  readonly startupSave?: (session: GameSession) => unknown;
  /** Whether the pointer surface is enabled for this game's session. */
  readonly pointer: boolean;
  /**
   * The declared pointer action the shell's GamePointerInput binds.
   * Defaults to `primary` (the reference-game convention).
   */
  readonly pointerAction?: string;
  /**
   * Asset-backed games publish a loading slot and wait for asset-ready
   * (T16-RF3). Every asset-backed entry DECLARES its acquisition here —
   * manifest plus groups — so the shell can run one generic acquirer
   * instead of per-game special cases.
   */
  readonly assets?: SlotAssetRequest;
  /**
   * Optional camera binding (T12.7): supplied to the shell's GameView when
   * this game is active. The renderer receives the presented camera and
   * the pointer adapter discovers it from the mounted surface.
   */
  readonly camera2D?: GameCamera2DDefinition<never>;
  /** The game may attach instrumentation-only pairs to its ready binding
   * (T12-RF1); the attach shares the base session and never retires it. */
  readonly instrumented?: boolean;
  /**
   * Optional session-scoped presentation binding (T20.3): called exactly
   * once per created gameplay session — before its slot publishes — with
   * the resources the renderer needs (particle pools, event bridges). The
   * returned renderer replaces the entry renderer for that slot generation,
   * and `dispose` releases the resources exactly once through the same
   * retirement path as the session (acknowledged replacement or unmount).
   */
  readonly bindPresentation?: (session: GameSession) => SurfacePresentationBinding;
}

/** A preparation promise rejected: surfaced through the retryable error UI. */
export interface PrepareErrorInfo {
  readonly gameId: string;
  readonly requestId: number;
  readonly error: unknown;
}

/** Structural promise detection — cross-realm safe enough for this boundary. */
function isThenable(value: GameSession | Promise<GameSession>): value is Promise<GameSession> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

export interface SurfaceControllerOptions {
  /** The catalog registry; the controller resolves open requests through it. */
  readonly games: Record<string, SurfaceGameEntry>;
  /** The stable Home binding: one shell-owned idle session + neutral renderer. */
  readonly neutral: {
    readonly session: GameSession;
    readonly renderer: ComponentType<GameRendererProps<never>>;
  };
  /** A fresh per-request placeholder session for loading slots. */
  readonly createPlaceholder: () => GameSession;
  /** Idempotent final disposal (the core disposed-state guard). */
  readonly disposeSession: (session: GameSession) => void;
  /** Publish the next slot to the React owner. */
  readonly onSlot: (slot: SurfaceSlot) => void;
  /** A session preparation rejected for a still-current request (T20.2). */
  readonly onPrepareError?: (info: PrepareErrorInfo) => void;
  /** The generation of the initial neutral binding (must match the shell's). */
  readonly initialGeneration: number;
}

/** The lab game id that may attach run surfaces (playground catalog). */
const LAB_GAME_ID = 'perf-lab';

export class SurfaceController {
  private readonly options: SurfaceControllerOptions;
  private slot: SurfaceSlot;
  private nextRequestId = 0;
  private nextGeneration: number;
  private active = true;
  private pendingPrepare: { readonly requestId: number; readonly abort: () => void } | null = null;

  constructor(options: SurfaceControllerOptions) {
    this.options = options;
    this.nextGeneration = options.initialGeneration - 1;
    this.slot = neutralSlot(
      this.allocateGeneration(),
      options.neutral.session,
      options.neutral.renderer,
    );
  }

  /** The currently published binding. */
  get current(): SurfaceSlot {
    return this.slot;
  }

  /**
   * One explicit user open action (T8.2): a unique request id and a fresh
   * binding. Non-asset games publish their complete ready slot in the same
   * event boundary; asset-backed games publish a loading slot and wait for
   * `assetReady`.
   */
  open(gameId: string): void {
    const entry = this.options.games[gameId];
    if (entry === undefined) {
      throw new Error(`Unknown playground game: ${gameId}`);
    }
    const requestId = this.allocateRequestId();
    const generation = this.allocateGeneration();
    this.pauseReplaced();
    this.abortPendingPrepare();
    if (entry.assets !== undefined) {
      this.publish({
        kind: 'open-loading',
        requestId,
        generation,
        gameId,
        session: this.options.createPlaceholder(),
        renderer: entry.renderer,
        content: entry.content as unknown as ComponentType<{ readonly game: GameSession }>,
      });
      return;
    }
    const abortController = new AbortController();
    const publishLoading = (): void => {
      // T20F-R4: a loading slot mounts the retryable overlay for this request.
      this.publish({
        kind: 'open-loading',
        requestId,
        generation,
        gameId,
        session: this.options.createPlaceholder(),
        renderer: entry.renderer,
        content: entry.content as unknown as ComponentType<{ readonly game: GameSession }>,
      });
    };
    let prepared: GameSession | Promise<GameSession>;
    try {
      prepared = entry.createSession(this.createPrepareContext(requestId, undefined, abortController));
    } catch (error) {
      this.failPrepare(gameId, requestId, error, abortController, publishLoading);
      return;
    }
    if (isThenable(prepared)) {
      // T20.2: one loading state spans asset acquisition AND preparation.
      publishLoading();
      this.trackPrepare(entry, gameId, requestId, prepared, undefined, abortController);
      return;
    }
    const session = prepared;
    let presentation: SurfacePresentationBinding | undefined;
    let startupSave: unknown | undefined;
    try {
      presentation = entry.bindPresentation?.(session);
      startupSave = entry.startupSave?.(session);
    } catch (error) {
      // Binding or startupSave failed after session creation: release the
      // piece that succeeded, never leak (T20F-R4/T20G-RR1).
      this.disposeFailedPrepare(session, presentation);
      this.failPrepare(gameId, requestId, error, abortController, publishLoading);
      return;
    }
    this.publish({
      kind: 'open-ready',
      requestId,
      generation,
      gameId,
      session,
      renderer: presentation?.renderer ?? entry.renderer,
      content: entry.content as unknown as ComponentType<{ readonly game: GameSession }>,
      pointer: entry.pointer,
      pointerAction: entry.pointerAction,
      camera2D: entry.camera2D,
      ...(presentation !== undefined ? { presentationDispose: presentation.dispose } : {}),
      ...(startupSave !== undefined ? { startupSave } : {}),
    });
  }

  /** Close the active game: pause it, publish the neutral Home binding. */
  close(): void {
    this.abortPendingPrepare();
    if (this.slot.status === 'neutral') {
      return;
    }
    this.pauseReplaced();
    this.publish({
      kind: 'close',
      generation: this.allocateGeneration(),
      neutralSession: this.options.neutral.session,
      neutralRenderer: this.options.neutral.renderer,
    });
  }

  /**
   * Asset readiness for one request. The gameplay session is created ONLY
   * when the request is still current — a stale ready lease is never paired
   * with the slot and never creates a session.
   */
  assetReady(requestId: number, assets: SlotAssets): void {
    if (requestId !== this.slot.requestId || this.slot.status !== 'loading') {
      return;
    }
    const entry = this.options.games[this.slot.gameId ?? ''];
    if (entry === undefined) {
      return;
    }
    // T20.2: a duplicate readiness for a request whose preparation is still
    // in flight (Strict Mode double-invocation) never starts a second one.
    if (this.pendingPrepare !== null && this.pendingPrepare.requestId === requestId) {
      return;
    }
    const abortController = new AbortController();
    const gameId = this.slot.gameId ?? '';
    let prepared: GameSession | Promise<GameSession>;
    try {
      prepared = entry.createSession(this.createPrepareContext(requestId, assets, abortController));
    } catch (error) {
      // The slot is already loading, so the retry overlay is mounted (T20F-R4).
      this.failPrepare(gameId, requestId, error, abortController);
      return;
    }
    if (isThenable(prepared)) {
      this.trackPrepare(entry, gameId, requestId, prepared, assets, abortController);
      return;
    }
    const session = prepared;
    let presentation: SurfacePresentationBinding | undefined;
    let startupSave: unknown | undefined;
    try {
      presentation = entry.bindPresentation?.(session);
      startupSave = entry.startupSave?.(session);
    } catch (error) {
      this.disposeFailedPrepare(session, presentation);
      this.failPrepare(gameId, requestId, error, abortController);
      return;
    }
    this.publish({
      kind: 'asset-ready',
      requestId,
      generation: this.allocateGeneration(),
      session,
      renderer: presentation?.renderer ?? entry.renderer,
      pointer: entry.pointer,
      pointerAction: entry.pointerAction,
      assets,
      camera2D: entry.camera2D,
      ...(presentation !== undefined ? { presentationDispose: presentation.dispose } : {}),
      ...(startupSave !== undefined ? { startupSave } : {}),
    });
  }

  /**
   * Lab run/instrumentation events for the active request.
   *
   * Performance Lab runs keep the owned-session path (perf-lab only).
   * Instrumentation-only events (T12-RF1) are gated by the catalog's
   * `instrumented` capability and validated against the exact active
   * session inside the reducer — they never retire or dispose it.
   */
  runEvent(event: RunSurfaceEvent): void {
    if (this.slot.status !== 'ready') {
      return;
    }
    if (event.kind === 'instrumentation-attached' || event.kind === 'instrumentation-detached') {
      const entry = this.options.games[this.slot.gameId ?? ''];
      if (entry === undefined || entry.instrumented !== true) {
        return;
      }
      const reduction = reduceSurfaceState(this.slot, event as never);
      if (reduction.slot !== this.slot) {
        this.slot = reduction.slot;
        this.options.onSlot(reduction.slot);
      }
      this.releaseDisposable(reduction.disposable);
      return;
    }
    if (this.slot.gameId !== LAB_GAME_ID) {
      return;
    }
    if (event.kind === 'attach') {
      this.publish({
        kind: 'run-attached',
        generation: this.allocateGeneration(),
        attachment: event.attachment,
      });
      return;
    }
    this.publish({
      kind: 'run-detached',
      generation: this.allocateGeneration(),
      session: event.session,
    });
  }

  /**
   * React post-commit acknowledgment for the rendered generation (T8.4).
   * Only acknowledged generations make their retired sessions disposable.
   * Repeated acknowledgment is idempotent.
   */
  bindingCommitted(generation: number): void {
    this.publish({ kind: 'binding-committed', generation });
  }

  /** Final shell unmount: dispose every owned session exactly once. */
  dispose(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.abortPendingPrepare();
    const owned: GameSession[] = [];
    if (this.slot.status !== 'neutral') {
      owned.push(this.slot.session);
    }
    if (this.slot.run !== undefined) {
      owned.push(this.slot.run.session);
    }
    for (const record of this.slot.retiring) {
      owned.push(record.session);
    }
    owned.push(this.options.neutral.session);
    // Release the active binding before its session (T20.3).
    this.slot.presentationDispose?.();
    for (const record of this.slot.retiring) {
      record.presentationDispose?.();
    }
    for (const session of new Set(owned)) {
      this.options.disposeSession(session);
    }
  }

  /**
   * Fail one preparation attempt (T20F-R4): abort its signal, keep a loading
   * slot mounted for the retry overlay when none exists yet, and surface the
   * error for the still-current request.
   */
  private failPrepare(
    gameId: string,
    requestId: number,
    error: unknown,
    abortController: AbortController,
    publishLoading?: () => void,
  ): void {
    abortController.abort();
    this.pendingPrepare = null;
    publishLoading?.();
    this.options.onPrepareError?.({ gameId, requestId, error });
  }

  private createPrepareContext(
    requestId: number,
    assets: SlotAssets | undefined,
    abortController: AbortController,
  ): GameSessionPrepareContext {
    return { assets, signal: abortController.signal, requestId };
  }

  private abortPendingPrepare(): void {
    this.pendingPrepare?.abort();
    this.pendingPrepare = null;
  }

  /**
   * T20G-RR1: a failed bind or `startupSave` call must not leak the piece
   * that succeeded. The presentation release (if the bind created one)
   * always precedes the session dispose — the same order the retirement
   * path uses — and a throwing disposer never blocks the retry path.
   */
  private disposeFailedPrepare(
    session: GameSession,
    presentation: SurfacePresentationBinding | undefined,
  ): void {
    try {
      presentation?.dispose();
    } catch {
      // A throwing disposer must not block session disposal or the retry path.
    }
    this.options.disposeSession(session);
  }

  /**
   * Track one in-flight preparation (T20.2): a resolution publishes only
   * while its request is still current; a stale or aborted resolution is
   * disposed without publication; a rejection for a current request surfaces
   * through the retryable error path.
   */
  private trackPrepare(
    entry: SurfaceGameEntry,
    gameId: string,
    requestId: number,
    prepared: Promise<GameSession>,
    assets: SlotAssets | undefined,
    abortController: AbortController,
  ): void {
    this.pendingPrepare = { requestId, abort: () => abortController.abort() };
    void prepared.then(
      (session) => {
        if (this.pendingPrepare?.requestId !== requestId || !this.active) {
          this.options.disposeSession(session);
          return;
        }
        let presentation: SurfacePresentationBinding | undefined;
        let startupSave: unknown | undefined;
        try {
          presentation = entry.bindPresentation?.(session);
          startupSave = entry.startupSave?.(session);
        } catch (error) {
          // T20F-R4/T20G-RR1: a binder or startupSave throw must not leak
          // the resolved session, the just-created binding, or reject an
          // ignored promise — surface through the retry path.
          this.pendingPrepare = null;
          this.disposeFailedPrepare(session, presentation);
          abortController.abort();
          this.options.onPrepareError?.({ gameId, requestId, error });
          return;
        }
        this.pendingPrepare = null;
        const renderer = presentation?.renderer ?? entry.renderer;
        const generation = this.allocateGeneration();
        if (assets !== undefined) {
          this.publish({
            kind: 'asset-ready',
            requestId,
            generation,
            session,
            renderer,
            pointer: entry.pointer,
            pointerAction: entry.pointerAction,
            assets,
            camera2D: entry.camera2D,
            ...(presentation !== undefined ? { presentationDispose: presentation.dispose } : {}),
            ...(startupSave !== undefined ? { startupSave } : {}),
          });
          return;
        }
        this.publish({
          kind: 'open-ready',
          requestId,
          generation,
          gameId,
          session,
          renderer,
          content: entry.content as unknown as ComponentType<{ readonly game: GameSession }>,
          pointer: entry.pointer,
          pointerAction: entry.pointerAction,
          camera2D: entry.camera2D,
          ...(presentation !== undefined ? { presentationDispose: presentation.dispose } : {}),
          ...(startupSave !== undefined ? { startupSave } : {}),
        });
      },
      (error: unknown) => {
        // A rejected preparation is dead: stop its signal so any background
        // work the game started observes the abort (T20.2).
        abortController.abort();
        const stale = this.pendingPrepare?.requestId !== requestId;
        if (this.pendingPrepare?.requestId === requestId) {
          this.pendingPrepare = null;
        }
        if (stale || !this.active) {
          return;
        }
        this.options.onPrepareError?.({ gameId, requestId, error });
      },
    );
  }

  private allocateRequestId(): number {
    this.nextRequestId += 1;
    return this.nextRequestId;
  }

  private allocateGeneration(): number {
    this.nextGeneration += 1;
    return this.nextGeneration;
  }

  /** Pause the session being replaced before it enters retirement. */
  private pauseReplaced(): void {
    if (this.slot.status !== 'neutral' && this.slot.session.status === 'running') {
      this.slot.session.pause();
    }
    if (this.slot.run !== undefined && this.slot.run.session.status === 'running') {
      this.slot.run.session.pause();
    }
  }

  private publish(event: SurfaceEvent): void {
    if (!this.active) {
      return;
    }
    const reduction = reduceSurfaceState(this.slot, event);
    if (reduction.slot !== this.slot) {
      this.slot = reduction.slot;
      this.options.onSlot(reduction.slot);
    }
    this.releaseDisposable(reduction.disposable);
  }

  /** Release drained bindings' resources first, then their sessions (T20.3). */
  private releaseDisposable(disposable: readonly {
    readonly session: GameSession;
    readonly presentationDispose?: () => void;
  }[]): void {
    for (const entry of disposable) {
      entry.presentationDispose?.();
      this.options.disposeSession(entry.session);
    }
  }
}

export type { RunSurfaceAttachment, RunSurfaceEvent };
