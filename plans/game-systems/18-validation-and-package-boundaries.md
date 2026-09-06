# Validation, package boundaries, and performance evidence

## Purpose and verdict

Make regressions visible through the commands maintainers actually run, preserve optional native dependency isolation, and distinguish logical correctness from native performance. **Keep the existing test infrastructure and export separation. Repair missing gate wiring before adding another framework.** Findings use the original baseline described in [README](README.md).

Sources: [library scripts](../../packages/gamekit/package.json), [coverage gate](../../packages/gamekit/scripts/coverage-gate.mjs), [main typecheck config](../../packages/gamekit/tsconfig.json), [API fixture config](../../packages/gamekit/tsconfig.assets.json), [workspace commands](../../package.json), [Turbo tasks](../../turbo.json), [CI](../../.github/workflows/ci.yml), [entry-point isolation tests](../../packages/gamekit/test/entryPoints.isolation.test.ts).

## GS-VALIDATION-01 — P2: coverage commands fail before enforcing their stated policy

**Evidence: reproduced.** The normal test command includes `--experimental-test-module-mocks`; `test:coverage` and the child process in `coverage-gate.mjs` omit it. Running the gate with local Node 24.19.0 fails with `mock.module is not a function` in native-adapter tests. A diagnostic coverage run with the flag supplied passed all 769 tests. However, its default report uses `ℹ` prefixes; the gate strips only `#` and recognized **zero coverage rows**. The report also contains four separate `validation.ts` rows. Parsing them by basename cannot reliably identify the intended module even after fixing the prefix.

The tracked list contains twelve named modules, chiefly older presentation and asset helpers. It does not enforce repository-wide 80% coverage. Neither `pnpm check` nor the inspected CI invokes `test:coverage:gate`. The report's “all files” number includes tests and should not be presented as library-source coverage.

**Resolve:**

1. Align normal and coverage test invocation, including module mocking and the same test discovery. Avoid maintaining subtly different copies of the flags.
2. Choose coverage output supported by the pinned Node version that preserves repository-relative file identity. Prefer a structured result if available; otherwise pin a reporter and parse its hierarchy deliberately. Do not scrape ambiguous basenames or assume the local reporter matches CI's Node 22.14.0.
3. Make the gate fail clearly on missing data, duplicate/ambiguous identities, malformed percentages, and failed child tests. A parser failure must never silently become a pass.
4. State the actual scope: targeted source modules or all eligible executable library source. Align the module list and docs with that policy; exclude generated output, tests, type-only files, and justified native-only paths explicitly. Add coverage for the ownership/error branches implicated by this review, not superficial tests to inflate a percentage.
5. Wire the selected gate into the ordinary CI validation path and a documented local command. Reuse Turbo tasks where needed rather than introducing a separate automation system.

**Acceptance:** the exact CI Node/toolchain runs the same discovered tests as the normal command, measures two different `validation.ts` files independently, rejects a deliberately under-covered tracked fixture, rejects missing data, and passes the actual target scope at its configured threshold. A small parser fixture test is justified because incorrect parsing defeats the gate itself. Report line/branch/function scope precisely; do not claim 80% branch coverage from a line-only check.

## GS-VALIDATION-02 — P2: public API compile fixtures are outside ordinary validation

**Evidence: source-confirmed.** `tsconfig.json` excludes `test/api`; `tsconfig.assets.json` includes it. The separate `typecheck:assets` command passes when run explicitly, but CI only runs ordinary workspace typecheck. The fixture directory now covers camera, events, audio, haptics, particles, tilemaps, collision, storage, and sprites, so its historical assets-only name hides its real responsibility.

**Resolve:** include the separate fixture project in normal library type validation or add an explicit `typecheck:api` task to CI and local validation. Keep a compatibility alias only if existing callers need it. Preserve the separate compiler configuration if its constraints serve a real purpose; merging projects is not itself the goal. Confirm negative fixtures use compiler-enforced failures rather than comments a runner never evaluates.

**Acceptance:** a misspelled public clip/event/action name or invalid adapter signature in a negative fixture fails the same command used in CI. Unused expected-error annotations fail as well. Positive headless and React subpath fixtures compile. Adding a fixture requires no second undocumented manual command.

## GS-VALIDATION-03 — P2: native acceptance is still open for critical presentation and effect contracts

**Evidence: documented gap.** [T20 device smoke](../task-20-device-smoke.md), [T14](../task-14.md), [T15](../task-15.md), and the [earlier performance review](../performance-summary-gpt.md) record pending device evidence. Pure math tests, source-contract searches, React-test-renderer, simulator results, and Node/V8 microbenchmarks answer useful but different questions. None alone proves Hermes/UI execution, native buffer redraw, hardware haptics, audio interruption routing, or 60/120 Hz frame pacing.

**Resolve:** finish a small set of existing reference-game/lab scenarios, not a new generic benchmarking product. Start with correctness gates that can invalidate throughput conclusions:

- Stationary-camera batch updates for sprites, tiles, and sprite particles, including hide/reappear and recolor. This is [GS-REACT-03](03-react-presentation.md).
- Input and camera coherence during pause, rotation/layout change, navigation/unmount, and delayed RN delivery.
- Asset acquire/abort/retry cycles with native image lifetime and memory plateau.
- Particle attach/detach/dispose, idle behavior, overflow, and no-camera rendering.
- Audio failed start/interruption/background and haptic manual/session pause on actual supported hardware.
- Save/load/hydration and storage-adapter failure behavior across real app lifecycle changes.

Then capture relevant stress scenarios in release or supported optimized builds on iOS and Android, including representative 60 Hz and 120 Hz hardware. Record actual refresh mode, device/OS, dependency versions, build mode, scenario population, visible/allocated capacity, warmup/duration, frame-time distribution, missed frames, memory, and input latency where applicable. Profile update, snapshot/freezing/publication, UI work, and draw cost separately. Avoid adding always-on instrumentation to obtain those numbers.

**Acceptance:** attach reproducible steps and measurements to the owning system's result. Mark unavailable device rows pending, with their implication, rather than substituting simulator FPS. Compare the same scenario before/after an optimization. Correctness probes can be simulator-assisted, but hardware performance claims require hardware evidence.

## Package boundaries to preserve

The package export map separates headless root/math/events/assets/storage/particle logic from React and optional native backends. Existing isolation tests and lazy adapter resolution are useful protections. Preserve them while simplifying adapters: importing pure helpers must not eagerly require React Native, Skia, Audio API, Pulsar, or AsyncStorage. Missing optional peers should fail when that feature is requested with the intended actionable error.

Keep native singleton packages as compatible application dependencies and library peers/dev dependencies. Preserve the build-before-consumer-validation order in CI: consumer export-map resolution needs the library output. Keep docs server bundles independent of the native runtime, and generated playground native directories untracked.

Planck is an evaluation dev dependency associated with the [T18 no-go](../task-18.md), not an implemented production physics system or a reason to add one. Delete evaluation plumbing only under an explicit cleanup task after checking whether its recorded experiment is still useful.

## Implementation handoff

Use failing behavioral tests for the defects in systems 01–17, retaining relevant existing coverage. Avoid tests that merely repeat implementation formulas or search for a `'worklet'` token. Validate exported types, lifecycle effects, and actual callback execution at the appropriate boundary. Native checks remain separate acceptance evidence. No coverage/tooling/runtime code has been changed by this review.
