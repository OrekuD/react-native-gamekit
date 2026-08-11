/**
 * Pure surface-slot transitions (RF3/RF1).
 *
 * The shell's persistent surface binds everything — renderer, content,
 * pointer, assets, session, and generation — through one immutable slot.
 * These pure functions construct the two legal transitions (loading slot
 * and ready slot) and the retirement list, so the ownership and atomicity
 * rules are testable headlessly.
 */
import type { ComponentType } from 'react';
import type { GameSession } from 'react-native-gamekit';
import type { GameRendererProps } from 'react-native-gamekit/react';

/** The opaque shape the surface slot needs from a loaded lease. */
export interface SlotAssets {
  readonly descriptor: unknown;
}

/** One immutable surface slot (RF2/RF3). */
export interface SurfaceSlot {
  readonly generation: number;
  readonly gameId: string;
  readonly status: 'loading' | 'ready';
  readonly session: GameSession;
  readonly renderer: ComponentType<GameRendererProps<never>>;
  readonly content: ComponentType<{ readonly game: GameSession }>;
  readonly assets?: SlotAssets;
  readonly pointer: boolean;
  /** Sessions retired by this slot's construction, disposed after commit. */
  readonly retiring: readonly GameSession[];
}

export interface SlotContentEntry {
  readonly renderer: ComponentType<GameRendererProps<never>>;
  readonly content: ComponentType<{ readonly game: GameSession }>;
}

/** A fresh loading slot: neutral canvas session, pointer disabled. */
export function loadingSlotFor(
  gameId: string,
  session: GameSession,
  entry: SlotContentEntry,
  retiring: readonly GameSession[] = [],
): SurfaceSlot {
  return {
    generation: 0,
    gameId,
    status: 'loading',
    session,
    renderer: entry.renderer,
    content: entry.content,
    pointer: false,
    retiring,
  };
}

/**
 * Publish the ready slot in ONE transition: the real session and the exact
 * lease arrive together, the previous session joins the retiring set, the
 * pointer activates, and the generation advances.
 */
export function publishReadySlot(
  previous: SurfaceSlot,
  session: GameSession,
  assets: SlotAssets,
): SurfaceSlot {
  return {
    generation: previous.generation + 1,
    gameId: previous.gameId,
    status: 'ready',
    session,
    renderer: previous.renderer,
    content: previous.content,
    assets,
    pointer: true,
    retiring: [previous.session, ...previous.retiring],
  };
}

/** True when the slot is ready and references the given session. */
export function slotReadyWith(slot: SurfaceSlot, session: GameSession): boolean {
  return slot.status === 'ready' && slot.session === session && slot.assets !== undefined && slot.pointer;
}

/** The session set currently owned (live + retiring); bounded by the rules. */
export function ownedSessions(slot: SurfaceSlot): readonly GameSession[] {
  return [slot.session, ...slot.retiring];
}
