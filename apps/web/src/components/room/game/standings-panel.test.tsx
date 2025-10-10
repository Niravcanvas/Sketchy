import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { copy } from '@/copy';
import { StandingsPanel } from './standings-panel';

describe('StandingsPanel', () => {
  it('renders nothing for an empty room', () => {
    const { container } = render(<StandingsPanel rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('sorts rows by points descending (regardless of input order) and marks only the top scorer as MVP', () => {
    render(
      <StandingsPanel
        rows={[
          { id: 'p2', name: 'Sam', points: 2 },
          { id: 'p1', name: 'Priya', points: 8 },
          { id: 'p3', name: 'Jo', points: 5 },
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // Priya (8) first, then Jo (5), then Sam (2) — NOT the order the rows were passed in.
    expect(rows[0]!.textContent).toContain('Priya');
    expect(rows[0]!.textContent).toContain(copy.profile.standings.mvpLabel);
    expect(rows[1]!.textContent).toContain('Jo');
    expect(rows[1]!.textContent).not.toContain(copy.profile.standings.mvpLabel);
    expect(rows[2]!.textContent).toContain('Sam');

    expect(screen.getAllByText(copy.profile.standings.mvpLabel)).toHaveLength(1);
  });

  it('marks the sole row MVP for a one-player room', () => {
    render(<StandingsPanel rows={[{ id: 'p1', name: 'Priya', points: 2 }]} />);
    expect(screen.getByText(copy.profile.standings.mvpLabel)).toBeTruthy();
  });
});
