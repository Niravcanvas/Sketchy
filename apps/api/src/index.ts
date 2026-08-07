import { getEnv } from './env.js';
import { closeObservability } from './observability.js';
import { buildServer } from './server.js';
import { assertProductionSecretsConfigured } from './startup-guards.js';
import { getDb } from './db/client.js';
import { resolveSeedDir, loadPackFiles, seedPack } from '../scripts/seed.js';

async function main(): Promise<void> {
  const env = getEnv();
  assertProductionSecretsConfigured(env);

  // --- TEMPORARY ONE-OFF SEEDING (Remove after deploy) ---
  try {
    const seedDir = resolveSeedDir();
    const packFiles = await loadPackFiles(seedDir);
    const db = getDb();
    for (const { data } of packFiles) {
      const summary = await seedPack(db, data);
      console.log(`[Auto-Seed] ${summary}`);
    }
    console.log(`[Auto-Seed] Seeded ${packFiles.length} pack(s) from ${seedDir}`);
  } catch (error) {
    console.error('[Auto-Seed] Failed to run startup seed:', error);
  }
  // -------------------------------------------------------

  const fastify = await buildServer();

  await fastify.listen({ port: env.port, host: '0.0.0.0' });
  fastify.log.info(`Sketchy API listening on port ${env.port}`);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    fastify.log.info({ signal }, 'shutting down');
    fastify
      .close()
      // Flush any pending Sentry crash/error context before the process dies —
      // closeObservability() is a no-op when Sentry isn't configured and is
      // bounded by its own short internal deadline, so this stays best-effort.
      .then(() => closeObservability())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        fastify.log.error({ err: error }, 'error during shutdown');
        // Still flush best-effort on the error path so the failure context isn't lost.
        void closeObservability().finally(() => process.exit(1));
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  // buildServer() itself failed, so there's no pino logger to report through.
  console.error(error);
  process.exit(1);
});
