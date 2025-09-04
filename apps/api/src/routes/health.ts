import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPool, getRedis } from '../db/client.js';

const healthResponseSchema = z.object({ ok: z.literal(true) });

const readyResponseSchema = z.object({
  ok: z.boolean(),
  postgres: z.boolean(),
  redis: z.boolean(),
});

/** Every dependency ping gets this budget before we give up and report `false`. */
const PING_TIMEOUT_MS = 1500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ping timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Pings via the shared pooled client from `db/client.ts`. A missing `DATABASE_URL`
 * (`getPool()` throws), a down database, or a slow response all resolve to
 * `false`; this never throws. The pool itself is never torn down here — it's
 * a long-lived singleton shared by every route.
 */
async function pingPostgres(): Promise<boolean> {
  try {
    const pool = getPool();
    await withTimeout(pool.query('SELECT 1'), PING_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pings via the shared lazy-connect ioredis client from `db/client.ts`.
 * `ping()` triggers the initial connection itself (lazyConnect); same
 * failure shape as `pingPostgres` above, and the client is never
 * disconnected here — it's a long-lived singleton.
 */
async function pingRedis(): Promise<boolean> {
  try {
    const redis = getRedis();
    const pong = await withTimeout(redis.ping(), PING_TIMEOUT_MS);
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Ops endpoints (api-contract.md §1): `/health` proves the process is up;
 * `/ready` pings Postgres + Redis so orchestrators/load balancers can gate
 * traffic on real dependency health.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => ({
    ok: true as const,
  }));

  fastify.get(
    '/ready',
    {
      schema: {
        response: {
          200: readyResponseSchema,
          503: readyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const [postgres, redis] = await Promise.all([pingPostgres(), pingRedis()]);
      const ok = postgres && redis;
      reply.status(ok ? 200 : 503);
      return { ok, postgres, redis };
    },
  );
};
