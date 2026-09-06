# Game systems review

Reviewed **2026-09-05**. These are implementation briefs for the existing 2D library: what each system must do, what is already sound, concrete defects, things to delete or simplify, and how to verify each proposed change. The review itself changes documentation and the explicitly authorized performance skill; it does not implement runtime fixes.

## Baseline and status

The system findings and reproductions were collected from the working tree based on **`a27f78b`**, before the subsequent implementation commits. The baseline library suite passed **769 tests**, ordinary typecheck, and the separate API fixture typecheck. Passing those checks did not prevent the reproduced failures below.

These briefs record the audit and implementation instructions, not ongoing implementation status. Subsequent fixes are outside this review's completion scope. Source links resolve to current files; quoted line numbers describe the original audit. The implementation agent should use each item's acceptance criteria to verify resolution and avoid duplicating an existing fix.

## Read systems one after another

| Order | System | Original verdict / main action |
| --- | --- | --- |
| [01](01-game-definition-and-session.md) | Definitions and fixed-step session | Keep ownership and scheduling model; clarify transitions, handle scheduler failure, delete inert types. |
| [02](02-scenes-and-snapshots.md) | Scenes and snapshots | Keep prepare/commit separation; repair disposal ownership and define the snapshot data domain. |
| [03](03-react-presentation.md) | React and presentation | Remove disabled diagnostic work, make binding transactional, verify native buffer publication. |
| [04](04-input.md) | Pointer and button input | Repair pending edges, multi-touch counts, zone cleanup, and stale adapter delivery. |
| [05](05-viewport.md) | Viewport | Keep the implementation; clarify a small disposal contract rather than redesign it. |
| [06](06-camera2d.md) | Camera2D | Keep one presented camera; repair paused cuts and error reporting. |
| [07](07-geometry.md) | Geometry | Keep direct scalar helpers; align untyped-input and numeric-domain policy. |
| [08](08-collision2d.md) | Collision2D | Keep query semantics; own nested hit data and bound total spatial-index work. |
| [09](09-assets.md) | Assets and loading | Fix shared resource ownership, stale decode completion, and React request identity first. |
| [10](10-sprite-animation.md) | Sprite animation | Delete duplicate samplers; align time, clip typing, and worklet error contracts. |
| [11](11-sprite-rendering.md) | Sprite rendering | Correct scale/anchor transforms and batch scale; remove useless overflow iteration. |
| [12](12-tilemaps-and-platformer-movement.md) | Tilemaps and platformer movement | Fix window identity; clarify collision eligibility; justify duplicate indexes with measurements. |
| [13](13-events.md) | Events and seeds | Keep transactional effects; clarify observer timing and simplify validation. |
| [14](14-particles.md) | Particles | Enforce one driver, repair no-camera culling, and reduce redundant state before optimizing. |
| [15](15-audio.md) | Audio | Repair failed-start ownership and retained reservations; simplify backend/lifecycle integration. |
| [16](16-haptics.md) | Haptics | Separate pause reasons and use the installed public capability API. |
| [17](17-storage.md) | Storage | Fix persistent-key collisions; normalize saves once; keep the JSON-only boundary. |

Read [18 — validation and package boundaries](18-validation-and-package-boundaries.md) for the shared checks and measurement gaps, and [19 — performance skill](19-performance-skill.md) for the authorized skill improvements and their verification.

## Priority and evidence

- **P1:** a supported sequence can lose ownership/data, break input/rendering, or block normal use. Address before relying on that feature in a reference game.
- **P2:** a correctness edge, contract mismatch, or material complexity/work-bound issue. Resolve within the owning system's task.
- **P3:** small clarification or simplification; do it only when its benefit remains after higher-priority fixes.
- **Investigation / performance guard / design review:** a required decision or measurement, not proof of an observed native failure or a measured speedup. The native buffer-notification investigation is prioritized because three renderers depend on it.

**Reproduced** means a local execution demonstrated the stated behavior. Unless explicitly described otherwise, these used Node source imports, injected adapters, or React-test-renderer, not a native device. **Source-confirmed** means an identified path or contract mismatch supports the finding but its full platform behavior has not been executed. Performance hypotheses state what to measure before changing architecture.

## Implementation dependencies

The numbered sequence is the review order. Keep fixes small and owned by their system, with these cross-system dependencies:

1. Resolve lifecycle and ownership failures before throughput work: session/scenes/React/input, asset references, particle drivers, audio starts, and storage key isolation. Storage changes need an explicit legacy-data policy before new key writes.
2. Repair assets before changing renderer ownership. Consolidate animation selection and transform algebra together across systems 10–11; do not create competing helpers.
3. Verify **GS-REACT-03** once across sprite batches, tile layers, and sprite particles. A reproduction screen or mocked buffer assertion is preparation, not evidence that native redraw is correct.
4. Align camera cuts and trusted extent math with input, tile windows, and particle culling. Keep public validation separate from per-item worklet arithmetic.
5. Fix the validation entry points in system 18 so new behavioral and compile fixtures actually run. Then measure the proposed spatial-index, tile-index, particle, and renderer optimizations in representative native scenarios.

For each item: reproduce or explain why current code already resolves it; add the smallest behavioral/compile regression; implement only the selected contract; run the relevant checks; record the outcome and any native acceptance still pending. Do not convert an investigation into a rewrite without evidence. Existing task boundaries remain authoritative; these briefs do not authorize later-task features.

## What should stay simple

Keep headless fixed-step simulation, compact immutable presentation commits, direct 2D math, typed transactional events, optional native-effect adapters, and explicit storage schemas. No demonstrated need justifies an ECS, a new scheduler/runtime, a general event bus, streaming tile infrastructure, a physics backend, cloud storage, or future 3D APIs as part of this review. [T18](../task-18.md)'s physics no-go is an intentional scope decision.

Delete inert state and duplicate algorithms first. Simplify resource and lifecycle ownership next. Optimize only remaining measured costs. Viewport and geometry mostly need contract precision, not replacement.

## Validation recorded for this review

| Check | Baseline outcome |
| --- | --- |
| `pnpm exec turbo run test typecheck --filter=rn-gamekit` | Passed; 769 tests, both tasks uncached. |
| `pnpm --filter rn-gamekit typecheck:assets` | Passed; includes the separate `test/api` fixtures. |
| `pnpm --filter rn-gamekit test:coverage:gate` | Failed: child test process omits the module-mocking flag. See system 18. |
| Diagnostic coverage run with the missing flag supplied | 769 tests passed; current gate parser recognized zero rows in the local Node 24 report. This is not an 80% gate pass. |
| Focused defect probes | Confirmed asset lease races, mounted hook ordering/stale identity, input ownership, scene cleanup, sprite algebra, particle ownership, audio start failure, haptic pause, storage keys/normalization, and selected collision/movement ownership issues. Reproduction sequences are in the corresponding briefs. |
| Native / device performance | Not executed for this review. No new FPS, latency, memory, audible-output, or hardware-haptics claim. |

Installed versions inspected: RN 0.86.2, Expo 57.0.10, Skia 2.11.0, Reanimated 4.5.3, Worklets 0.10.3, RNGH 3.1.0, Audio API 0.13.3, Pulsar 1.7.0, and AsyncStorage 2.1.2. These identify the reviewed repository, not an upstream compatibility certification. The package filter is **`rn-gamekit`**, as declared in the package manifest.
