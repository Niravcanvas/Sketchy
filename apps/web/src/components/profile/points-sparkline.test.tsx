import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { copy } from '@/copy';
import { PointsSparkline } from './points-sparkline';

describe('PointsSparkline', () => {
  it('shows the "too few games" message instead of a chart for 0 or 1 games', () => {
    const { rerender } = render(<PointsSparkline pointsChronological={[]} />);
    expect(screen.getByText(copy.profile.sparkline.tooFewGames)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();

    rerender(<PointsSparkline pointsChronological={[10]} />);
    expect(screen.getByText(copy.profile.sparkline.tooFewGames)).toBeTruthy();
  });

  it('draws a polyline with one point per game once there are at least two games', () => {
    render(<PointsSparkline pointsChronological={[2, 10, 6, 0, 10]} />);
    expect(screen.queryByText(copy.profile.sparkline.tooFewGames)).toBeNull();
    expect(screen.getByText(copy.profile.sparkline.helper(5))).toBeTruthy();

    const svg = screen.getByRole('img');
    const polyline = svg.querySelector('polyline');
    expect(polyline).toBeTruthy();
    // One coordinate pair per data point.
    expect(polyline!.getAttribute('points')!.trim().split(' ')).toHaveLength(5);
    expect(svg.querySelectorAll('circle')).toHaveLength(5);
  });

  it('does not throw when every game scored the same points (zero range)', () => {
    render(<PointsSparkline pointsChronological={[2, 2, 2]} />);
    const svg = screen.getByRole('img');
    expect(svg.querySelector('polyline')).toBeTruthy();
  });
});
