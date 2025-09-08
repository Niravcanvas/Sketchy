import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';

describe('ops routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /v1/health returns 200 { ok: true }', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /v1/ready returns { ok, postgres, redis } with status 200 or 503', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/ready' });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json();
    expect(typeof body.ok).toBe('boolean');
    expect(typeof body.postgres).toBe('boolean');
    expect(typeof body.redis).toBe('boolean');
    expect(res.statusCode).toBe(body.ok ? 200 : 503);
  });

  it('unknown route returns 404 with the error envelope', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'not_found', message: expect.any(String) },
    });
  });

  it('GET /v1/openapi.json serves the generated OpenAPI doc', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.info.title).toBe('Sketchy API');
    expect(doc.paths).toHaveProperty('/v1/health');
  });
});
