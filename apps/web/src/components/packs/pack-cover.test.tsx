import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PackCover } from './pack-cover';

describe('PackCover', () => {
  it('renders the real image when coverUrl is set', () => {
    const { container } = render(
      <PackCover coverUrl="https://cdn.sketchy.example/packCover/x.png" seed="pack-1" />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.sketchy.example/packCover/x.png');
  });

  it('renders a deterministic placeholder (no coverUrl) that is stable for the same seed', () => {
    const { container: first } = render(<PackCover coverUrl={null} seed="pack-abc" />);
    const { container: second } = render(<PackCover coverUrl={null} seed="pack-abc" />);
    expect(first.innerHTML).toBe(second.innerHTML);
  });

  it('renders a DIFFERENT placeholder for a different seed (not always the same shape/color)', () => {
    const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    const htmls = new Set(
      seeds.map((seed) => render(<PackCover coverUrl={null} seed={seed} />).container.innerHTML),
    );
    // Not every seed needs a unique variant, but with 6 seeds across a 4x3 = 12-way space,
    // seeing more than one distinct render is a reasonable "it's not hardcoded" check.
    expect(htmls.size).toBeGreaterThan(1);
  });

  it('never renders a raw hex color (design-party-pop.md §2 — tokens only)', () => {
    const { container } = render(<PackCover coverUrl={null} seed="hex-check" />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
