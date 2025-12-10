import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AvatarConfig } from '@sketchy/engine/types';
import { defaultAvatar } from '@/lib/default-avatar';
import { AvatarDoodle } from './avatar-doodle';
import {
  AVATAR_ACCESSORY_IDS,
  AVATAR_FACE_IDS,
  AVATAR_HEAD_IDS,
  AVATAR_INK_COLORS,
} from './avatar-config';

const BASE_CONFIG: AvatarConfig = {
  head: AVATAR_HEAD_IDS[0],
  face: AVATAR_FACE_IDS[0],
  accessory: 'none',
  inkColor: AVATAR_INK_COLORS[0],
};

/** `<AvatarDoodle>` layers head/face/accessory as sibling `<g>` elements directly under the
 * root `<svg>` — counting those (and the `<path>`s inside them) is the structural signal
 * this suite checks, never an SVG/path-data snapshot. */
function renderDoodle(config: AvatarConfig) {
  const { container } = render(<AvatarDoodle config={config} />);
  const svg = screen.getByTestId('avatar-doodle');
  const layers = container.querySelectorAll('svg > g');
  return { svg, layers };
}

describe('AvatarDoodle', () => {
  it('renders a single square svg, aria-hidden by default', () => {
    const { svg } = renderDoodle(BASE_CONFIG);
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('width')).toBe('96');
    expect(svg.getAttribute('height')).toBe('96');
  });

  it('becomes an accessible image with a title, instead of aria-hidden', () => {
    render(<AvatarDoodle config={BASE_CONFIG} title="Priya's avatar" />);
    const svg = screen.getByTestId('avatar-doodle');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelector('title')?.textContent).toBe("Priya's avatar");
  });

  it('respects a custom size', () => {
    const { container } = render(<AvatarDoodle config={BASE_CONFIG} size={48} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('48');
    expect(svg?.getAttribute('height')).toBe('48');
  });

  describe('every curated head id renders its own layer', () => {
    for (const head of AVATAR_HEAD_IDS) {
      it(head, () => {
        const { layers } = renderDoodle({ ...BASE_CONFIG, head, accessory: 'none' });
        // head + face only (accessory is 'none' → no third layer)
        expect(layers).toHaveLength(2);
        expect(layers[0]?.querySelectorAll('path').length).toBeGreaterThan(0);
      });
    }
  });

  describe('every curated face id renders its own layer', () => {
    for (const face of AVATAR_FACE_IDS) {
      it(face, () => {
        const { layers } = renderDoodle({ ...BASE_CONFIG, face, accessory: 'none' });
        expect(layers).toHaveLength(2);
        expect(layers[1]?.querySelectorAll('path').length).toBeGreaterThan(0);
      });
    }
  });

  describe('every curated accessory id (except none) renders a third layer', () => {
    for (const accessory of AVATAR_ACCESSORY_IDS.filter((id) => id !== 'none')) {
      it(accessory, () => {
        const { layers } = renderDoodle({ ...BASE_CONFIG, accessory });
        expect(layers).toHaveLength(3);
        expect(layers[2]?.querySelectorAll('path').length).toBeGreaterThan(0);
      });
    }
  });

  it("'none' renders no accessory layer at all", () => {
    const { layers } = renderDoodle({ ...BASE_CONFIG, accessory: 'none' });
    expect(layers).toHaveLength(2);
  });

  describe('defaultAvatar(seat) renders for every seat 0..19', () => {
    for (let seat = 0; seat < 20; seat += 1) {
      it(`seat ${seat}`, () => {
        const { svg, layers } = renderDoodle(defaultAvatar(seat));
        expect(svg).toBeTruthy();
        // head + face always resolve for defaultAvatar's curated ids; accessory adds a
        // third layer except on the seats where it lands on 'none'.
        expect(layers.length === 2 || layers.length === 3).toBe(true);
      });
    }
  });

  it('skips an unrecognized head id instead of crashing', () => {
    const { layers } = renderDoodle({ ...BASE_CONFIG, head: 'nonexistent-head', accessory: 'none' });
    expect(layers).toHaveLength(1); // face only
  });

  it('skips an unrecognized face id instead of crashing', () => {
    const { layers } = renderDoodle({ ...BASE_CONFIG, face: 'nonexistent-face', accessory: 'none' });
    expect(layers).toHaveLength(1); // head only
  });

  it('skips an unrecognized accessory id instead of crashing', () => {
    const { layers } = renderDoodle({ ...BASE_CONFIG, accessory: 'nonexistent-accessory' });
    expect(layers).toHaveLength(2); // head + face only
  });

  it('renders nothing but a bare svg when every part id is unrecognized', () => {
    const { svg, layers } = renderDoodle({
      head: 'nope',
      face: 'nope',
      accessory: 'nope',
      inkColor: 'nope',
    });
    expect(svg).toBeTruthy();
    expect(layers).toHaveLength(0);
  });

  it('falls back to the ink palette token when inkColor is unrecognized', () => {
    const { svg } = renderDoodle({ ...BASE_CONFIG, inkColor: 'not-a-real-token' });
    expect(svg.getAttribute('style')).toContain('var(--color-ink)');
  });

  it('resolves a known inkColor to its own palette token, not the fallback', () => {
    const { svg } = renderDoodle({ ...BASE_CONFIG, inkColor: 'undercover' });
    expect(svg.getAttribute('style')).toContain('var(--color-undercover)');
  });
});
