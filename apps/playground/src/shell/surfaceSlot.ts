/**
 * Canonical playground surface state (Task 8).
 *
 * One immutable slot is the only binding unit for the persistent game
 * surface: request id, binding generation, game id, status, session,
 * renderer, content, assets, pointer, run attachment, and retirement
 * records all publish together. The pure transitions below are the ONLY
 * transitions the production shell applies; the headless tests drive the
 * exact same functions.
 *
 * Identity rules (T8.2):
 * - `requestId`: one user open action — unique for the shell lifetime;
 * - `generation`: one concrete published binding — unique for the surface
 *   lifetime (neutral, loading, ready, and run-session bindings alike);
 * - `gameId`: the catalog entry — may repeat.
 * No identity is derived from another.
 *
 * Retirement (T8.4): a session replaced by a new binding is retained in the
 * slot's `retiring` list until `binding-committed` acknowledges the
 * generation that replaced it. Only then is it disposable — exactly once.
 */
import type { ComponentType } from 'react';
import type { GameSession } from 'rn-gamekit';
import type { GameCamera2DDefinition, GameRendererProps } from 'rn-gamekit/react';

export type SurfaceStatus = 'neutral' | 'loading' | 'ready';

/** The opaque lease shape the surface slot carries (RF3). */
export interface SlotAssets {
  readonly descriptor: unknown;
}

/** One session awaiting its replacement binding's commit. */
export interface RetirementRecord {
  readonly session: GameSession;
  /** The generation whose committed binding makes this session disposable. */
  readonly retiredByGeneration: number;
}

/** A Performance Lab run attachment: session + the instrumentation bound to it. */
export interface RunSurfaceAttachment {
  readonly session: GameSession;
  readonly pointer: import('rn-gamekit/react').GamePointerInstrumentation;
  readonly view: import('rn-gamekit/react').GameViewInstrumentation;
}

/** An explicit ownership transfer between a lab host and the shell. */
export type RunSurfaceEvent =
  | { readonly kind: 'attach'; readonly attachment: RunSurfaceAttachment }
  | { readonly kind: 'detach'; readonly session: GameSession }
  | {
      readonly kind: 'instrumentation-attached';
      readonly session: GameSession;
      readonly instrumentation: SurfaceInstrumentation;
    }
  | { readonly kind: 'instrumentation-detached'; readonly session: GameSession };

/** An instrumentation-only pair bound to a ready gameplay binding (T12-RF1):
 * it shares the base session and never retires, pauses, replaces, or
 * disposes it. */
export interface SurfaceInstrumentation {
  readonly pointer: import('rn-gamekit/react').GamePointerInstrumentation;
  readonly view: import('rn-gamekit/react').GameViewInstrumentation;
}

/** One immutable surface binding (T8.3). */
export interface SurfaceSlot {
  /** The user open request this slot belongs to; 0 while Home is shown. */
  readonly requestId: number;
  /** The concrete published binding; globally unique for the surface lifetime. */
  readonly generation: number;
  /** The catalog game id, or null for the neutral/Home binding. */
  readonly gameId: string | null;
  readonly status: SurfaceStatus;
  /** The neutral singleton while neutral; a placeholder while loading; the
   * real gameplay session when ready. */
  readonly session: GameSession;
  readonly renderer: ComponentType<GameRendererProps<never>>;
  /** Game content; absent for the neutral binding (Home covers the surface). */
  readonly content?: ComponentType<{ readonly game: GameSession }>;
  /** Present exactly when ready: the exact lease the renderer borrows. */
  readonly assets?: SlotAssets;
  /** Pointer active only when a real session is published. */
  readonly pointer: boolean;
  /** The declared pointer action the shell's GamePointerInput binds
   * (SurfaceGameEntry.pointerAction); reference games default to `primary`. */
  readonly pointerAction?: string;
  /**
   * The catalogued camera definition (T12-F1), present only for ready
   * gameplay bindings whose frames carry the authored camera. Neutral and
   * placeholder/loading slots never carry one.
   */
  readonly camera2D?: GameCamera2DDefinition<never>;
  /** The lab run attachment currently bound (perf-lab only). */
  readonly run?: RunSurfaceAttachment;
  /** Instrumentation-only pair for the ready gameplay binding (T12-RF1). */
  readonly instrumentation?: SurfaceInstrumentation;
  /** Sessions superseded by this or earlier bindings, awaiting the commit. */
  readonly retiring: readonly RetirementRecord[];
}

export type SurfaceEvent =
  | {
      readonly kind: 'open-ready';
      readonly requestId: number;
      readonly generation: number;
      readonly gameId: string;
      readonly session: GameSession;
      readonly renderer: ComponentType<GameRendererProps<never>>;
      readonly content?: ComponentType<{ readonly game: GameSession }>;
      readonly pointer: boolean;
      /** The declared pointer action the shell's GamePointerInput binds. */
      readonly pointerAction?: string;
      readonly camera2D?: GameCamera2DDefinition<never>;
    }
  | {
      readonly kind: 'open-loading';
      readonly requestId: number;
      readonly generation: number;
      readonly gameId: string;
      readonly session: GameSession;
      readonly renderer: ComponentType<GameRendererProps<never>>;
      readonly content?: ComponentType<{ readonly game: GameSession }>;
    }
  | {
      readonly kind: 'asset-ready';
      readonly requestId: number;
      readonly generation: number;
      readonly session: GameSession;
      readonly assets: SlotAssets;
      readonly camera2D?: GameCamera2DDefinition<never>;
    }
  | {
      readonly kind: 'close';
      readonly generation: number;
      readonly neutralSession: GameSession;
      readonly neutralRenderer: ComponentType<GameRendererProps<never>>;
    }
  | {
      readonly kind: 'run-attached';
      readonly generation: number;
      readonly attachment: RunSurfaceAttachment;
    }
  | {
      readonly kind: 'run-detached';
      readonly generation: number;
      readonly session: GameSession;
    }
  | { readonly kind: 'binding-committed'; readonly generation: number };

/** The result of one transition: the next slot plus now-disposable sessions. */
export interface SurfaceReduction {
  readonly slot: SurfaceSlot;
  /** Sessions whose replacement binding has committed; dispose exactly once. */
  readonly disposable: readonly GameSession[];
}

/** The Home binding: stable neutral session, no content, no pointer. */
export function neutralSlot(
  generation: number,
  session: GameSession,
  renderer: ComponentType<GameRendererProps<never>>,
): SurfaceSlot {
  return {
    requestId: 0,
    generation,
    gameId: null,
    status: 'neutral',
    session,
    renderer,
    content: undefined,
    assets: undefined,
    pointer: false,
    run: undefined,
    retiring: [],
  };
}

/**
 * The sessions a navigation/readiness/close transition retires: the current
 * base session (never the neutral singleton) and the current run session,
 * deduplicated against the records already held, stamped with the replacing
 * generation.
 */
function retireReplaced(
  state: SurfaceSlot,
  generation: number,
): readonly RetirementRecord[] {
  const replaced: GameSession[] = [];
  if (state.status !== 'neutral') {
    replaced.push(state.session);
  }
  if (state.run !== undefined) {
    replaced.push(state.run.session);
  }
  return stampRetiring(state, generation, replaced);
}

/** Run-only retirement: swapping or detaching a run never retires the base. */
function retireRunOnly(
  state: SurfaceSlot,
  generation: number,
): readonly RetirementRecord[] {
  if (state.run === undefined) {
    return state.retiring;
  }
  return stampRetiring(state, generation, [state.run.session]);
}

function stampRetiring(
  state: SurfaceSlot,
  generation: number,
  replaced: readonly GameSession[],
): readonly RetirementRecord[] {
  const records = [...state.retiring];
  for (const session of replaced) {
    if (!records.some((record) => record.session === session)) {
      records.push({ session, retiredByGeneration: generation });
    }
  }
  return records;
}

function reduceOpenReady(state: SurfaceSlot, event: Extract<SurfaceEvent, { kind: 'open-ready' }>): SurfaceReduction {
  return {
    slot: {
      requestId: event.requestId,
      generation: event.generation,
      gameId: event.gameId,
      status: 'ready',
      session: event.session,
      renderer: event.renderer,
      content: event.content,
      assets: undefined,
      pointer: event.pointer,
      pointerAction: event.pointerAction,
      camera2D: event.camera2D,
      run: undefined,
      retiring: retireReplaced(state, event.generation),
    },
    disposable: [],
  };
}

function reduceOpenLoading(state: SurfaceSlot, event: Extract<SurfaceEvent, { kind: 'open-loading' }>): SurfaceReduction {
  return {
    slot: {
      requestId: event.requestId,
      generation: event.generation,
      gameId: event.gameId,
      status: 'loading',
      session: event.session,
      renderer: event.renderer,
      content: event.content,
      assets: undefined,
      pointer: false,
      run: undefined,
      retiring: retireReplaced(state, event.generation),
    },
    disposable: [],
  };
}

function reduceAssetReady(state: SurfaceSlot, event: Extract<SurfaceEvent, { kind: 'asset-ready' }>): SurfaceReduction {
  // Stale readiness (superseded request) or a slot that is not loading can
  // never replace the current binding.
  if (event.requestId !== state.requestId || state.status !== 'loading') {
    return { slot: state, disposable: [] };
  }
  return {
    slot: {
      ...state,
      generation: event.generation,
      status: 'ready',
      session: event.session,
      assets: event.assets,
      pointer: true,
      camera2D: event.camera2D,
      retiring: retireReplaced(state, event.generation),
    },
    disposable: [],
  };
}

function reduceClose(state: SurfaceSlot, event: Extract<SurfaceEvent, { kind: 'close' }>): SurfaceReduction {
  if (state.status === 'neutral') {
    return { slot: state, disposable: [] };
  }
  return {
    slot: {
      requestId: 0,
      generation: event.generation,
      gameId: null,
      status: 'neutral',
      session: event.neutralSession,
      renderer: event.neutralRenderer,
      content: undefined,
      assets: undefined,
      pointer: false,
      run: undefined,
      retiring: retireReplaced(state, event.generation),
    },
    disposable: [],
  };
}

function reduceInstrumentationAttached(
  state: SurfaceSlot,
  event: Extract<RunSurfaceEvent, { kind: 'instrumentation-attached' }>,
): SurfaceReduction {
  // T12-RF1: instrumentation-only attachment shares the base session. It
  // must match the CURRENT ready binding exactly; a stale instance from a
  // closed/reopened or superseded Camera Lab is rejected. Nothing here
  // retires, pauses, replaces, or disposes the session.
  if (state.status !== 'ready' || state.session !== event.session) {
    return { slot: state, disposable: [] };
  }
  return { slot: { ...state, instrumentation: event.instrumentation }, disposable: [] };
}

function reduceInstrumentationDetached(
  state: SurfaceSlot,
  event: Extract<RunSurfaceEvent, { kind: 'instrumentation-detached' }>,
): SurfaceReduction {
  if (state.session !== event.session) {
    return { slot: state, disposable: [] };
  }
  return { slot: { ...state, instrumentation: undefined }, disposable: [] };
}

function reduceRunAttached(state: SurfaceSlot, event: Extract<SurfaceEvent, { kind: 'run-attached' }>): SurfaceReduction {
  if (state.run?.session === event.attachment.session) {
    return { slot: state, disposable: [] };
  }
  return {
    slot: {
      ...state,
      generation: event.generation,
      run: event.attachment,
      retiring: retireRunOnly(state, event.generation),
    },
    disposable: [],
  };
}

function reduceRunDetached(state: SurfaceSlot, event: Extract<SurfaceEvent, { kind: 'run-detached' }>): SurfaceReduction {
  // Unknown or already-retired sessions are a no-op.
  if (state.run?.session !== event.session) {
    return { slot: state, disposable: [] };
  }
  return {
    slot: {
      ...state,
      generation: event.generation,
      run: undefined,
      retiring: retireRunOnly(state, event.generation),
    },
    disposable: [],
  };
}

function reduceBindingCommitted(state: SurfaceSlot, event: Extract<SurfaceEvent, { kind: 'binding-committed' }>): SurfaceReduction {
  const disposable = state.retiring.filter(
    (record) => record.retiredByGeneration <= event.generation,
  );
  if (disposable.length === 0) {
    return { slot: state, disposable: [] };
  }
  const remaining = state.retiring.filter(
    (record) => record.retiredByGeneration > event.generation,
  );
  return {
    slot: { ...state, retiring: remaining },
    disposable: disposable.map((record) => record.session),
  };
}

/** Apply one pure transition; the only path a slot may change. */
export function reduceSurfaceState(
  state: SurfaceSlot,
  event: SurfaceEvent | RunSurfaceEvent,
): SurfaceReduction {
  switch (event.kind) {
    case 'open-ready':
      return reduceOpenReady(state, event);
    case 'open-loading':
      return reduceOpenLoading(state, event);
    case 'asset-ready':
      return reduceAssetReady(state, event);
    case 'close':
      return reduceClose(state, event);
    case 'run-attached':
      return reduceRunAttached(state, event);
    case 'run-detached':
      return reduceRunDetached(state, event);
    case 'instrumentation-attached':
      return reduceInstrumentationAttached(state, event);
    case 'instrumentation-detached':
      return reduceInstrumentationDetached(state, event);
    case 'binding-committed':
      return reduceBindingCommitted(state, event);
    default:
      return { slot: state, disposable: [] };
  }
}

const IS_DEV =
  typeof __DEV__ !== 'undefined'
    ? __DEV__
    : typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

/** What the persistent surface renders for one slot: one coherent tuple. */
export interface SurfaceBinding {
  readonly game: GameSession;
  readonly assets: SlotAssets | undefined;
  readonly pointerGame: GameSession;
  readonly pointerEnabled: boolean;
  /** The camera definition for the published gameplay binding (T12-F1). */
  readonly camera2D: GameCamera2DDefinition<never> | undefined;
  /** The instrumentation pair for the published binding (T12-RF1). */
  readonly instrumentation: SurfaceInstrumentation | undefined;
}

/**
 * The single derivation every surface consumer binds from (T8.6). In
 * development it fails close to the binding site if a ready surface would
 * publish a disposed session — the disposed-state exception stays strict and
 * the invalid ownership is made impossible rather than caught.
 */
export function effectiveBinding(slot: SurfaceSlot): SurfaceBinding {
  if (
    IS_DEV &&
    slot.status === 'ready' &&
    slot.session.status === 'disposed'
  ) {
    throw new Error(
      `[surface] disposed session bound at generation ${slot.generation} ` +
        `(request ${slot.requestId}, game ${String(slot.gameId)})`,
    );
  }
  const game = slot.run?.session ?? slot.session;
  return {
    game,
    assets: slot.assets,
    pointerGame: game,
    pointerEnabled: slot.pointer && game.status !== 'disposed',
    camera2D: slot.camera2D,
    instrumentation: slot.instrumentation,
  };
}
