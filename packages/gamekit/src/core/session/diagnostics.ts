/**
 * Internal performance diagnostics sink.
 *
 * The session calls these hooks only when a sink is supplied through the
 * testing seam. Production sessions pass no sink and pay only a `?.` check per
 * hook. This is intentionally NOT a public diagnostics API: its usefulness is
 * being proven by the playground Performance Lab before any public contract.
 */
export interface SessionDiagnostics {
  /** A presentation callback was delivered by the frame driver. */
  onDisplayCallback(): void;
  /** A display callback that ran zero simulation steps. */
  onZeroStepCallback(): void;
  /** A fixed simulation step ran. */
  onFixedStep(): void;
  /** A catch-up step (second or later in the same callback) ran. */
  onCatchUpStep(): void;
  /** Whole-step debt dropped after the catch-up cap, in steps. */
  onDroppedDebt(steps: number): void;
  /** Duration of one scene update, milliseconds. */
  onUpdate(durationMs: number): void;
  /** Duration of one input sample, milliseconds. */
  onInputSample(durationMs: number): void;
  /** Duration of one snapshot extraction, milliseconds. */
  onSnapshot(durationMs: number): void;
  /** Duration of one deep-freeze pass, milliseconds. */
  onDeepFreeze(durationMs: number): void;
  /** Duration of one publish (listener fan-out), milliseconds. */
  onPublish(durationMs: number): void;
  /** A render frame was published to listeners. */
  onCommitNotification(): void;
  /** Listener count at publish time. */
  onListenerCount(count: number): void;
}

/** Default sink that does nothing; the zero-overhead production path. */
export const NOOP_DIAGNOSTICS: SessionDiagnostics = {
  onDisplayCallback() {},
  onZeroStepCallback() {},
  onFixedStep() {},
  onCatchUpStep() {},
  onDroppedDebt() {},
  onUpdate() {},
  onInputSample() {},
  onSnapshot() {},
  onDeepFreeze() {},
  onPublish() {},
  onCommitNotification() {},
  onListenerCount() {},
};
