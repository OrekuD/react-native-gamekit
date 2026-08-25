/**
 * Temporary debug harness — drives a real storage-lab session via ManualFrameDriver.
 */
import { createGameSessionWithDriver, ManualFrameDriver } from 'rn-gamekit/testing';
import { createStorageLabDefinition } from './storageLabGame.ts';

(globalThis as { require?: (id: string) => number }).require = () => 42;

const driver = new ManualFrameDriver();
const session = createGameSessionWithDriver(createStorageLabDefinition(undefined), {
  frameDriver: driver,
}) as unknown as {
  start(): void;
  status: string;
  getRenderFrame(): { current?: { x: number; checkpointIndex: number; ticks: number } };
};

let events = 0;
session.start();
console.log('status after start:', session.status);

let timestamp = 0;
for (let i = 0; i < 300; i += 1) {
  timestamp += 16;
  const pending = (driver as unknown as { pendingCount: number }).pendingCount;
  if (pending === 0) {
    console.log(`iter ${i}: no pending frame`);
    // yield a macrotask and retry
    await new Promise((r) => setTimeout(r, 5));
    if ((driver as unknown as { pendingCount: number }).pendingCount === 0) {
      console.log('still none, breaking');
      break;
    }
    continue;
  }
  driver.fireNext(timestamp);
  await new Promise((r) => setTimeout(r, 0));
  const snap = session.getRenderFrame().current;
  if (i % 20 === 0) console.log(`iter ${i} t=${timestamp} x=${snap?.x.toFixed(1)} cp=${snap?.checkpointIndex}`);
}

const snap = session.getRenderFrame().current;
console.log('final:', snap);
