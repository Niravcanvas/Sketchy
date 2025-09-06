import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerAuthDecoration } from './auth/plugin.js';
import { getEnv } from './env.js';
import { sendError } from './error-envelope.js';
import { captureError, initObservability } from './observability.js';
import { registerGlobalRateLimit } from './rate-limit.js';
import { accountRoutes } from './routes/accounts.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { blockRoutes } from './routes/blocks.js';
import { healthRoutes } from './routes/health.js';
import { lobbyRoutes } from './routes/lobbies.js';
import { matchmakingRoutes } from './routes/matchmaking.js';
import { packRoutes } from './routes/packs.js';
import { playerRoutes } from './routes/players.js';
import { reportRoutes } from './routes/reports.js';
import { roomRoutes } from './routes/rooms.js';
import { statsRoutes } from './routes/stats.js';
import { uploadRoutes } from './routes/uploads.js';
import { registerSockets } from './sockets/index.js';

/**
 * Builds the pino-pretty write stream directly (rather than pino's
 * `transport: { target: 'pino-pretty' }` option, which off-loads formatting
 * to a worker thread that loads `pino-pretty` — and `thread-stream`'s own
 * worker file — by file path). That worker-thread indirection does not
 * survive esbuild bundling `dist/index.cjs` into a single file (the worker's
 * relative module path no longer exists on disk), so we build the stream
 * in-process instead: same pretty output, no worker thread.
 *
 * `pino-pretty` is a devDependency (dev-only log formatting) and may be
 * absent in a stripped-down install — the dynamic `import()` doubles as the
 * "is it resolvable" check (api-contract.md task 4 dev logging note) and
 * works identically whether this file runs unbundled (tsx, native ESM
 * resolution) or bundled by esbuild (a bare `require` is not available in
 * ESM source, and `import.meta` is emptied by esbuild's cjs output — a
 * dynamic `import()` survives both).
 */
async function buildPrettyStream(): Promise<NodeJS.WritableStream | undefined> {
  if (process.env.NODE_ENV === 'production') {
    return undefined;
  }
  try {
    const prettyFactory = (await import('pino-pretty')).default;
    return prettyFactory({ translateTime: 'HH:MM:ss', ignore: 'pid,hostname' });
  } catch {
    return undefined;
  }
}

/**
 * Builds a fully configured Fastify instance — logging, validation, CORS,
 * OpenAPI generation, error handling, routes — but does not start listening
 * (index.ts owns the listen/shutdown lifecycle).
 */
export async function buildServer(): Promise<FastifyInstance> {
  const env = getEnv();
  // Error tracking. Idempotent + a no-op without SENTRY_DSN.
  initObservability();
  const prettyStream = await buildPrettyStream();

  const fastify = Fastify({
    logger: { level: env.logLevel, stream: prettyStream },
  }).withTypeProvider<ZodTypeProvider>();

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(cors, {
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
    // @fastify/cors defaults to GET,HEAD,POST — which silently breaks the
    // contract's PATCH (players/me) and future DELETE routes from a browser
    // (api-contract.md §1).
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
    // api-contract.md §1: GET /players/me's silent token-refresh header must
    // be readable by browser JS, which CORS hides by default.
    exposedHeaders: ['X-Refreshed-Token'],
  });

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Sketchy API', version: '0.1.0' },
      servers: process.env.PUBLIC_API_URL ? [{ url: process.env.PUBLIC_API_URL }] : [],
    },
    transform: jsonSchemaTransform,
  });

  // Global error handler (api-contract.md §0): zod/validation errors -> 400
  // `validation`; everything else -> 500 `internal` with the real error only
  // ever reaching the logs, never the client.
  fastify.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      sendError(reply, 400, 'validation', error.message);
      return;
    }
    request.log.error({ err: error }, 'unhandled request error');
    captureError(error, { playerId: request.player?.id });
    sendError(reply, 500, 'internal', 'Internal server error');
  });

  fastify.setNotFoundHandler((request, reply) => {
    sendError(reply, 404, 'not_found', `Route ${request.method}:${request.url} not found`);
  });

  await fastify.register(
    async (v1) => {
      // Both applied directly to `v1` (not via nested `.register()`) so the
      // `request.player` decoration and rate-limit hook cover every route
      // registered below, including the sibling plugins registered as their
      // own encapsulated contexts (auth/plugin.ts and rate-limit.ts explain
      // why `.register()` wouldn't achieve that). Order matters: auth
      // decoration must run before the rate limiter, which keys authed
      // callers by playerId.
      registerAuthDecoration(v1);
      registerGlobalRateLimit(v1);

      await v1.register(healthRoutes);
      await v1.register(authRoutes);
      await v1.register(accountRoutes);
      await v1.register(playerRoutes);
      await v1.register(packRoutes);
      await v1.register(roomRoutes);
      await v1.register(lobbyRoutes);
      await v1.register(matchmakingRoutes);
      await v1.register(reportRoutes);
      await v1.register(blockRoutes);
      await v1.register(uploadRoutes);
      await v1.register(adminRoutes);
      await v1.register(statsRoutes);

      // OpenAPI 3.1 doc (api-contract.md §0 versioning policy), generated
      // from the zod schemas above via `jsonSchemaTransform`. Hidden from
      // itself to avoid a self-referencing doc entry.
      v1.get('/openapi.json', { schema: { hide: true } }, async () => fastify.swagger());
    },
    { prefix: '/v1' },
  );

  // Socket.IO `/game` namespace (system-design.md §5) — sits alongside `/v1`
  // REST on the same HTTP server/port (`/socket.io/*` + the `/game`
  // namespace), not under the `/v1` prefix; it isn't a versioned REST
  // resource and Socket.IO owns its own path.
  await registerSockets(fastify);

  return fastify;
}
