import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { copy } from '@/copy';
import { RoleWinRateBars } from './role-winrate-bars';

describe('RoleWinRateBars', () => {
  it('renders a stat line and a proportional fill width for each played role', () => {
    render(
      <RoleWinRateBars
        byRole={{
          civilian: { played: 4, won: 2, points: 4 },
          undercover: { played: 5, won: 1, points: 10 },
          mrwhite: { played: 0, won: 0, points: 0 },
        }}
      />,
    );

    expect(screen.getByText(copy.profile.byRole.statLine(2, 4))).toBeTruthy();
    expect(screen.getByText(copy.profile.byRole.statLine(1, 5))).toBeTruthy();
    expect(screen.getByText(copy.profile.byRole.neverPlayed)).toBeTruthy();

    // Civilian: 2/4 = 50%; Undercover: 1/5 = 20%; Mr. White never played = 0%.
    const bars = screen.getAllByRole('img');
    const widths = bars.map((bar) => (bar.firstElementChild as HTMLElement).style.width);
    expect(widths).toEqual(['50%', '20%', '0%']);
  });

  it('shows the "never played" line and a 0% bar for a role with zero games', () => {
    render(
      <RoleWinRateBars
        byRole={{
          civilian: { played: 0, won: 0, points: 0 },
          undercover: { played: 0, won: 0, points: 0 },
          mrwhite: { played: 0, won: 0, points: 0 },
        }}
      />,
    );

    expect(screen.getAllByText(copy.profile.byRole.neverPlayed)).toHaveLength(3);
  });
});
