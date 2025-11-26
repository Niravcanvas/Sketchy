import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-url', () => ({
  getApiUrl: () => 'http://localhost:4000/v1',
}));

// Static import after the mock above (vitest hoists `vi.mock`), matching lib/socket.test.ts's
// convention for a module that reads `getApiUrl()` at call time.
const { getGamesToday } = await import('./admin-stats');

/**
 * `getGamesToday` (post-launch-backlog.md item 4 — RESOLVED): calls the PUBLIC
 * `GET /v1/stats/games-today`, not the admin-token-gated `GET /v1/admin/stats`. These tests
 * pin the two things that mattered about the old coupling: no `Authorization` header is ever
 * sent, and `ADMIN_TOKEN` is never read — plus the existing "degrade to `null` on any
 * failure" contract the presentation layer (`games-today-counter.tsx`) depends on.
 */
describe('lib/admin-stats getGamesToday', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.ADMIN_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the public games-today endpoint with no Authorization header', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ gamesToday: 42 }),
    });

    const result = await getGamesToday();

    expect(result).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('http://localhost:4000/v1/stats/games-today');
    expect(init?.headers).toBeUndefined();
    expect(init?.next).toEqual({ revalidate: 120 });
  });

  it('does not depend on ADMIN_TOKEN at all — still calls through when unset', async () => {
    expect(process.env.ADMIN_TOKEN).toBeUndefined();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ gamesToday: 5 }) });

    const result = await getGamesToday();

    expect(result).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    expect(await getGamesToday()).toBeNull();
  });

  it('returns null on a malformed body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ notGamesToday: 1 }) });
    expect(await getGamesToday()).toBeNull();
  });

  it('returns null on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await getGamesToday()).toBeNull();
  });
});
