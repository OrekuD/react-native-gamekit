/**
 * Multitouch button-pad controller (headless).
 *
 * Maps every active pointer to the button zone it covers and turns touch
 * transitions into press/release diffs for a session input buffer. Pure and
 * React-free: the React surface (`GameButtonPad`) only registers zone rects,
 * feeds touch lists in, and applies the returned diffs to
 * `session.input`.
 *
 * Semantics:
 * - A zone is a rectangle; an optional global hit slop expands it.
 * - Each pointer maps to AT MOST one action (first registered zone wins).
 * - An action is pressed while ANY pointer covers its zone (refcounted);
 *   it releases when the last pointer leaves or lifts. Edges fire only on
 *   0-to-1 (press) and 1-to-0 (release) owner transitions — a second owner
 *   never re-presses and an unbalanced release never emits.
 * - Sliding between zones reassigns the pointer: release + press diff.
 * - Moves acquire: a pointer that begins in empty space and slides into a
 *   zone presses it; leaving a zone releases. Every touch in a move list
 *   is hit-tested, mapped or not.
 * - Zone rects are cloned at registration: later caller mutation of the
 *   passed object cannot alter hit areas invisibly.
 */

/** A rectangular hit area, in the pad's local coordinate space. */
export interface ButtonPadRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One active pointer sample. */
export interface ButtonPadTouch {
  /** Native pointer id; stable for the lifetime of one touch. */
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Press/release transitions derived from one touch event. */
export interface ButtonPadDiff {
  /** Actions that transitioned to held. */
  readonly pressed: readonly string[];
  /** Actions that transitioned to released. */
  readonly released: readonly string[];
}

const EMPTY_DIFF: ButtonPadDiff = { pressed: [], released: [] };

function contains(
  rect: ButtonPadRect,
  hitSlop: number,
  x: number,
  y: number,
): boolean {
  return (
    x >= rect.x - hitSlop &&
    x <= rect.x + rect.width + hitSlop &&
    y >= rect.y - hitSlop &&
    y <= rect.y + rect.height + hitSlop
  );
}

/** Create a controller bound to no particular session (diffs are applied by the caller). */
export function createButtonPadController(options?: { readonly hitSlop?: number }): {
  setZone(action: string, rect: ButtonPadRect): void;
  removeZone(action: string): readonly string[];
  touchesDown(touches: readonly ButtonPadTouch[]): ButtonPadDiff;
  touchesMove(touches: readonly ButtonPadTouch[]): ButtonPadDiff;
  touchesUp(changed: readonly ButtonPadTouch[]): ButtonPadDiff;
  touchesCancel(changed: readonly ButtonPadTouch[]): ButtonPadDiff;
  releaseAll(): readonly string[];
  invalidateOwnership(): void;
  held(): readonly string[];
} {
  const hitSlop = options?.hitSlop ?? 0;
  const zones = new Map<string, ButtonPadRect>();
  const pointerAction = new Map<number, string>();
  const holdCounts = new Map<string, number>();
  // GS-INPUT-04: pointers that were active across an invalidation (pause,
  // session replacement) must produce a fresh down before their moves can
  // acquire again. A fresh down rehabilitates; lift clears the mark.
  const stalePointerIds = new Set<number>();

  const apply = (action: string, direction: 1 | -1): 'pressed' | 'released' | undefined => {
    // GS-INPUT-02: edges fire only on ownership transitions. A second owner
    // (0 stays > 0) never re-presses; an unbalanced release from zero
    // count never emits.
    const previous = holdCounts.get(action) ?? 0;
    const next = previous + direction;
    if (next <= 0) {
      holdCounts.delete(action);
      return previous > 0 && direction === -1 ? 'released' : undefined;
    }
    holdCounts.set(action, next);
    return previous === 0 && direction === 1 ? 'pressed' : undefined;
  };

  const hitTest = (x: number, y: number): string | undefined => {
    for (const [action, rect] of zones) {
      if (contains(rect, hitSlop, x, y)) {
        return action;
      }
    }
    return undefined;
  };

  const retarget = (touchId: number, action: string | undefined): ButtonPadDiff => {
    const previous = pointerAction.get(touchId);
    if (previous === action) {
      return EMPTY_DIFF;
    }
    const pressed: string[] = [];
    const released: string[] = [];
    if (previous !== undefined) {
      pointerAction.delete(touchId);
      const result = apply(previous, -1);
      if (result === 'released') {
        released.push(previous);
      }
    }
    if (action !== undefined) {
      pointerAction.set(touchId, action);
      const result = apply(action, 1);
      if (result === 'pressed') {
        pressed.push(action);
      }
    }
    return { pressed, released };
  };

  const dropPointers = (changed: readonly ButtonPadTouch[]): ButtonPadDiff => {
    const released: string[] = [];
    for (const touch of changed) {
      stalePointerIds.delete(touch.id);
      const previous = pointerAction.get(touch.id);
      if (previous === undefined) {
        continue;
      }
      pointerAction.delete(touch.id);
      if (apply(previous, -1) === 'released') {
        released.push(previous);
      }
    }
    return { pressed: [], released };
  };

  return {
    setZone(action: string, rect: ButtonPadRect): void {
      // GS-INPUT-02: clone the rect so later caller mutation of the passed
      // object cannot alter hit areas invisibly.
      zones.set(action, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    },
    removeZone(action: string): readonly string[] {
      zones.delete(action);
      // GS-INPUT-02: drop every pointer mapped to the removed zone, then
      // release and delete the ENTIRE action count — a single decrement
      // would strand a phantom hold. Pointers stay physically tracked only
      // through future touch events, which re-acquire via hit test.
      for (const [pointerId, mapped] of [...pointerAction]) {
        if (mapped === action) {
          pointerAction.delete(pointerId);
        }
      }
      if ((holdCounts.get(action) ?? 0) > 0) {
        holdCounts.delete(action);
        return [action];
      }
      return [];
    },
    touchesDown(touches: readonly ButtonPadTouch[]): ButtonPadDiff {
      const merged: { pressed: string[]; released: string[] } = { pressed: [], released: [] };
      for (const touch of touches) {
        stalePointerIds.delete(touch.id);
        const diff = retarget(touch.id, hitTest(touch.x, touch.y));
        merged.pressed.push(...diff.pressed);
        merged.released.push(...diff.released);
      }
      return merged;
    },
    touchesMove(touches: readonly ButtonPadTouch[]): ButtonPadDiff {
      // GS-INPUT-02: every touch in the move list is hit-tested, mapped or
      // not — a pointer that left its zone releases, and one that entered
      // a zone (including from empty space) presses it.
      // GS-INPUT-04: pointers marked stale by an invalidation wait for a
      // fresh down first.
      const merged: { pressed: string[]; released: string[] } = { pressed: [], released: [] };
      for (const touch of touches) {
        if (stalePointerIds.has(touch.id)) {
          continue;
        }
        const diff = retarget(touch.id, hitTest(touch.x, touch.y));
        merged.pressed.push(...diff.pressed);
        merged.released.push(...diff.released);
      }
      return merged;
    },
    touchesUp(changed: readonly ButtonPadTouch[]): ButtonPadDiff {
      return dropPointers(changed);
    },
    touchesCancel(changed: readonly ButtonPadTouch[]): ButtonPadDiff {
      return dropPointers(changed);
    },
    releaseAll(): readonly string[] {
      const released = new Set<string>();
      for (const action of pointerAction.values()) {
        released.add(action);
      }
      pointerAction.clear();
      for (const action of holdCounts.keys()) {
        released.add(action);
      }
      holdCounts.clear();
      stalePointerIds.clear();
      return [...released];
    },
    /**
     * GS-INPUT-04: invalidate ownership without touching zones — pause,
     * session replacement, or layout teardown snapshot the active pointers
     * as stale and drop all holds. Stale pointers must produce a fresh down
     * before their moves can acquire again; a fresh down rehabilitates.
     */
    invalidateOwnership(): void {
      for (const pointerId of pointerAction.keys()) {
        stalePointerIds.add(pointerId);
      }
      pointerAction.clear();
      holdCounts.clear();
    },
    held(): readonly string[] {
      return [...holdCounts.keys()];
    },
  };
}
