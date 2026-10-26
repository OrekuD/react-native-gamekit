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
 * - Moves acquire only after a down: a pointer that begins in empty space
 *   and slides into a zone presses it; leaving a zone releases. Invalidation
 *   drops physical ownership, so a fresh down is required afterwards.
 * - Each touch list is one atomic event. Swapping fingers between held
 *   zones does not synthesize a release or press for either action.
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

const EMPTY_DIFF: ButtonPadDiff = Object.freeze({ pressed: Object.freeze([]), released: Object.freeze([]) });

function assertHitSlop(hitSlop: number): void {
  if (!Number.isFinite(hitSlop) || hitSlop < 0) {
    throw new TypeError('Button pad hitSlop must be finite and non-negative');
  }
}

function assertRect(rect: ButtonPadRect, hitSlop: number): void {
  if (
    !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
    rect.width < 0 || rect.height < 0 ||
    !Number.isFinite(rect.x - hitSlop) || !Number.isFinite(rect.y - hitSlop) ||
    !Number.isFinite(rect.x + rect.width + hitSlop) || !Number.isFinite(rect.y + rect.height + hitSlop)
  ) {
    throw new TypeError('Button pad rect must have finite bounds and non-negative dimensions');
  }
}

function assertTouches(touches: readonly ButtonPadTouch[], positions: boolean): void {
  for (const touch of touches) {
    if (!Number.isFinite(touch.id) || (positions && (!Number.isFinite(touch.x) || !Number.isFinite(touch.y)))) {
      throw new TypeError('Button pad touch ids and positions must be finite');
    }
  }
}

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
  setHitSlop(hitSlop: number): void;
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
  let hitSlop = options?.hitSlop ?? 0;
  assertHitSlop(hitSlop);
  const zones = new Map<string, ButtonPadRect>();
  // A present key records a physical down even while its pointer is in a
  // gap or its zone is removed. Clearing this map retires all old fingers.
  const pointerAction = new Map<number, string | undefined>();
  const holdCounts = new Map<string, number>();

  const applyCount = (action: string, direction: 1 | -1, previousCounts: Map<string, number>): void => {
    const previous = holdCounts.get(action) ?? 0;
    if (!previousCounts.has(action)) previousCounts.set(action, previous);
    const next = previous + direction;
    if (next === 0) holdCounts.delete(action);
    else holdCounts.set(action, next);
  };

  const hitTest = (x: number, y: number): string | undefined => {
    for (const [action, rect] of zones) {
      if (contains(rect, hitSlop, x, y)) {
        return action;
      }
    }
    return undefined;
  };

  const retarget = (
    touchId: number,
    action: string | undefined,
    previousCounts: Map<string, number> | undefined,
  ): Map<string, number> | undefined => {
    const previous = pointerAction.get(touchId);
    pointerAction.set(touchId, action);
    if (previous === action) return previousCounts;
    const counts = previousCounts ?? new Map<string, number>();
    if (previous !== undefined) applyCount(previous, -1, counts);
    if (action !== undefined) applyCount(action, 1, counts);
    return counts;
  };

  const finishDiff = (previousCounts: Map<string, number> | undefined): ButtonPadDiff => {
    if (previousCounts === undefined) return EMPTY_DIFF;
    const pressed: string[] = [];
    const released: string[] = [];
    for (const [action, previous] of previousCounts) {
      const current = holdCounts.get(action) ?? 0;
      if (previous === 0 && current > 0) pressed.push(action);
      if (previous > 0 && current === 0) released.push(action);
    }
    return { pressed, released };
  };

  const updatePointers = (touches: readonly ButtonPadTouch[], down: boolean): ButtonPadDiff => {
    assertTouches(touches, true);
    let previousCounts: Map<string, number> | undefined;
    for (const touch of touches) {
      if (!down && !pointerAction.has(touch.id)) continue;
      previousCounts = retarget(touch.id, hitTest(touch.x, touch.y), previousCounts);
    }
    return finishDiff(previousCounts);
  };

  const dropPointers = (changed: readonly ButtonPadTouch[]): ButtonPadDiff => {
    // Terminal coordinates are irrelevant: an invalid location must not
    // strand ownership. Validate all ids before applying any terminal edge.
    assertTouches(changed, false);
    let previousCounts: Map<string, number> | undefined;
    for (const touch of changed) {
      previousCounts = retarget(touch.id, undefined, previousCounts);
      pointerAction.delete(touch.id);
    }
    return finishDiff(previousCounts);
  };

  return {
    setHitSlop(nextHitSlop: number): void {
      assertHitSlop(nextHitSlop);
      for (const rect of zones.values()) assertRect(rect, nextHitSlop);
      hitSlop = nextHitSlop;
    },
    setZone(action: string, rect: ButtonPadRect): void {
      // GS-INPUT-02: clone the rect so later caller mutation of the passed
      // object cannot alter hit areas invisibly.
      const registered = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      assertRect(registered, hitSlop);
      zones.set(action, registered);
    },
    removeZone(action: string): readonly string[] {
      zones.delete(action);
      // Retain physical down ownership independently from the removed zone.
      for (const [pointerId, mapped] of pointerAction) {
        if (mapped === action) {
          pointerAction.set(pointerId, undefined);
        }
      }
      if ((holdCounts.get(action) ?? 0) > 0) {
        holdCounts.delete(action);
        return [action];
      }
      return [];
    },
    touchesDown(touches: readonly ButtonPadTouch[]): ButtonPadDiff {
      return updatePointers(touches, true);
    },
    touchesMove(touches: readonly ButtonPadTouch[]): ButtonPadDiff {
      return updatePointers(touches, false);
    },
    touchesUp(changed: readonly ButtonPadTouch[]): ButtonPadDiff {
      return dropPointers(changed);
    },
    touchesCancel(changed: readonly ButtonPadTouch[]): ButtonPadDiff {
      return dropPointers(changed);
    },
    releaseAll(): readonly string[] {
      const released = [...holdCounts.keys()];
      pointerAction.clear();
      holdCounts.clear();
      return released;
    },
    /**
     * GS-INPUT-04: invalidate ownership without touching zones — pause,
     * session replacement, or layout teardown drop all physical downs and
     * holds. Moves cannot acquire again until a fresh down is received.
     */
    invalidateOwnership(): void {
      pointerAction.clear();
      holdCounts.clear();
    },
    held(): readonly string[] {
      return [...holdCounts.keys()];
    },
  };
}
