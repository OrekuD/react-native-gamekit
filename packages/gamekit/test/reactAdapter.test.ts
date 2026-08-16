import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InputController } from '../src/core/input/types.ts';
import { createPointerBinding, PointerBinding, type PointerPacket } from '../src/react/pointerBinding.ts';
import { bindAppLifecycle, type AppLifecycleSource } from '../src/react/bindAppLifecycle.ts';
import { bindingForViewport, ViewportBinding } from '../src/react/viewportBinding.ts';
import { resolveViewport2D, type ResolvedViewport2D } from '../src/viewport2d/index.ts';

const viewport = { logicalSize: { width: 320, height: 180 }, mode: 'fit' } as const;

function resolvedFor(width: number, height: number): ResolvedViewport2D {
  return resolveViewport2D(viewport, { width, height })!;
}

/** Records the semantic events forwarded by the pointer binding. */
class RecordingInputController implements InputController<string> {
  readonly events: string[] = [];
  acceptedCount = 0;
  sampledCount = 0;

  press(action: string): void {
    this.events.push(`press:${action}`);
  }
  release(action: string): void {
    this.events.push(`release:${action}`);
  }
  begin(action: string, pointerId: number, position: { readonly x: number; readonly y: number }): void {
    this.acceptedCount += 1;
    this.events.push(`begin:${action}:${pointerId}:${position.x.toFixed(2)}:${position.y.toFixed(2)}`);
  }
  move(action: string, pointerId: number, position: { readonly x: number; readonly y: number }): void {
    this.events.push(`move:${action}:${pointerId}:${position.x.toFixed(2)}:${position.y.toFixed(2)}`);
  }
  end(action: string, pointerId: number): void {
    this.acceptedCount += 1;
    this.events.push(`end:${action}:${pointerId}`);
  }
  cancel(action: string): void {
    this.events.push(`cancel:${action}`);
  }
}

describe('PointerBinding', () => {
  it('converts surface coordinates to world coordinates through the viewport', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 1);
    const began = binding.begin(1, { x: 195, y: 312.3125 + 109.6875 });
    assert.equal(began, true);
    assert.deepEqual(input.events, ['begin:primary:1:160.00:90.00']);
  });

  it('rejects begins in fit letterbox space', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 2);
    const began = binding.begin(1, { x: 195, y: 100 });
    assert.equal(began, false);
    assert.deepEqual(input.events, []);
  });

  it('maps movement outside the content through the unbounded transform', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 3);
    binding.begin(1, { x: 195, y: 312.3125 + 109.6875 });
    binding.move(1, { x: 195, y: 700 });
    binding.end(1);
    assert.deepEqual(input.events, [
      'begin:primary:1:160.00:90.00',
      // 700 - 312.3125 = 387.6875 surface points below the authored top.
      'move:primary:1:160.00:318.10',
      'end:primary:1',
    ]);
  });

  it('returns false with no viewport and forwards nothing but ends', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => undefined, 14);
    assert.equal(binding.begin(1, { x: 10, y: 10 }), false);
    binding.move(1, { x: 20, y: 20 });
    binding.end(1);
    // begin/move need a viewport; end releases buffer ownership without one.
    assert.deepEqual(input.events, ['end:primary:1']);
  });

  it('ignores events after dispose', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 4);
    binding.dispose();
    binding.dispose();
    assert.equal(binding.begin(1, { x: 195, y: 400 }), false);
    binding.cancel();
    assert.deepEqual(input.events, []);
  });

  it('forwards cancellation and pointer ids unchanged', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 5);
    binding.begin(9, { x: 195, y: 400 });
    binding.cancel();
    assert.deepEqual(input.events, ['begin:primary:9:160.00:71.95', 'cancel:primary']);
  });

  it('never exposes gesture handler or platform types to the input buffer', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 6);
    binding.begin(2, { x: 195, y: 400 });
    assert.match(input.events[0] ?? '', /^begin:primary:2:/);
  });

  it('dispatch routes packets stamped with the current generation (F3)', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 1);
    const generation = binding.generation;
    assert.equal(binding.dispatch({ kind: 'begin', pointerId: 7, x: 195, y: 400, generation, layoutEpoch: 0, seq: 1, atMs: 1000 }), true);
    assert.equal(binding.dispatch({ kind: 'move', pointerId: 7, x: 195, y: 500, generation, layoutEpoch: 0, seq: 2, atMs: 1016 }), true);
    assert.equal(binding.dispatch({ kind: 'end', pointerId: 7, x: 195, y: 500, generation, layoutEpoch: 0, seq: 3, atMs: 1033 }), true);
    assert.deepEqual(input.events, [
      'begin:primary:7:160.00:71.95',
      // handleTouchesUp forwards the final position before releasing.
      'move:primary:7:160.00:154.00',
      'move:primary:7:160.00:154.00',
      'end:primary:7',
    ]);
  });

  it('rejects every packet kind from a different binding generation (F3)', () => {
    const input = new RecordingInputController();
    const first = new PointerBinding('primary', input, () => resolvedFor(390, 844), 2);
    const replacement = new PointerBinding('primary', input, () => resolvedFor(390, 844), 3);
    assert.equal(first.dispatch({ kind: 'begin', pointerId: 1, x: 195, y: 400, generation: 2, layoutEpoch: 0, seq: 1, atMs: 1000 }), true);
    const stale: PointerPacket[] = [
      { kind: 'begin', pointerId: 2, x: 195, y: 400, generation: 2, layoutEpoch: 0, seq: 2, atMs: 1016 },
      { kind: 'move', pointerId: 1, x: 195, y: 500, generation: 2, layoutEpoch: 0, seq: 3, atMs: 1033 },
      { kind: 'end', pointerId: 1, x: 195, y: 500, generation: 2, layoutEpoch: 0, seq: 4, atMs: 1050 },
      { kind: 'cancel', generation: 2, layoutEpoch: 0, seq: 5, atMs: 1066 },
    ];
    for (const packet of stale) {
      assert.equal(replacement.dispatch(packet), false, 'old-generation packet rejected by the replacement');
    }
    assert.equal(first.dispatch({ kind: 'move', pointerId: 1, x: 195, y: 500, generation: 2, layoutEpoch: 0, seq: 6, atMs: 1083 }), true, 'the original binding keeps working');
    assert.deepEqual(input.events, ['begin:primary:1:160.00:71.95', 'move:primary:1:160.00:154.00'], 'no stale edge reached the buffer');
  });

  it('a stale terminal edge cannot release a newer capture reusing the pointer id (F3)', () => {
    const input = new RecordingInputController();
    const first = new PointerBinding('primary', input, () => resolvedFor(390, 844), 4);
    const replacement = new PointerBinding('primary', input, () => resolvedFor(390, 844), 5);
    assert.equal(first.dispatch({ kind: 'begin', pointerId: 4, x: 195, y: 400, generation: 4, layoutEpoch: 0, seq: 1, atMs: 1000 }), true);
    // Replacement invalidates the first gesture; its queued end is stale.
    assert.equal(replacement.dispatch({ kind: 'end', pointerId: 4, x: 195, y: 400, generation: 4, layoutEpoch: 0, seq: 2, atMs: 1016 }), false);
    // A newer gesture reuses the same native pointer id under the new generation.
    assert.equal(replacement.dispatch({ kind: 'begin', pointerId: 4, x: 195, y: 400, generation: 5, layoutEpoch: 0, seq: 3, atMs: 1033 }), true);
    assert.equal(replacement.dispatch({ kind: 'end', pointerId: 4, x: 195, y: 400, generation: 5, layoutEpoch: 0, seq: 4, atMs: 1050 }), true);
    assert.deepEqual(input.events, [
      'begin:primary:4:160.00:71.95',
      'begin:primary:4:160.00:71.95',
      'move:primary:4:160.00:71.95',
      'end:primary:4',
    ], 'the stale end never released the newer capture');
  });

  it('a replacement binding accepts the first packet immediately, by construction (F3)', () => {
    const input = new RecordingInputController();
    const first = new PointerBinding('primary', input, () => resolvedFor(390, 844), 6);
    assert.equal(first.dispatch({ kind: 'begin', pointerId: 1, x: 195, y: 400, generation: 6, layoutEpoch: 0, seq: 1, atMs: 1000 }), true);
    const replacement = new PointerBinding('primary', input, () => resolvedFor(390, 844), 7);
    assert.equal(replacement.generation, 7, 'generation is monotonic and never resets');
    assert.equal(replacement.dispatch({ kind: 'begin', pointerId: 1, x: 195, y: 400, generation: 7, layoutEpoch: 0, seq: 2, atMs: 1016 }), true);
    assert.equal(replacement.dispatch({ kind: 'end', pointerId: 1, x: 195, y: 400, generation: 7, layoutEpoch: 0, seq: 3, atMs: 1033 }), true);
    assert.equal(replacement.dispatch({ kind: 'begin', pointerId: 2, x: 195, y: 400, generation: 6, layoutEpoch: 0, seq: 4, atMs: 1050 }), false);
  });

  it('dispose and cancel are idempotent and ordering-safe (F3)', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 8);
    binding.cancel();
    binding.cancel();
    assert.equal(binding.dispatch({ kind: 'begin', pointerId: 1, x: 195, y: 400, generation: 8, layoutEpoch: 0, seq: 1, atMs: 1000 }), true);
    binding.dispose();
    binding.dispose();
    assert.equal(binding.dispatch({ kind: 'begin', pointerId: 1, x: 195, y: 400, generation: 8, layoutEpoch: 0, seq: 2, atMs: 1016 }), false);
  });

  it('resolves on surface changes and notifies only on layout revisions', () => {
    const binding = new ViewportBinding(viewport);
    let revisions = 0;
    const unsubscribe = binding.subscribe(() => {
      revisions += 1;
    });
    const initial = binding.resolved;
    assert.equal(initial, undefined);

    binding.setSurfaceSize({ width: 390, height: 844 });
    assert.equal(binding.revision, 1);
    assert.equal(revisions, 1);
    const resolved = binding.resolved;
    assert.ok(resolved);
    assert.equal(resolved.scale, 390 / 320);

    binding.setSurfaceSize({ width: 390, height: 844 });
    assert.equal(binding.revision, 1, 'identical size is not a revision');
    assert.equal(revisions, 1);

    binding.setSurfaceSize({ width: 844, height: 390 });
    assert.equal(binding.revision, 2);
    assert.equal(revisions, 2);

    unsubscribe();
    unsubscribe();
    binding.setSurfaceSize({ width: 390, height: 844 });
    assert.equal(revisions, 2);
  });

  it('preserves the measured surface when replacing the authored viewport', () => {
    const initial = new ViewportBinding({
      logicalSize: { width: 320, height: 480 },
      mode: 'fit',
    });
    initial.setSurfaceSize({ width: 390, height: 844 });

    const replacement = bindingForViewport(viewport, initial);

    assert.notEqual(replacement, initial);
    assert.deepEqual(replacement.surfaceSize, { width: 390, height: 844 });
    assert.equal(replacement.resolved?.scale, 390 / 320);
    assert.deepEqual(replacement.resolved?.logicalBounds, {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
  });

  it('treats a zero-sized layout as invalid and recovers', () => {
    const binding = new ViewportBinding(viewport);
    binding.setSurfaceSize({ width: 0, height: 0 });
    assert.equal(binding.resolved, undefined);
    binding.setSurfaceSize({ width: 390, height: 844 });
    assert.ok(binding.resolved);
  });

  it('throws RangeError for invalid authored sizes', () => {
    const binding = new ViewportBinding({ logicalSize: { width: 0, height: 180 }, mode: 'fit' });
    assert.throws(() => binding.setSurfaceSize({ width: 390, height: 844 }), { name: 'RangeError' });
  });

  it('disposes subscribers', () => {
    const binding = new ViewportBinding(viewport);
    let count = 0;
    binding.subscribe(() => {
      count += 1;
    });
    binding.dispose();
    binding.setSurfaceSize({ width: 390, height: 844 });
    assert.equal(count, 0);
  });
});

describe('bindAppLifecycle', () => {
  class FakeAppState implements AppLifecycleSource {
    currentState: string | null | undefined;
    #listener: ((next: string) => void) | undefined;
    emit(next: string): void {
      this.currentState = next;
      this.#listener?.(next);
    }
    addEventListener(
      state: 'change',
      listener: (next: string) => void,
    ): { remove(): void } {
      assert.equal(state, 'change');
      this.#listener = listener;
      return {
        remove: () => {
          this.#listener = undefined;
        },
      };
    }
  }

  it('pauses on background and resumes only when it performed the pause', () => {
    const appState = new FakeAppState();
    const events: string[] = [];
    let running = false;
    bindAppLifecycle(appState, {
      getStatus: () => (running ? 'running' : 'paused'),
      pause: () => {
        running = false;
        events.push('pause');
      },
      resume: () => {
        running = true;
        events.push('resume');
      },
    });

    running = true;
    appState.emit('background');
    assert.deepEqual(events, ['pause']);
    assert.equal(running, false);

    appState.emit('active');
    assert.deepEqual(events, ['pause', 'resume']);
    assert.equal(running, true);
  });

  it('does not resume a game that was paused manually', () => {
    const appState = new FakeAppState();
    const events: string[] = [];
    let running = false;
    bindAppLifecycle(appState, {
      getStatus: () => (running ? 'running' : 'paused'),
      pause: () => {
        running = false;
        events.push('pause');
      },
      resume: () => {
        running = true;
        events.push('resume');
      },
    });

    // Manually paused: backgrounding must not mark the binding as the pauser.
    appState.emit('background');
    assert.deepEqual(events, []);

    appState.emit('active');
    assert.deepEqual(events, []);
  });

  it('pauses on inactive as well as background and ignores unknown states', () => {
    const appState = new FakeAppState();
    const events: string[] = [];
    let running = true;
    bindAppLifecycle(appState, {
      getStatus: () => (running ? 'running' : 'paused'),
      pause: () => {
        running = false;
        events.push('pause');
      },
      resume: () => {
        running = true;
        events.push('resume');
      },
    });

    appState.emit('inactive');
    assert.deepEqual(events, ['pause']);
    appState.emit('unknown');
    assert.deepEqual(events, ['pause']);
  });

  it('cleans up listeners and cannot resume after cleanup', () => {
    const appState = new FakeAppState();
    const events: string[] = [];
    let running = true;
    const cleanup = bindAppLifecycle(appState, {
      getStatus: () => (running ? 'running' : 'paused'),
      pause: () => {
        running = false;
        events.push('pause');
      },
      resume: () => {
        running = true;
        events.push('resume');
      },
    });

    appState.emit('background');
    cleanup();
    appState.emit('active');
    assert.deepEqual(events, ['pause']);
  });
});

describe('bindAppLifecycle hardening (feedback)', () => {
  class FakeAppState implements AppLifecycleSource {
    currentState: string | null | undefined;
    #listener: ((next: string) => void) | undefined;
    constructor(initial: string | undefined = 'active') {
      this.currentState = initial;
    }
    emit(next: string): void {
      this.currentState = next;
      this.#listener?.(next);
    }
    addEventListener(state: 'change', listener: (next: string) => void): { remove(): void } {
      assert.equal(state, 'change');
      this.#listener = listener;
      return {
        remove: () => {
          this.#listener = undefined;
        },
      };
    }
  }

  it('pauses immediately when the app is already inactive at bind time', () => {
    const appState = new FakeAppState('inactive');
    const events: string[] = [];
    bindAppLifecycle(appState, {
      getStatus: () => 'running',
      pause: () => events.push('pause'),
      resume: () => events.push('resume'),
    });
    assert.deepEqual(events, ['pause']);
  });

  it('does not claim or resume when a manual pause happened before backgrounding', () => {
    const appState = new FakeAppState();
    const events: string[] = [];
    let status: 'idle' | 'running' | 'paused' | 'disposed' = 'running';
    bindAppLifecycle(appState, {
      getStatus: () => status,
      pause: () => {
        status = 'paused';
        events.push('pause');
      },
      resume: () => {
        status = 'running';
        events.push('resume');
      },
    });
    // Manual pause supersedes any lifecycle claim.
    status = 'paused';
    appState.emit('background');
    assert.deepEqual(events, [], 'background must not pause an already paused session');
    appState.emit('active');
    assert.deepEqual(events, [], 'foreground must not resume a manually paused session');
  });

  it('does not resume when another actor resumed the session during background', () => {
    const appState = new FakeAppState();
    const events: string[] = [];
    let status: 'idle' | 'running' | 'paused' | 'disposed' = 'running';
    bindAppLifecycle(appState, {
      getStatus: () => status,
      pause: () => {
        status = 'paused';
        events.push('pause');
      },
      resume: () => {
        status = 'running';
        events.push('resume');
      },
    });
    appState.emit('background');
    assert.deepEqual(events, ['pause']);
    // Another actor restarts the session while backgrounded.
    status = 'running';
    appState.emit('active');
    assert.deepEqual(events, ['pause'], 'no resume call for an already-running session');
  });

  it('does not resume a disposed session on foreground', () => {
    const appState = new FakeAppState();
    const events: string[] = [];
    let status: 'idle' | 'running' | 'paused' | 'disposed' = 'running';
    bindAppLifecycle(appState, {
      getStatus: () => status,
      pause: () => {
        status = 'paused';
        events.push('pause');
      },
      resume: () => {
        status = 'running';
        events.push('resume');
      },
    });
    appState.emit('background');
    status = 'disposed';
    appState.emit('active');
    assert.deepEqual(events, ['pause']);
  });

  it('resumes on foreground only when it performed the background pause', () => {
    const appState = new FakeAppState();
    const events: string[] = [];
    let status: 'idle' | 'running' | 'paused' | 'disposed' = 'running';
    bindAppLifecycle(appState, {
      getStatus: () => status,
      pause: () => {
        status = 'paused';
        events.push('pause');
      },
      resume: () => {
        status = 'running';
        events.push('resume');
      },
    });
    appState.emit('background');
    appState.emit('active');
    assert.deepEqual(events, ['pause', 'resume']);
  });
});

describe('PointerBinding adapter dispatch (feedback)', () => {
  it('forwards the final up position before ending ownership', () => {
    const input = new RecordingInputController();
    const binding = new PointerBinding('primary', input, () => resolvedFor(390, 844), 13);
    binding.handleTouchesDown(1, 195, 400);
    binding.handleTouchesMove(1, 195, 500);
    binding.handleTouchesUp(1, 220, 520);
    assert.deepEqual(input.events, [
      'begin:primary:1:160.00:71.95',
      'move:primary:1:160.00:154.00',
      'move:primary:1:180.51:170.41',
      'end:primary:1',
    ]);
  });

  it('reuses the binding across rerenders with the same identity', () => {
    const input = new RecordingInputController();
    const viewportToken = {};
    const first = createPointerBinding(
      { input, action: 'primary', viewport: viewportToken, camera: undefined },
      () => resolvedFor(390, 844),
      undefined,
    );
    assert.equal(first.created, true);
    const second = createPointerBinding(
      { input, action: 'primary', viewport: viewportToken, camera: undefined },
      () => resolvedFor(390, 844),
      first.entry,
    );
    assert.equal(second.created, false);
    assert.equal(second.entry.binding, first.entry.binding, 'same binding reused');
  });

  it('recreates and disposes the binding when the session identity changes', () => {
    const input = new RecordingInputController();
    const viewportToken = {};
    const first = createPointerBinding(
      { input, action: 'primary', viewport: viewportToken, camera: undefined },
      () => resolvedFor(390, 844),
      undefined,
    );
    const otherInput = new RecordingInputController();
    const second = createPointerBinding(
      { input: otherInput, action: 'primary', viewport: viewportToken, camera: undefined },
      () => resolvedFor(390, 844),
      first.entry,
    );
    assert.equal(second.created, true);
    assert.notEqual(second.entry.binding, first.entry.binding);
    // The disposed binding stops forwarding.
    assert.equal(first.entry.binding.begin(1, { x: 195, y: 400 }), false);
    assert.deepEqual(input.events, []);
  });

  it('recreates when the viewport provider identity changes', () => {
    const input = new RecordingInputController();
    const first = createPointerBinding(
      { input, action: 'primary', viewport: {}, camera: undefined },
      () => resolvedFor(390, 844),
      undefined,
    );
    const second = createPointerBinding(
      { input, action: 'primary', viewport: {}, camera: undefined },
      () => resolvedFor(390, 844),
      first.entry,
    );
    assert.equal(second.created, true, 'a different viewport provider recreates the binding');
  });

  it('recreates when the action changes', () => {
    const input = new RecordingInputController();
    const viewportToken = {};
    const first = createPointerBinding(
      { input, action: 'primary', viewport: viewportToken, camera: undefined },
      () => resolvedFor(390, 844),
      undefined,
    );
    const second = createPointerBinding(
      { input, action: 'secondary', viewport: viewportToken, camera: undefined },
      () => resolvedFor(390, 844),
      first.entry,
    );
    assert.equal(second.created, true);
  });
});
