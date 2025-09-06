/**
 * Per-test-FILE setup (as opposed to `vitest.global-setup.ts`, which runs
 * once for the whole run). Every test file that imports `buildServer()`
 * ends up lazily opening the shared pg pool / ioredis client
 * (`src/db/client.ts`) — this closes them after that file's tests finish so
 * runs don't leak open handles.
 */
import { afterAll } from 'vitest';
import { closeConnections } from './src/db/client.js';

afterAll(async () => {
  await closeConnections();
});
