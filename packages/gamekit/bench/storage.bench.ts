/**
 * GS-STORAGE-02 large-payload save benchmark.
 *
 * Reports domain-validation invocations and wall time for a large accepted
 * payload through the queued save path. Run with `pnpm bench:storage`.
 *
 * History (desktop V8, Node 24): one domain pass per acceptance; a 1000-key
 * nested payload saves in ~5.5ms.
 */
import { createGameSaveStore } from '../src/storage/store';
import { defineGameSave } from '../src/storage/schema';
import { createMemoryStorageAdapter } from '../src/storage/adapters/memory';

let validations = 0;
const schema = defineGameSave<{ keys: Record<string, { v: number }> }>({
  id: 'com.example.bench',
  version: 1,
  createDefault: () => ({ keys: {} }),
  validate: (value) => {
    validations += 1;
    return value as { keys: Record<string, { v: number }> };
  },
});

const big: Record<string, { v: number }> = {};
for (let i = 0; i < 1000; i++) {
  big[`key-${i}`] = { v: i };
}

const store = createGameSaveStore({
  schema,
  adapter: createMemoryStorageAdapter(),
  namespace: 'bench',
});

async function main(): Promise<void> {
  const start = performance.now();
  await store.save('big', { keys: big });
  const ms = performance.now() - start;
  console.log(`large save (1000 nested keys): ${ms.toFixed(1)}ms validations=${validations}`);
  store.dispose();
}

void main();
