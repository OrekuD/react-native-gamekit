import type { SessionDiagnostics } from '../../src/core/session/diagnostics';

/**
 * Diagnostics sink that records status-listener registration/removal counts.
 * All other hooks are no-ops (the disabled-path contract requires no timing
 * reads when a sink is present, but the lab's full implementation is not
 * needed for control-plane counting).
 */
export function statusCountDiagnostics(): {
  readonly diagnostics: SessionDiagnostics;
  readonly counts: number[];
} {
  const counts: number[] = [];
  const noop = (): void => {};
  const diagnostics: SessionDiagnostics = {
    onDisplayCallback: noop,
    onZeroStepCallback: noop,
    onFixedStep: noop,
    onCatchUpStep: noop,
    onDroppedDebt: noop,
    onUpdate: noop,
    onInputSample: noop,
    onSnapshot: noop,
    onDeepFreeze: noop,
    onPublish: noop,
    onCommitNotification: noop,
    onListenerCount: noop,
    onStatusListenerCount: (count) => counts.push(count),
  };
  return { diagnostics, counts };
}
