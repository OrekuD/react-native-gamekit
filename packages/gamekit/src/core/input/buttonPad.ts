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
 *   it releases when the last pointer leaves or lifts.
 * - Sliding between zones reassigns the pointer: release + press diff.
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
  held(): readonly string[];
} {
  const hitSlop = options?.hitSlop ?? 0;
  const zones = new Map<string, ButtonPadRect>();
  const pointerAction = new Map<number, string>();
  const holdCounts = new Map<string, number>();

  const apply = (action: string, direction: 1 | -1): 'pressed' | 'released' | undefined => {
    const next = (holdCounts.get(action) ?? 0) + direction;
    if (next > 0) {
      holdCounts.set(action, next);
      return direction === 1 ? 'pressed' : undefined;
    }
    holdCounts.delete(action);
    return direction === -1 ? 'released' : undefined;
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
      zones.set(action, rect);
    },
    removeZone(action: string): readonly string[] {
      zones.delete(action);
      // Any pointer still mapped to the removed zone releases immediately.
      const released: string[] = [];
      for (const [pointerId, mapped] of [...pointerAction]) {
        if (mapped === action) {
          pointerAction.delete(pointerId);
        }
      }
      if (apply(action, -1) === 'released') {
        released.push(action);
      }
      return released;
    },
    touchesDown(touches: readonly ButtonPadTouch[]): ButtonPadDiff {
      const merged: { pressed: string[]; released: string[] } = { pressed: [], released: [] };
      for (const touch of touches) {
        const diff = retarget(touch.id, hitTest(touch.x, touch.y));
        merged.pressed.push(...diff.pressed);
        merged.released.push(...diff.released);
      }
      return merged;
    },
    touchesMove(touches: readonly ButtonPadTouch[]): ButtonPadDiff {
      const merged: { pressed: string[]; released: string[] } = { pressed: [], released: [] };
      for (const touch of touches) {
        const held = pointerAction.get(touch.id);
        if (held === undefined) {
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
      return [...released];
    },
    held(): readonly string[] {
      return [...holdCounts.keys()];
    },
  };
}
