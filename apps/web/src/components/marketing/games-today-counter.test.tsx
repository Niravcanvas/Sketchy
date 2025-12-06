import { beforeEach, describe, expect, it, vi } from 'vitest';

// The counter awaits `getGamesToday`; mocking it keeps this test Postgres- and
// network-free (no real `GET /v1/stats/games-today` call).
vi.mock('@/lib/admin-stats', () => ({
  getGamesToday: vi.fn(),
}));

import { getGamesToday } from '@/lib/admin-stats';
import { GamesTodayCounter } from './games-today-counter';

const mockGetGamesToday = vi.mocked(getGamesToday);

describe('GamesTodayCounter', () => {
  beforeEach(() => {
    mockGetGamesToday.mockReset();
  });

  it('renders nothing when the count is unavailable (API down / bad fetch)', async () => {
    mockGetGamesToday.mockResolvedValue(null);
    expect(await GamesTodayCounter()).toBeNull();
  });

  it('renders nothing when the count is below the display threshold', async () => {
    mockGetGamesToday.mockResolvedValue(9);
    expect(await GamesTodayCounter()).toBeNull();
  });

  it('renders the counter once the count reaches the threshold', async () => {
    mockGetGamesToday.mockResolvedValue(10);
    expect(await GamesTodayCounter()).not.toBeNull();
  });

  it('renders the counter for a healthy count', async () => {
    mockGetGamesToday.mockResolvedValue(42);
    expect(await GamesTodayCounter()).not.toBeNull();
  });
});
