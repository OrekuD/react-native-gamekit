# Worklets and runtime boundaries

## Runtime kinds

React Native Worklets defines distinct JavaScript runtimes:

- **RN Runtime:** the ordinary React Native JavaScript runtime on the JS thread.
- **UI Runtime:** a Worklet Runtime on the platform UI thread, used for animations and gesture callbacks.
- **Worker Runtime:** an optional Worklet Runtime on another thread, created explicitly.

Each runtime has its own JavaScript heap. A closure or argument that crosses a runtime boundary is serialized or represented by a Worklets memory primitive; it is not an ordinary shared JavaScript object.

## Scheduling APIs

### `scheduleOnUI`

Schedule a worklet asynchronously on the UI runtime. It does not return the worklet's result to the caller.

Use it to initialize or change UI-owned presentation state from the RN runtime. Avoid scheduling one task per entity or per pointer sample.

On web it runs on the next animation frame, so do not use it as a cross-platform synchronous primitive.

### `scheduleOnRN`

Schedule an RN-runtime function asynchronously from a worklet runtime. The target function must have been defined in RN-runtime scope.

Use it for infrequent semantic events. Prefer a compact command payload rather than a captured engine object.

### `scheduleOnRuntime`

Schedule a worklet on a custom Worker Runtime. It also has no synchronous return path. Model the response as another scheduled message or a published snapshot.

Calling rules differ when Worklets Bundle Mode is enabled. Consult the official call tables for the installed release; do not assume a scheduling function can be invoked from every runtime.

## Closure snapshots

A worklet carries captured values to its target runtime. Think of the closure as a snapshot:

- later RN-runtime object mutations are not magically visible in the worklet
- globals exist independently on each runtime
- large captured objects cost serialization, memory, and startup time
- native/shareable host objects have their own access rules

Extract only the scalars or small immutable structures required by a worklet.

## Worklets memory models

Current Worklets documentation distinguishes:

- **Serializable:** copied to the destination runtime; good for small messages and snapshots.
- **Synchronizable:** backed by shared C++ state; crossing/access has synchronization cost.
- **Shareable:** bound to a host runtime; cheapest when most access remains on that host.

Do not expose any one of these as GameKit's universal entity store. Select a representation from measured access patterns and isolate it behind an adapter so Worklets upgrades do not leak into the game API.

## Custom worker-runtime policy

`createWorkletRuntime` is native-only and is aimed partly at C++/JSI integration. A worker can provide an event loop, timers, animation-frame callbacks, and a custom queue depending on configuration.

For GameKit v1:

- keep it out of the default game loop
- do not depend on RN-runtime-only APIs being present
- name runtimes for diagnostics
- define creation, shutdown, hot-reload, and error ownership

Newer Worklets revisions add runtime configuration beyond the installed 0.10.x API, including explicit locking controls. Do not copy those options into this project until its Worklets version is upgraded and the matching docs are reviewed.

Adopt a worker only when a benchmark demonstrates a repeatable RN/UI contention problem and the candidate work can operate on bounded inputs without synchronous access to the world.

## Bundle Mode

Bundle Mode lets Worklet Runtimes access the full JavaScript bundle and use precompiled bytecode. The current docs describe it as the future default, while Legacy Eval Mode remains relevant to compatibility.

Treat Bundle Mode as version-sensitive infrastructure:

- verify Expo/Metro and native setup for the installed versions
- verify third-party code is safe to execute on a non-RN runtime
- use the Worklets call tables for that mode
- benchmark startup, memory, and runtime behavior
- do not make it a GameKit requirement until it is stable across the support matrix

## Feature flags

Worklets static flags are compiled into native code. They require native rebuilds and are compatible with the project's Expo prebuild workflow, but cannot be changed in Expo Go.

Do not enable flags globally from inside the library. Feature availability, defaults, and removals change by release. Keep an app-owned configuration recipe with exact version bounds.

Cross-runtime stack traces are useful in development but add overhead on scheduling-heavy paths. They are skipped in release builds according to current docs; still benchmark the build mode shipped to users.

## Boundary checklist

Before adding a runtime crossing, answer:

1. Which runtime owns the source value?
2. Which runtime owns the result?
3. Is the transfer a stream, latest-state snapshot, or discrete event?
4. What is the maximum payload size and frequency?
5. What happens if delivery is delayed, coalesced, or dropped?
6. How is the work cancelled when a scene exits?
7. Can the same outcome be achieved without crossing runtimes?

If these answers are unclear, keep the work on its current owner until the contract is explicit.
