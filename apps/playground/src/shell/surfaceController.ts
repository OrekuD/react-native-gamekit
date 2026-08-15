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
import type { GameRendererProps } from 'rn-gamekit/react';

import type { PlaygroundGameContentProps } from './PlaygroundGameContentProps.ts';
import {
  neutralSlot,
  reduceSurfaceState,
  type RunSurfaceAttachment,
  type RunSurfaceEvent,
  type SlotAssets,
  type SurfaceEvent,
  type SurfaceSlot,
} from './surfaceSlot.ts';

/** One catalogued game: how the controller opens, renders, and binds it. */
export interface SurfaceGameEntry {
  readonly renderer: ComponentType<GameRendererProps<never>>;
  readonly content: ComponentType<PlaygroundGameContentProps>;
  /** Create the fresh gameplay session for one open request. */
  readonly createSession: () => GameSession;
  /** Whether the pointer surface is enabled for this game's session. */
  readonly pointer: boolean;
  /**
   * The declared pointer action the shell's GamePointerInput binds.
   * Defaults to `primary` (the reference-game convention).
   */
  readonly pointerAction?: string;
  /** Asset-backed games publish a loading slot and wait for asset-ready. */
  readonly assetBacked?: boolean;
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
    if (entry.assetBacked === true) {
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
    this.publish({
      kind: 'open-ready',
      requestId,
      generation,
      gameId,
      session: entry.createSession(),
      renderer: entry.renderer,
      content: entry.content as unknown as ComponentType<{ readonly game: GameSession }>,
      pointer: entry.pointer,
    });
  }

  /** Close the active game: pause it, publish the neutral Home binding. */
  close(): void {
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
    this.publish({
      kind: 'asset-ready',
      requestId,
      generation: this.allocateGeneration(),
      session: entry.createSession(),
      assets,
    });
  }

  /** Performance Lab attach/detach, valid only for the active lab request. */
  runEvent(event: RunSurfaceEvent): void {
    if (this.slot.gameId !== LAB_GAME_ID || this.slot.status !== 'ready') {
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
    for (const session of new Set(owned)) {
      this.options.disposeSession(session);
    }
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
    for (const session of reduction.disposable) {
      this.options.disposeSession(session);
    }
  }
}

export type { RunSurfaceAttachment, RunSurfaceEvent };
