# React Native GameKit performance skill review

## Purpose and verdict

Help implementation agents reason about ownership, runtime crossings, and measured frame cost without preserving unnecessary architecture or inventing features. **Keep the skill, with narrower, evidence-based rules.** The user explicitly authorized improvements to it; this review updated skill Markdown directly while leaving runtime implementation to the implementation agent.

Reviewed files: [SKILL.md](../../.agents/skills/react-native-gamekit-performance/SKILL.md), [architecture](../../.agents/skills/react-native-gamekit-performance/references/architecture.md), [gesture input](../../.agents/skills/react-native-gamekit-performance/references/gesture-input.md), [performance review](../../.agents/skills/react-native-gamekit-performance/references/performance-review.md), and [sources](../../.agents/skills/react-native-gamekit-performance/references/sources.md).

## GS-SKILL-01 — corrected: stale version guidance and an invalid input example

The main skill described RNGH 3.1.0, while the source reference still called RNGH 2 the repository baseline. The gesture example used an undeclared `event`, omitted the import for its state manager, called global activation without a handler tag, and omitted the lifecycle ownership needed for a usable adapter. Another paragraph listed legacy state-manager methods.

**Change made:** removed the incomplete snippet, pointed readers to installed source and GameKit's adapter, and stated the verified RNGH 3.1.0 methods `activate(handlerTag)`, `deactivate(handlerTag)`, and `fail(handlerTag)`. Replaced stale live-version claims with a dated repository snapshot; retained old upstream references as historical research rather than claiming they were refreshed. Described the existing coalesced `scheduleOnRN` input path accurately.

**Verification:** inspected `packages/gamekit/node_modules/react-native-gesture-handler/src/v3/gestureStateManager.ts`, package manifests, and lockfile. No dependency upgrades or upstream compatibility certification are implied. Future changes must recheck installed signatures before copying examples.

## GS-SKILL-02 — corrected: absolute crossing bans and incomplete performance evidence

A blanket ban on `scheduleOnRN` in hot callbacks conflicts with necessary input delivery and sparse tile-window requests. Conversely, a callback that no-ops after crossing still incurs work. Stable React topology, a `'worklet'` directive, and mutable mock buffers are insufficient evidence of a correct or fast native renderer.

**Change made:** require explicit bounds on crossing rate, payload size, ordering, and retired-owner delivery; require disabled diagnostics to avoid scheduling, clocks, and packet construction at their source. Added whole-call-graph/error-path checks, transformed-closure inspection, and the distinction between host-object mutation, SharedValue notification, and native redraw. Added total visited/allocated work and transferred bytes to measurements; per-axis bounds or visible counts alone do not establish a practical budget.

**Verification:** compared the guidance with GameKit's input/tile bridges and Skia 2.11.0's installed `src/external/reanimated/buffers.ts`. Native buffer publication remains an investigation under [GS-REACT-03](03-react-presentation.md); the skill does not assert a device failure or a performance pass.

## GS-SKILL-03 — corrected: architecture advice exceeded the implemented contracts

The architecture reference suggested native asset handles inside immutable snapshots, scene enter/pause/resume hooks that the public scene API does not expose, and future 3D extensibility as an architectural objective. These encourage unnecessary surface area or conflicting ownership.

**Change made:** native resources remain in renderer-owned asset leases beside snapshots; scenes use the implemented create/update/snapshot/dispose hooks, with session status owning pause/resume. Clarified GameKit's UI alpha clock versus the headless accumulator alpha. Removed unrequested future-3D API pressure while retaining the useful boundary between simulation and rendering.

**Acceptance for future uses:** example code must compile against the actual public API; no invented lifecycle hooks or native handles in deep-frozen game state. If camera/body interpolation endpoints disagree after catch-up, reproduce and resolve that coherence problem within the existing presentation contract rather than adding a second simulation clock.

## GS-SKILL-04 — added: delete/simplify workflow and adversarial ownership review

**Change made:** each system starts with purpose, authoritative owner, and smallest required contract. Delete inert state, duplicate representations, unsupported compatibility branches, and disabled instrumentation work before adding optimizations. Review abort/reacquire, partial setup, queued work across pause/replacement, and disposal paths. Require concrete triggers and acceptance criteria, distinguish reproduced defects from source risks and performance hypotheses, and explicitly honor review-only task scope. A system with no justified change can remain unchanged.

The performance reference now requires evidence scoped to the runtime/device actually exercised. Dynamic Picture recording is allowed when measured instead of being swept into an unconditional allocation ban. No automation, source refresh, new dependency, or skill scripting was added.

## Handoff and remaining validation

These documentation edits are complete. Use the revised skill when implementing the system briefs, while continuing to challenge its assumptions against local evidence and user scope. Verify requested API examples with type fixtures and runtime execution where relevant; verify performance with the targeted native scenarios in [system 18](18-validation-and-package-boundaries.md). Do not add a skill-specific benchmark framework or refresh every historical upstream reference merely to mark this review complete.
