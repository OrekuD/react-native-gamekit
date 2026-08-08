/**
 * Commit-frequency HUD observer (T9).
 *
 * The observer runs the selector on every commit (it must, to detect
 * changes) but requests a state update only when the selected value actually
 * changed. React therefore enqueues nothing for unchanged commits, and HUD
 * React renders equal actual HUD value changes. The observer is pure so
 * selector-call and update-request counts are testable headlessly.
 */

export interface HudObserver<TFrame, T> {
  /** The last accepted selection. */
  readonly value: T;
  /** Run the selector over a commit; returns whether a state update is due. */
  observe(frame: TFrame): boolean;
}

export function createHudObserver<TFrame, T>(
  select: (frame: TFrame) => T,
  equals: (a: T, b: T) => boolean,
  initial: T,
): HudObserver<TFrame, T> {
  let value = initial;
  return {
    get value() {
      return value;
    },
    observe(frame) {
      const next = select(frame);
      if (equals(value, next)) {
        return false;
      }
      value = next;
      return true;
    },
  };
}
