import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client.js';

const validAvatar = { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' };
const validPlayer = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Sam',
  avatar: validAvatar,
  isGuest: true,
  createdAt: Date.now(),
};

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

describe('createApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('guestAuth POSTs to /auth/guest with no Authorization header when signed out', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: 'jwt', player: validPlayer }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    const result = await client.guestAuth({ displayName: 'Sam' });

    expect(result.token).toBe('jwt');
    expect(result.player.id).toBe(validPlayer.id);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://localhost:4000/v1/auth/guest');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.body).toBe(JSON.stringify({ displayName: 'Sam' }));
  });

  it('getMe attaches the Authorization header when a token is available', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ player: validPlayer }));
    const client = createApiClient({
      baseUrl: 'http://localhost:4000/v1',
      getToken: () => 'abc123',
    });

    await client.getMe();

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc123');
  });

  it('calls onTokenRefresh when the response carries X-Refreshed-Token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ player: validPlayer }, { headers: { 'X-Refreshed-Token': 'new-jwt' } }),
    );
    const onTokenRefresh = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://localhost:4000/v1',
      getToken: () => 'old-jwt',
      onTokenRefresh,
    });

    await client.getMe();

    expect(onTokenRefresh).toHaveBeenCalledWith('new-jwt');
  });

  it('throws ApiError with the parsed envelope on a non-2xx response', async () => {
    // A fresh Response per call — bodies can only be read once, and both
    // assertions below independently trigger their own fetch call.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: 'profanity', message: "Let's keep it printable." } },
          { status: 400 },
        ),
      ),
    );
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    await expect(client.guestAuth({ displayName: 'badword' })).rejects.toBeInstanceOf(ApiError);
    await expect(client.guestAuth({ displayName: 'badword' })).rejects.toMatchObject({
      status: 400,
      code: 'profanity',
      message: "Let's keep it printable.",
    });
  });

  it('falls back to code "internal" when the error body is not the expected envelope', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    await expect(client.getMe()).rejects.toMatchObject({ status: 502, code: 'internal' });
  });

  it('rejects a 2xx response that fails schema validation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ player: { nope: true } }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    await expect(client.getMe()).rejects.toThrow();
  });

  it('listPacks serializes boolean-ish query params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    await client.listPacks({ official: true, mine: false, language: 'en' });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get('official')).toBe('true');
    expect(url.searchParams.get('mine')).toBe('false');
    expect(url.searchParams.get('language')).toBe('en');
  });

  it('listPacks omits absent query params entirely', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    await client.listPacks();

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.search).toBe('');
  });

  it('listPackPairs builds a nested path with pagination params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    await client.listPackPairs('pack-1', { cursor: 'abc', limit: 10 });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/v1/packs/pack-1/pairs');
    expect(url.searchParams.get('cursor')).toBe('abc');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('createRoom POSTs to /rooms and returns the allocated code + joinUrl', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'ABCJK', joinUrl: 'https://sketchy.example/r/ABCJK' }),
    );
    const client = createApiClient({
      baseUrl: 'http://localhost:4000/v1',
      getToken: () => 'abc123',
    });

    const result = await client.createRoom({ settings: { maxPlayers: 10 } });

    expect(result).toEqual({ code: 'ABCJK', joinUrl: 'https://sketchy.example/r/ABCJK' });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://localhost:4000/v1/rooms');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ settings: { maxPlayers: 10 } }));
  });

  it('createRoom defaults to an empty body when called with no settings', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'ABCJK', joinUrl: 'https://sketchy.example/r/ABCJK' }),
    );
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    await client.createRoom({});

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.body).toBe(JSON.stringify({}));
  });

  it('getRoom builds the /rooms/:code path and returns the pre-join resolution', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 'ABCJK',
        phase: 'lobby',
        playerCount: 3,
        maxPlayers: 12,
        canJoin: true,
        canRejoin: false,
        hostName: 'Priya',
      }),
    );
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    const result = await client.getRoom('ABCJK');

    expect(result.canJoin).toBe(true);
    expect(result.hostName).toBe('Priya');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://localhost:4000/v1/rooms/ABCJK');
    expect(init.method).toBe('GET');
  });

  it('getRoom rejects with room_not_found on a 404 envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'room_not_found', message: 'No room with that code.' } },
        { status: 404 },
      ),
    );
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1' });

    await expect(client.getRoom('ZZZZZ')).rejects.toMatchObject({
      status: 404,
      code: 'room_not_found',
    });
  });

  it('getVoiceToken builds the /rooms/:code/voice-token path and returns token+url', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ token: 'signed.jwt', url: 'ws://localhost:7880' }),
    );
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1', getToken: () => 't' });

    const result = await client.getVoiceToken('ABCJK');

    expect(result).toEqual({ token: 'signed.jwt', url: 'ws://localhost:7880' });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://localhost:4000/v1/rooms/ABCJK/voice-token');
    expect(init.method).toBe('GET');
  });

  it('getVoiceToken rejects with voice_disabled on a 403 kill-switch envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'voice_disabled', message: 'Voice chat is turned off right now.' } },
        { status: 403 },
      ),
    );
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1', getToken: () => 't' });

    await expect(client.getVoiceToken('ABCJK')).rejects.toMatchObject({
      status: 403,
      code: 'voice_disabled',
    });
  });

  it('getPlayerStats GETs /players/me/stats', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        totalPoints: 42,
        gamesPlayed: 10,
        gamesWon: 4,
        byRole: {
          civilian: { played: 4, won: 2, points: 4 },
          undercover: { played: 3, won: 1, points: 10 },
          mrwhite: { played: 3, won: 1, points: 6 },
        },
      }),
    );
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1', getToken: () => 't' });

    const result = await client.getPlayerStats();

    expect(result.totalPoints).toBe(42);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://localhost:4000/v1/players/me/stats');
    expect(init.method).toBe('GET');
  });

  it('getPlayerGames builds the pagination query', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1', getToken: () => 't' });

    await client.getPlayerGames({ cursor: 'abc', limit: 5 });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/v1/players/me/games');
    expect(url.searchParams.get('cursor')).toBe('abc');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('getPlayerGameSummary builds the nested game-id path', async () => {
    const gameId = '123e4567-e89b-12d3-a456-426614174000';
    fetchMock.mockResolvedValueOnce(jsonResponse({ gameId, rounds: [] }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/v1', getToken: () => 't' });

    const result = await client.getPlayerGameSummary(gameId);

    expect(result.rounds).toEqual([]);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe(`/v1/players/me/games/${gameId}`);
  });
});
