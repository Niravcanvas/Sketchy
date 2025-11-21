import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { getEnv } from '../env.js';
import * as schema from './schema.js';

/**
 * Lazily-created Postgres pool + Redis client singletons — the ONLY holders
 * of connections in this process (system-design.md §2: apps/api is the
 * only service that touches Postgres/Redis). Every route and the `/v1/ready`
 * health check share these instead of opening their own throwaway clients.
 */

let pool: Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;
let redis: Redis | undefined;

/**
 * The pg pool backing `getDb()`. Capped at 10 connections (system-design.md
 * §9: Postgres `max_connections=50`, Drizzle pool ≤10) — throws if
 * `DATABASE_URL` isn't configured, since there's no meaningful pool to hand
 * back; callers that must never throw (the `/v1/ready` ping) catch this.
 */
export function getPool(): Pool {
  if (!pool) {
    const env = getEnv();
    if (!env.databaseUrl) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString: env.databaseUrl, max: 10 });
    // Without a listener, a connection-level 'error' event (e.g. the backend
    // restarting mid-idle) would crash the process (EventEmitter default
    // behavior). Failed queries still reject their own promise normally.
    pool.on('error', (error) => {
      console.error('postgres pool error', error);
    });
  }
  return pool;
}

/** The Drizzle query builder over `getPool()`, typed against `./schema.ts`. */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

/**
 * The shared ioredis client (lazyConnect — the first real command triggers
 * the actual TCP connect). Used by the rate limiter and the `/v1/ready`
 * ping; throws if `REDIS_URL` isn't configured, for the same reason as
 * `getPool()` above.
 */
export function getRedis(): Redis {
  if (!redis) {
    const env = getEnv();
    if (!env.redisUrl) {
      throw new Error('REDIS_URL is not set');
    }
    redis = new Redis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    redis.on('error', (error) => {
      console.error('redis client error', error);
    });
  }
  return redis;
}

/**
 * Closes both connections and clears the singletons — used by tests (and
 * would be used by a graceful-shutdown hook) to release resources cleanly.
 * A later `getPool()`/`getRedis()`/`getDb()` call creates fresh instances.
 */
export async function closeConnections(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
  if (redis) {
    redis.disconnect();
    redis = undefined;
  }
  db = undefined;
}
