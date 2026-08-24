/**
 * T12-TF3: “committed” and round-trip diagnostics from the REAL mounted
 * pipeline.
 *
 * - accepted (dispatch stage) vs committed (fixed-step sampling): multiple
 *   accepted packets between fixed steps advance accepted immediately and
 *   committed only when the step samples them; pause holds committed.
 * - round-trip: a non-identity mounted viewport + an event-time camera
 *   stamp produce a sample whose back-projection matches the original
 *   surface point, and the sample carries the EXACT stamped cut.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';
import { surfaceToWorld2D, worldToSurface2D } from 'rn-gamekit/camera2d';

let cameraLabDefinition: unknown;
let PointerBinding: new (
  action: string,
  input: unknown,
  getViewport: () => unknown,
  generation: number,
  onSample?: (sample: Sample) => void,
) => {
  begin(pointerId: number, point: { x: number; y: number }, camera?: unknown): boolean;
  move(pointerId: number, point: { x: number; y: number }, camera?: unknown): void;
  end(pointerId: number): void;
};

/** A NON-IDENTITY fit viewport (640 x 480 surface, 320 x 480 logical). */
const MOUNTED_VIEWPORT = {
  surfaceSize: { width: 640, height: 480 },
  logicalBounds: { x: 0, y: 0, width: 320, height: 480 },
  visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 },
  contentBounds: { x: 160, y: 0, width: 320, height: 480 },
  scale: 2,
  offsetX: 160,
  offsetY: 0,
};

type Sample = {
  surface: { x: number; y: number };
  viewport: unknown;
  camera: { camera: { center: { x: number; y: number }; zoom: number; rotationRadians: number } } | undefined;
  world: { x: number; y: number };
};

before(async () => {
  const { cameraLabDefinition: definition } = await import('./cameraLabGame.ts');
  cameraLabDefinition = definition;
  const { PointerBinding: Binding } = await import('../../../../../packages/gamekit/src/react/pointerBinding.ts');
  PointerBinding = Binding as unknown as typeof PointerBinding;
});

describe('committed and round-trip diagnostics (T12-TF3)', () => {
  it('keeps accepted (dispatch) and committed (fixed-step) visibly distinct', () => {
    const driver = new ManualFrameDriver();
    const session = createGameSessionWithDriver(cameraLabDefinition as never, { frameDriver: driver }) as import('rn-gamekit').GameSession;
    let timeline = 0;
    const tick = (): void => {
      timeline += 16.7;
      act(() => driver.fireNext(timeline));
    };
    act(() => session.start());
    tick();
    const input = session.input as { acceptedCount: number; sampledCount: number };
    const acceptedBaseline = input.acceptedCount;
    const committedBaseline = input.sampledCount;

    // Queue several accepted packets WITHOUT ticking: accepted advances
    // immediately; committed does not.
    session.input.begin('primary', 1, { x: 100, y: 100 });
    session.input.move('primary', 1, { x: 120, y: 120 });
    session.input.move('primary', 1, { x: 140, y: 140 });
    assert.ok(input.acceptedCount > acceptedBaseline, 'accepted advances at dispatch');
    assert.equal(input.sampledCount, committedBaseline, 'committed waits for the fixed step');

    // One tick samples them: committed advances.
    tick();
    assert.ok(input.sampledCount > committedBaseline, 'committed advances when the step samples');

    // Pause: no sampling, so committed holds while dispatches may continue.
    act(() => session.pause());
    const pausedCommitted = input.sampledCount;
    session.input.move('primary', 1, { x: 160, y: 160 });
    assert.equal(input.sampledCount, pausedCommitted, 'pause holds committed');
    act(() => session.dispose());
  });

  it('measures the round trip from a real accepted sample with the mounted viewport and event-time cut', () => {
    let sample: Sample | undefined;
    const events: unknown[] = [];
    const input = {
      begin: (_a: string, _id: number, point: unknown) => events.push(point),
      move: () => undefined,
      end: () => undefined,
      cancel: () => undefined,
    };
    const binding = new PointerBinding('move', input, () => MOUNTED_VIEWPORT as never, 1, (next: Sample) => {
      sample = next;
    });
    const camera = { camera: { center: { x: 40, y: -30 }, zoom: 1.5, rotationRadians: 0.4 }, cutId: 7 };
    const surface = { x: 300, y: 120 };
    assert.equal(binding.begin(7, surface, camera as never), true);

    assert.ok(sample !== undefined, 'one accepted sample was reported');
    assert.equal(sample.camera, camera, 'the sample carries the EXACT event-time cut');
    assert.equal(sample.viewport, MOUNTED_VIEWPORT, 'the sample carries the mounted viewport');

    // The delivered world point back-projects to the original surface point
    // through the SAME viewport and cut: the round-trip residual.
    const back = worldToSurface2D(sample.world, sample.viewport as never, sample.camera!.camera);
    const error = Math.hypot(back.x - surface.x, back.y - surface.y);
    assert.ok(error < 1e-9, `round trip through the real pipeline (${error})`);

    // A SYNTHETIC identity viewport would NOT produce this world point:
    // the identity conversion differs from the delivered world.
    const identityWorld = surfaceToWorld2D(
      surface,
      {
        surfaceSize: { width: 320, height: 480 },
        logicalBounds: { x: 0, y: 0, width: 320, height: 480 },
        visibleLogicalBounds: { x: 0, y: 0, width: 320, height: 480 },
        contentBounds: { x: 0, y: 0, width: 320, height: 480 },
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      },
      camera.camera,
    );
    assert.ok(
      Math.abs(identityWorld.x - sample.world.x) > 1,
      'the sample reflects the MOUNTED viewport, not an identity proxy',
    );
  });
});

function actStart(session: { start(): void }): void {
  session.start();
}

function actTick(driver: { fireNext(t: number): void }): void {
  driver.fireNext(16.7);
}

function act(fn: () => void): void {
  fn();
}
